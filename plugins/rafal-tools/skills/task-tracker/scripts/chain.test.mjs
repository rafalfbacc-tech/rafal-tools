import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseList, agentOf, decide, buildTasks, buildAgentCommand, buildPrompt, buildBrief,
  pickGroup, parseDataDir, runLoop, toSlug,
} from './chain-lib.mjs';

const TT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tt.mjs');
const task = (id, status, title = 'Stage [sonnet]: X', waits = false, group = 'chain: X') => ({ id, status, title, waits, group });
const none = () => false;

test('parseList reads status, group, title and waiting state', () => {
  const out = [
    'T-001 [done] {chain: X} First [opus]',
    'T-002 [todo] {chain: X} Second [codex] — WAITS FOR T-001',
    'T-003 [todo] No group — next: step',
  ].join('\n');
  assert.deepEqual(parseList(out), [
    { id: 'T-001', status: 'done', group: 'chain: X', title: 'First [opus]', waits: false },
    { id: 'T-002', status: 'todo', group: 'chain: X', title: 'Second [codex]', waits: true },
    { id: 'T-003', status: 'todo', group: '', title: 'No group', waits: false },
  ]);
});

test('agentOf returns the first role tag and null when missing', () => {
  assert.equal(agentOf('Tests [haiku]: Name [opus]'), 'haiku');
  assert.equal(agentOf('Fix without a role'), null);
});

test('decide proposes the first ready task', () => {
  const d = decide([task('T-1', 'done'), task('T-2', 'todo'), task('T-3', 'todo', 'x', true)], new Set(), none);
  assert.equal(d.kind, 'propose');
  assert.equal(d.task.id, 'T-2');
});

test('decide stops on a blocked task before proposing others', () => {
  const d = decide([task('T-1', 'blocked'), task('T-2', 'todo')], new Set(), none);
  assert.equal(d.kind, 'blocked');
  assert.equal(d.task.id, 'T-1');
});

test('decide waits for a launched agent that is still running', () => {
  assert.equal(decide([task('T-1', 'in-progress')], new Set(['T-1']), none).kind, 'wait');
});

test('decide reports an agent that exited without finishing', () => {
  assert.equal(decide([task('T-1', 'in-progress')], new Set(['T-1']), () => true).kind, 'aborted');
});

test('decide flags in-progress work this process did not launch', () => {
  assert.equal(decide([task('T-1', 'in-progress')], new Set(), none).kind, 'orphan');
});

test('decide finishes when everything is done', () => {
  assert.equal(decide([task('T-1', 'done')], new Set(), none).kind, 'finished');
});

test('decide reports stuck when open tasks only wait on outside work', () => {
  assert.equal(decide([task('T-1', 'todo', 'x', true)], new Set(), none).kind, 'stuck');
});

test('buildTasks creates the eight-stage chain in order, in English', () => {
  const tasks = buildTasks('Error page', 'Task description');
  assert.deepEqual(tasks.map((t) => agentOf(t.title)),
    ['opus', 'codex', 'opus', 'sonnet', 'haiku', 'codex', 'sonnet', 'opus']);
  assert.deepEqual(tasks[0].deps ?? [], []);
  tasks.slice(1).forEach((t, i) => assert.deepEqual(t.deps, [`#${i + 1}`]));
  assert.ok(tasks.every((t) => t.group === 'chain: Error page'));
  assert.match(tasks[0].title, /^Assumptions \[opus\]/);
  assert.match(tasks[0].goal, /Task description/);
  assert.match(tasks[0].goal, /docs\/chain\/error-page\/assumptions\.md/);
});

test('toSlug makes a safe folder name', () => {
  assert.equal(toSlug('Strona błędu: v2!'), 'strona-bledu-v2');
});

const paths = { selfPath: 'C:/a/chain.mjs', ttPath: 'C:/a/tt.mjs' };

test('buildAgentCommand keeps the prompt before variadic Claude options and allows only the tracker', () => {
  const cmd = buildAgentCommand('haiku', { prompt: 'Do it', dataDir: 'C:/d', ...paths });
  assert.equal(cmd, 'claude "Do it" --model haiku --allowedTools "Bash(node C:/a/chain.mjs *)" "Bash(node C:/a/tt.mjs *)" "Bash(node \\"C:/a/tt.mjs\\" *)"');
  assert.doesNotMatch(cmd, /dangerously/);
});

test('buildTasks separates the task description from the next sentence', () => {
  assert.match(buildTasks('X', 'A test')[0].goal, /Task description: A test\. Save them/);
  assert.match(buildTasks('X', 'Is it done?')[0].goal, /Is it done\? Save them/);
});

test('buildAgentCommand gives Codex write access only to the tracker data', () => {
  const cmd = buildAgentCommand('codex', { prompt: 'Do it', dataDir: 'C:/my data', ...paths });
  assert.equal(cmd, 'codex "Do it" --add-dir "C:/my data"');
});

test('buildAgentCommand refuses script paths with spaces, which permission rules cannot match', () => {
  assert.throws(() => buildAgentCommand('haiku', { prompt: 'x', dataDir: 'd', selfPath: 'C:/a b/chain.mjs', ttPath: 'C:/a/tt.mjs' }), /space/);
});

test('buildPrompt has no characters that break cmd.exe quoting', () => {
  const prompt = buildPrompt('T-5', 'C:/a/chain.mjs');
  assert.doesNotMatch(prompt, /["%&|<>^]/);
  assert.match(prompt, /node C:\/a\/chain\.mjs brief T-5/);
});

test('buildBrief includes the task and exact finishing commands', () => {
  const brief = buildBrief({ id: 'T-5', show: '## Goal\nDo it', ttPath: 'C:/a/tt.mjs' });
  assert.match(brief, /## Goal\nDo it/);
  assert.match(brief, /node C:\/a\/tt\.mjs done T-5 --summary/);
  assert.match(brief, /node C:\/a\/tt\.mjs status T-5 blocked --note/);
});

test('brief commands match a Claude permission rule literally', () => {
  const rules = [...buildAgentCommand('haiku', { prompt: 'x', dataDir: 'd', ...paths }).matchAll(/Bash\((.+?) \*\)/g)].map((m) => m[1]);
  const brief = buildBrief({ id: 'T-5', show: 'x', ttPath: paths.ttPath });
  const commands = brief.split('\n').filter((l) => /: node \S+ (done|status) /.test(l)).map((l) => l.slice(l.indexOf('node ')));
  assert.equal(commands.length, 2);
  for (const command of commands) assert.ok(rules.some((rule) => command.startsWith(`${rule} `)), command);
});

test('brief tells the agent to use only that form of the tracker command', () => {
  assert.match(buildBrief({ id: 'T-5', show: 'x', ttPath: paths.ttPath }), /even when a hook/i);
});

test('pickGroup selects by name, or the only open chain, and rejects ambiguity', () => {
  const tasks = [task('T-1', 'todo', 'x', false, 'chain: A'), task('T-2', 'done', 'x', false, 'chain: B'), task('T-3', 'todo', 'x', false, 'other')];
  assert.equal(pickGroup(tasks), 'chain: A');
  assert.equal(pickGroup(tasks, 'B'), 'chain: B');
  assert.throws(() => pickGroup(tasks, 'Missing'), /Missing/);
  assert.throws(() => pickGroup([...tasks, task('T-4', 'todo', 'x', false, 'chain: C')]), /chain: A.*chain: C/s);
  assert.throws(() => pickGroup([]), /chain new/);
});

test('parseDataDir reads the folder from tt config output', () => {
  assert.equal(parseDataDir('Config file : C:/x\nData folder : C:/my data/home  (from config file C:/x)\nBoard : y'), 'C:/my data/home');
});

// --- The real tracker, on temporary data ---

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-it-'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const env = { ...process.env, TASK_TRACKER_HOME: path.join(root, 'home') };
  const tt = (...args) => execFileSync('node', [TT, ...args], { cwd: proj, env, encoding: 'utf8' });
  tt('init', '.', '--name', 'IT');
  return { root, proj, env, tt };
}

function seed(s, count = 8) {
  const file = path.join(s.root, 't.json');
  fs.writeFileSync(file, JSON.stringify(buildTasks('IT', '').slice(0, count)));
  s.tt('bulk', file);
}

function loop(s, overrides = {}) {
  const logs = [];
  const questions = [];
  const launched = [];
  const deps = {
    list: () => parseList(s.tt('list', '--all')).filter((t) => t.group === 'chain: IT'),
    start: (id) => s.tt('start', id),
    show: (id) => s.tt('show', id),
    launch: (t) => { launched.push(t.id); s.tt('done', t.id, '--summary', 'finished'); },
    hasExited: () => false,
    clearExit: () => {},
    ask: async (q) => { questions.push(q); return 'y'; },
    sleep: async () => {},
    log: (m) => logs.push(m),
    tt: 'tt',
    ...overrides,
  };
  return { deps, logs, questions, launched };
}

test('the tracker forwards the chain command', () => {
  const s = sandbox();
  const out = s.tt('chain', 'new', 'IT', 'A description');
  assert.match(out, /T-008 added/);
  assert.match(s.tt('list', '--all'), /Assumptions \[opus\]: IT/);
  assert.match(s.tt('show', 'T-001'), /A description/);
  fs.rmSync(s.root, { recursive: true });
});

test('tt help and usage document the chain command', () => {
  const s = sandbox();
  assert.match(s.tt('help'), /chain new/);
  assert.match(s.tt('usage'), /chain run/);
  fs.rmSync(s.root, { recursive: true });
});

test('runLoop walks a real tracker chain, asking before every stage', async () => {
  const s = sandbox();
  seed(s);
  const l = loop(s);
  assert.equal(await runLoop(l.deps), 0);
  assert.equal(l.launched.length, 8);
  assert.equal(l.questions.length, 8);
  assert.match(l.questions[1], /T-002.*\[codex\]/);
  assert.ok(l.logs.some((m) => /T-001 done/.test(m)));
  fs.rmSync(s.root, { recursive: true });
});

test('runLoop does not launch the next stage when the user declines', async () => {
  const s = sandbox();
  seed(s);
  const l = loop(s, { ask: async () => 'n' });
  assert.equal(await runLoop(l.deps), 1);
  assert.equal(l.launched.length, 0);
  assert.match(s.tt('show', 'T-001'), /\*\*Status:\*\* todo/);
  fs.rmSync(s.root, { recursive: true });
});

test('runLoop stops with the reason when an agent marks the task blocked', async () => {
  const s = sandbox();
  seed(s);
  const l = loop(s, { launch: (t) => { l.launched.push(t.id); s.tt('status', t.id, 'blocked', '--note', 'no access'); } });
  assert.equal(await runLoop(l.deps), 1);
  assert.equal(l.launched.length, 1);
  assert.ok(l.logs.some((m) => /no access/.test(m)));
  fs.rmSync(s.root, { recursive: true });
});

test('runLoop offers a restart when the agent exits without finishing', async () => {
  const s = sandbox();
  seed(s, 1);
  let exited = false;
  const launches = [];
  const l = loop(s, {
    launch: (t) => {
      launches.push(t.id);
      if (launches.length === 1) exited = true; else s.tt('done', t.id, '--summary', 'ok');
    },
    hasExited: () => exited,
    clearExit: () => { exited = false; },
  });
  assert.equal(await runLoop(l.deps), 0);
  assert.deepEqual(launches, ['T-001', 'T-001']);
  assert.match(l.questions[1], /without/);
  fs.rmSync(s.root, { recursive: true });
});

test('runLoop refuses a task without a role tag instead of guessing a model', async () => {
  const s = sandbox();
  s.tt('add', 'Fix without a role', '--group', 'chain: IT');
  const l = loop(s);
  assert.equal(await runLoop(l.deps), 1);
  assert.equal(l.launched.length, 0);
  assert.ok(l.logs.some((m) => /T-001.*role/i.test(m)));
  fs.rmSync(s.root, { recursive: true });
});
