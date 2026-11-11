// End-to-end tests of the tracker CLI. Each test runs tt.mjs against its own temporary data folder.
// Run: node --test plugins/rafal-tools/skills/task-tracker/scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tt.mjs');

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-test-'));
  const home = path.join(root, 'data');
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const baseEnv = { ...process.env, TASK_TRACKER_HOME: home };
  delete baseEnv.CLAUDE_CODE_SESSION_ID;
  const run = (args, { input, session } = {}) =>
    spawnSync(process.execPath, [TT, ...args], {
      cwd: proj,
      env: session ? { ...baseEnv, CLAUDE_CODE_SESSION_ID: session } : baseEnv,
      input,
      encoding: 'utf8',
    });
  const tt = (...args) => {
    const r = run(args);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const hook = (kind, session, extra = {}) =>
    run(['hook', kind], { input: JSON.stringify({ cwd: proj, session_id: session, ...extra }) }).stdout.trim();
  tt('init', '.', '--name', 'demo');
  const base = path.join(home, 'projects', fs.readdirSync(path.join(home, 'projects'))[0]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { home, proj, base, baseEnv, run, tt, hook };
}

const taskFiles = (s) => fs.readdirSync(path.join(s.base, 'tasks')).sort();

test('add --start, log --next --note and done cover a task in three calls', (t) => {
  const s = sandbox(t);
  assert.match(s.tt('add', 'Build API', '--goal', 'CRUD for orders', '--start'), /T-001 added \[in-progress\]/);
  assert.match(s.tt('log', 'T-1', 'endpoints written', '--next', 'add tests', '--next', 'update docs', '--note', 'uses src/api.ts'),
    /log recorded, 2 next step\(s\) set, note added/);
  const shown = s.tt('show', '1');
  assert.match(shown, /## Next steps\n- add tests\n- update docs/);
  assert.match(shown, /## Notes\n- uses src\/api\.ts/);
  assert.match(shown, /endpoints written/);
  assert.match(s.tt('list'), /T-001 \[in-progress\] Build API — next: add tests \(\+1\)/);
  s.tt('done', '1', '--summary', 'orders API in src/api.ts');
  assert.equal(s.tt('list').trim(), '(no tasks)');
});

test('unknown flags and flags without a value are rejected and change nothing', (t) => {
  const s = sandbox(t);
  s.tt('add', 'Task');
  const typo = s.run(['done', 'T-1', '--sumary', 'lost text']);
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /unknown flag --sumary for `done` \(allowed: --note, --summary\)/);
  assert.match(s.tt('list'), /T-001 \[todo\]/);
  const empty = s.run(['add', 'Other', '--goal']);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /flag --goal needs a value/);
  // A bare -- still lets text start with "--".
  s.tt('log', 'T-1', '--', '--verbose fixed');
  assert.match(s.tt('show', 'T-1'), /--verbose fixed/);
});

test('dependencies: waiting tasks cannot start, done announces what became ready', (t) => {
  const s = sandbox(t);
  s.tt('add', 'Schema');
  s.tt('add', 'Endpoints', '--dep', 'T-1');
  assert.match(s.tt('list'), /T-002 \[todo\] Endpoints — WAITS FOR T-001/);
  assert.equal(s.tt('list', '--ready').trim(), 'T-001 [todo] Schema');
  const early = s.run(['start', 'T-2']);
  assert.equal(early.status, 1);
  assert.match(early.stderr, /waits for unfinished T-001/);
  assert.match(s.tt('done', 'T-1'), /Now ready \(all dependencies done\): T-002 Endpoints/);
  const cycle = s.run(['dep', 'T-1', 'T-2']);
  assert.equal(cycle.status, 1);
  assert.match(cycle.stderr, /dependency cycle/);
});

test('add --start is refused for a task that would wait, and leaves nothing behind', (t) => {
  const s = sandbox(t);
  s.tt('add', 'Schema');
  const r = s.run(['add', 'Endpoints', '--dep', 'T-1', '--start']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot --start/);
  assert.deepEqual(taskFiles(s), ['T-001.md']);
  assert.match(s.tt('add', 'Next one'), /T-002 added/);
});

test('a failed bulk import leaves no tasks and no orphan files', (t) => {
  const s = sandbox(t);
  const file = path.join(s.proj, 'bulk.json');
  fs.writeFileSync(file, JSON.stringify([
    { title: 'A', deps: ['#2'] },
    { title: 'B', deps: ['#1'] },
  ]));
  const r = s.run(['bulk', file]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /dependency cycle/);
  assert.deepEqual(taskFiles(s), []);
  assert.equal(s.tt('list', '--all').trim(), '(no tasks)');
  assert.ok(!fs.existsSync(path.join(s.home, '.lock')), 'the lock is released after a failure');

  fs.writeFileSync(file, JSON.stringify([{ title: 'A' }, { title: 'B', deps: ['#1'] }]));
  assert.match(s.tt('bulk', file), /T-002 added \[todo\]: B \(depends on T-001\)/);
});

test('parallel writers do not lose tasks', async (t) => {
  const s = sandbox(t);
  const n = 8;
  const codes = await Promise.all(Array.from({ length: n }, (_, i) => new Promise((resolve) => {
    spawn(process.execPath, [TT, 'add', `task ${i + 1}`], { cwd: s.proj, env: s.baseEnv, stdio: 'ignore' }).on('exit', resolve);
  })));
  assert.deepEqual(codes, Array(n).fill(0));
  const lines = s.tt('list', '--all').trim().split('\n');
  assert.equal(lines.length, n);
  assert.equal(new Set(lines.map((l) => l.split(' ')[0])).size, n);
  assert.equal(taskFiles(s).length, n);
});

test('stop hook blocks only turns that edited project files without a record', (t) => {
  const s = sandbox(t);
  s.tt('add', 'Task', '--start');
  const inside = { tool_input: { file_path: path.join(s.proj, 'src', 'a.ts') } };
  const outside = { tool_input: { file_path: path.join(os.tmpdir(), 'elsewhere', 'note.md') } };

  // A question: no edits, nothing to record.
  assert.equal(s.hook('prompt', 'A'), '');
  assert.equal(s.hook('stop', 'A'), '');

  // Edits outside the project do not count.
  s.hook('prompt', 'A');
  s.hook('edit', 'A', outside);
  assert.equal(s.hook('stop', 'A'), '');

  // An edit inside the project must be recorded.
  s.hook('prompt', 'A');
  assert.equal(s.hook('edit', 'A', inside), '');
  assert.match(s.hook('stop', 'A'), /"decision":"block".*Files changed this turn/);
  assert.equal(s.hook('stop', 'A', { stop_hook_active: true }), '');
  s.tt('log', 'T-1', 'changed a.ts');
  assert.equal(s.hook('stop', 'A'), '');

  // skip also settles the turn.
  s.hook('prompt', 'A');
  s.hook('edit', 'A', inside);
  s.tt('skip');
  assert.equal(s.hook('stop', 'A'), '');
});

test('prompt hook reminds only after an unrecorded editing turn', (t) => {
  const s = sandbox(t);
  const inside = { tool_input: { file_path: path.join(s.proj, 'a.ts') } };
  assert.equal(s.hook('prompt', 'A'), '');
  assert.equal(s.hook('prompt', 'A'), '', 'a read-only turn needs no reminder');
  s.hook('edit', 'A', inside);
  assert.match(s.hook('prompt', 'A'), /last turn changed files but recorded nothing/);
  assert.equal(s.hook('prompt', 'A'), '', 'the reminder is printed once');
});

test('turn markers are per session', (t) => {
  const s = sandbox(t);
  s.tt('add', 'Task', '--start');
  const inside = { tool_input: { file_path: path.join(s.proj, 'a.ts') } };
  s.hook('prompt', 'A');
  s.hook('edit', 'A', inside);
  // Session B starts a turn and records work; that must neither excuse nor disturb session A.
  s.hook('prompt', 'B');
  assert.equal(s.run(['log', 'T-1', 'from B'], { session: 'B' }).status, 0);
  assert.equal(s.hook('stop', 'B'), '');
  assert.match(s.hook('stop', 'A'), /"decision":"block"/);
  assert.equal(s.run(['log', 'T-1', 'from A'], { session: 'A' }).status, 0);
  assert.equal(s.hook('stop', 'A'), '');
});

test('hooks stay silent in untracked and paused folders', (t) => {
  const s = sandbox(t);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-untracked-'));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  const r = s.run(['hook', 'session-start'], { input: JSON.stringify({ cwd: other }) });
  assert.equal(r.stdout, '');
  assert.match(s.hook('session-start', 'A'), /^\[task-tracker\] "demo": 0 open, 0 done/);
  s.tt('off');
  assert.equal(s.hook('session-start', 'A'), '');
});

test('open tasks are listed in numeric id order', (t) => {
  const s = sandbox(t);
  const indexFile = path.join(s.base, 'index.json');
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  index.nextId = 999;
  fs.writeFileSync(indexFile, JSON.stringify(index));
  s.tt('add', 'before');
  s.tt('add', 'after');
  assert.deepEqual(s.tt('list').trim().split('\n'), ['T-999 [todo] before', 'T-1000 [todo] after']);
});
