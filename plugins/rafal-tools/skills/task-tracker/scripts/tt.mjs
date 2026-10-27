#!/usr/bin/env node
// task-tracker CLI: central task storage for many projects, kept outside the repos.
// Data folder (registry, tasks, board): $TASK_TRACKER_HOME, else "dataDir" in ~/.claude/task-tracker.config.json,
// else ~/.claude/task-tracker. Run `node tt.mjs help` (CLI reference) or `usage` (overview for users).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const STATUSES = ['todo', 'in-progress', 'blocked', 'done'];
const SCRIPT = fileURLToPath(import.meta.url).replace(/\\/g, '/');
const SKILL_DIR = path.dirname(path.dirname(SCRIPT));
const TT = `node "${SCRIPT}"`;
const USER_CONFIG = path.join(os.homedir(), '.claude', 'task-tracker.config.json');
const DEFAULT_HOME = path.join(os.homedir(), '.claude', 'task-tracker');
const SCAN_SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'vendor', '.next', 'coverage',
  'target', '.venv', 'venv', '__pycache__', 'bin', 'obj', '.idea', '.vscode']);

// ---------- helpers ----------
const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const slash = (p) => p.replace(/\\/g, '/');
const normPath = (p) => {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

function die(msg) {
  console.error(`tt: ${msg}`);
  process.exit(1);
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
const writeJson = (file, obj) => writeAtomic(file, JSON.stringify(obj, null, 2) + '\n');

// ---------- data location (config) ----------
function readUserConfig() {
  try {
    return JSON.parse(fs.readFileSync(USER_CONFIG, 'utf8'));
  } catch {
    return {};
  }
}

const HOME_SOURCE = process.env.TASK_TRACKER_HOME
  ? 'TASK_TRACKER_HOME environment variable'
  : readUserConfig().dataDir ? `config file ${slash(USER_CONFIG)}` : 'default location';
let HOME, REGISTRY, BOARD;
let registryCache = null; // see loadRegistry()
function setHome(dir) {
  HOME = path.resolve(dir);
  REGISTRY = path.join(HOME, 'registry.json');
  BOARD = path.join(HOME, 'board.html');
  registryCache = null;
}
setHome(process.env.TASK_TRACKER_HOME || readUserConfig().dataDir || DEFAULT_HOME);

const countFiles = (dir) =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;

// ---------- registry / project context ----------
// Read once per process: dependency resolution looks projects up many times (also inside sorts).
const loadRegistry = () => (registryCache ??= readJson(REGISTRY, { version: 1, projects: [] }));
const saveRegistry = (reg) => {
  writeJson(REGISTRY, reg);
  registryCache = reg;
};

// Nearest registered project folder at or above `start`.
function findProject(start = process.cwd()) {
  const reg = loadRegistry();
  const byPath = new Map(reg.projects.map((p) => [normPath(p.path), p]));
  let d = path.resolve(start);
  for (;;) {
    const hit = byPath.get(normPath(d));
    if (hit) return hit;
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

function ctxFor(project) {
  const base = path.join(HOME, 'projects', project.slug);
  return {
    project,
    root: project.path,
    base,
    configFile: path.join(base, 'config.json'),
    indexFile: path.join(base, 'index.json'),
    tasksDir: path.join(base, 'tasks'),
    archiveDir: path.join(base, 'archive'),
    boardStub: path.join(base, 'board.html'),
  };
}

function ctx() {
  const p = findProject();
  if (!p) die('this folder is not tracked. Run `init [dir]` first.');
  return ctxFor(p);
}

function load(c) {
  const index = readJson(c.indexFile, { version: 1, nextId: 1, tasks: [] });
  INDEX_SLUG.set(index, c.project.slug);
  INDEX_CACHE.set(c.project.slug, index);
  return { config: readJson(c.configFile, {}), index };
}

function taskFile(c, id) {
  const open = path.join(c.tasksDir, `${id}.md`);
  const arch = path.join(c.archiveDir, `${id}.md`);
  return fs.existsSync(arch) && !fs.existsSync(open) ? arch : open;
}

function normId(id) {
  if (!id) die('missing task id');
  const m = String(id).match(/^T?-?(\d+)$/i);
  return m ? `T-${m[1].padStart(3, '0')}` : String(id);
}

function getTask(index, id) {
  id = normId(id);
  const t = index.tasks.find((x) => x.id === id);
  if (!t) die(`no task ${id}`);
  return t;
}

// On/off flags never take a value, so `start --force T-003` keeps T-003 as the task id.
const BOOLEAN_FLAGS = new Set(['force', 'all', 'ready', 'items', 'full', 'keep-old', 'archived']);

// Parse argv into positionals and --flags (repeatable flags become arrays). A bare `--` ends the
// flags, so text that starts with "--" can still be passed: `log T-1 -- "--verbose fixed"`.
function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = !BOOLEAN_FLAGS.has(key) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      if (key in flags) flags[key] = [].concat(flags[key], val);
      else flags[key] = val;
    } else pos.push(a);
  }
  return { pos, flags };
}

const asList = (v) => (v === undefined || v === true ? [] : [].concat(v));

// ---------- dependencies ----------
// A stored dep is "T-004" (same project) or "<slug>:T-004" (another tracked project).
// load() remembers which project each index belongs to, so deps resolve relative to their owner.
const INDEX_SLUG = new WeakMap();
const INDEX_CACHE = new Map();
const depsOf = (t) => t.deps || [];
const findTask = (index, id) => index.tasks.find((x) => x.id === id);

function indexForSlug(slug) {
  if (!INDEX_CACHE.has(slug)) {
    const p = loadRegistry().projects.find((x) => x.slug === slug);
    if (p) load(ctxFor(p));
    else INDEX_CACHE.set(slug, null);
  }
  return INDEX_CACHE.get(slug);
}

function resolveDep(index, ref) {
  const own = INDEX_SLUG.get(index);
  const i = ref.indexOf(':');
  const slug = i < 0 ? own : ref.slice(0, i);
  const id = i < 0 ? ref : ref.slice(i + 1);
  const ix = slug === own ? index : indexForSlug(slug);
  const project = loadRegistry().projects.find((p) => p.slug === slug);
  const label = slug === own ? id : `${project ? project.name : slug}:${id}`;
  return { slug, id, key: `${slug}:${id}`, label, index: ix, task: ix ? findTask(ix, id) : undefined };
}

// User input -> stored form. Accepts "T-4", "4", or "<project slug|name|folder>:T-4".
// `lenient` keeps refs to projects that are no longer tracked (needed to remove stale deps).
function normDep(ref, ownSlug, lenient = false) {
  const s = String(ref).trim();
  const i = s.lastIndexOf(':');
  if (i <= 0 || /^[a-z]:[\/]/i.test(s)) return normId(s);
  const proj = s.slice(0, i).toLowerCase();
  const p = loadRegistry().projects.find((x) =>
    [x.slug, x.name, path.basename(x.path)].some((n) => String(n).toLowerCase() === proj));
  if (!p && lenient) return `${proj}:${normId(s.slice(i + 1))}`;
  if (!p) die(`unknown project "${s.slice(0, i)}" in dependency ${s} (see \`projects\`)`);
  return p.slug === ownSlug ? normId(s.slice(i + 1)) : `${p.slug}:${normId(s.slice(i + 1))}`;
}

// Unfinished dependencies of `t`, as resolved refs. Archived tasks never hold anything up.
function waitingOn(index, t) {
  return depsOf(t).map((d) => resolveDep(index, d)).filter((r) => r.task && !r.task.archived && r.task.status !== 'done');
}
const waitLabels = (index, t) => waitingOn(index, t).map((r) => r.label);

// "T-005 Title", prefixed with the project name when it lives in another project than `ownIndex`.
function depTaskLabel(ownIndex, { index, task }) {
  if (index === ownIndex) return `${task.id} ${task.title}`;
  const p = loadRegistry().projects.find((x) => x.slug === INDEX_SLUG.get(index));
  return `${p ? p.name : INDEX_SLUG.get(index)}:${task.id} ${task.title}`;
}

// Tasks in any tracked project that depend on task `id` of the project owning `index`: [{index, task}].
// Archived dependents are left out.
function dependents(index, id) {
  const own = INDEX_SLUG.get(index);
  const out = index.tasks.filter((t) => !t.archived && depsOf(t).includes(id)).map((task) => ({ index, task }));
  for (const p of loadRegistry().projects) {
    if (p.slug === own) continue;
    const ix = indexForSlug(p.slug);
    if (ix) ix.tasks.filter((t) => !t.archived && depsOf(t).includes(`${own}:${id}`)).forEach((task) => out.push({ index: ix, task }));
  }
  return out;
}

// True when `dep` already depends (transitively, across projects) on task `id`.
function wouldCycle(index, id, dep) {
  const target = `${INDEX_SLUG.get(index)}:${id}`;
  const seen = new Set();
  const stack = [{ index, ref: dep }];
  while (stack.length) {
    const { index: ix, ref } = stack.pop();
    const r = resolveDep(ix, ref);
    if (r.key === target) return true;
    if (seen.has(r.key) || !r.task) continue;
    seen.add(r.key);
    depsOf(r.task).forEach((d) => stack.push({ index: r.index, ref: d }));
  }
  return false;
}

function checkDeps(index, id, deps) {
  const self = `${INDEX_SLUG.get(index)}:${id}`;
  for (const d of deps) {
    const r = resolveDep(index, d);
    if (r.key === self) die(`${id} cannot depend on itself`);
    if (!r.task) die(`${id}: dependency ${r.label} does not exist`);
    if (r.task.archived) die(`${id}: dependency ${r.label} is archived (unarchive it first)`);
    if (wouldCycle(index, id, d)) die(`${id} -> ${r.label} would create a dependency cycle`);
  }
}

function depsMeta(deps) {
  return deps.length ? deps.join(', ') : '-';
}

const str = (v) => (typeof v === 'string' ? v : '');

// ---------- markdown section editing ----------
// User text is always inserted through replacer functions: a replacement *string* would expand
// `$1`, `$&`, `$'` and `$$` inside task text and corrupt the file.
function setSection(md, name, body) {
  const re = new RegExp(`(## ${name}\\n)([\\s\\S]*?)(?=\\n## |$)`);
  if (re.test(md)) return md.replace(re, (_, head) => `${head}${body.trimEnd()}\n`);
  return `${md.trimEnd()}\n\n## ${name}\n${body.trimEnd()}\n`;
}

function getSection(md, name) {
  const m = md.match(new RegExp(`## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`));
  return m ? m[1].trim() : '';
}

function appendToSection(md, name, line) {
  const cur = getSection(md, name).replace(/^<!--[\s\S]*?-->\s*/, '');
  return setSection(md, name, cur ? `${cur}\n${line}` : line);
}

function setMeta(md, key, value) {
  const re = new RegExp(`^- \\*\\*${key}:\\*\\* .*$`, 'm');
  return re.test(md) ? md.replace(re, () => `- **${key}:** ${value}`) : md;
}

// Like setMeta, but inserts the line after **Group:** in files created before the key existed.
function upsertMeta(md, key, value) {
  const re = new RegExp(`^- \\*\\*${key}:\\*\\* .*$`, 'm');
  if (re.test(md)) return md.replace(re, () => `- **${key}:** ${value}`);
  return md.replace(/^(- \*\*Group:\*\* .*)$/m, (group) => `${group}\n- **${key}:** ${value}`);
}

// Only newly added deps are normalized and validated, so a dep on a since-removed project or task
// never blocks editing the task's other dependencies.
function setDeps(c, index, t, deps) {
  const existing = depsOf(t);
  deps = [...new Set(deps.map((d) => (existing.includes(d) ? d : normDep(d, c.project.slug))))];
  checkDeps(index, t.id, deps.filter((d) => !existing.includes(d)));
  if (deps.length) t.deps = deps;
  else delete t.deps;
  t.updated = now();
  editTaskFile(c, t, (md) => upsertMeta(md, 'Depends on', depsMeta(deps)));
}

function taskTemplate(t, goal) {
  const next = t.status === 'done'
    ? '- (none — task done)'
    : t.next.length ? t.next.map((s) => `- ${s}`).join('\n') : '- (none yet)';
  return `# ${t.id}: ${t.title}

- **Status:** ${t.status}
- **Group:** ${t.group || '-'}
- **Depends on:** ${depsMeta(depsOf(t))}
- **Source:** ${t.source || '-'}
- **Created:** ${t.created}
- **Updated:** ${t.updated}

## Goal
${goal || '(describe the expected outcome / acceptance criteria)'}
${t.summary ? `\n## Work done\n${t.summary}\n` : ''}
## Next steps
${next}

## Notes
<!-- durable context: decisions, touched files, commands, gotchas -->

## Progress log
- ${t.created} — ${t.source ? `Imported from ${t.source} as ${t.status}` : 'Created'}
`;
}

// ---------- mutations ----------
function mutate(c, fn) {
  const { config, index } = load(c);
  const out = fn(index, config);
  writeJson(c.indexFile, index);
  touchActivity(c);
  render();
  return out;
}

function touchActivity(c) {
  writeAtomic(path.join(c.base, '.activity'), now());
}

function editTaskFile(c, t, fn) {
  const file = taskFile(c, t.id);
  let md = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : taskTemplate(t, '');
  md = fn(md);
  md = setMeta(md, 'Status', t.status);
  md = setMeta(md, 'Updated', t.updated);
  writeAtomic(file, md);
}

function moveForStatus(c, t) {
  const open = path.join(c.tasksDir, `${t.id}.md`);
  const arch = path.join(c.archiveDir, `${t.id}.md`);
  fs.mkdirSync(c.archiveDir, { recursive: true });
  fs.mkdirSync(c.tasksDir, { recursive: true });
  if (t.status === 'done' && fs.existsSync(open)) fs.renameSync(open, arch);
  if (t.status !== 'done' && fs.existsSync(arch) && !fs.existsSync(open)) fs.renameSync(arch, open);
}

function addTask(c, index, { title, goal, group, next, status, summary, source, deps }) {
  if (!title) die('missing title');
  status = status || 'todo';
  if (!STATUSES.includes(status)) die(`bad status "${status}" (use ${STATUSES.join(', ')})`);
  const id = `T-${String(index.nextId).padStart(3, '0')}`;
  deps = [...new Set((deps || []).map((d) => normDep(d, c.project.slug)))];
  checkDeps(index, id, deps);
  index.nextId++;
  const ts = now();
  const t = {
    id, title, status, group: group || '', created: ts, updated: ts,
    next: status === 'done' ? [] : next || [],
    // Tasks created as done come from an import; the board keeps them out of the activity chart.
    ...(status === 'done' ? { completed: ts, imported: true } : {}),
    ...(summary ? { summary } : {}),
    ...(source ? { source } : {}),
    ...(deps.length ? { deps } : {}),
  };
  index.tasks.push(t);
  writeAtomic(path.join(status === 'done' ? c.archiveDir : c.tasksDir, `${id}.md`), taskTemplate(t, goal));
  return t;
}

const sameTask = (a, b) =>
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase() && (a.group || '') === (b.group || '');

// ---------- output ----------
function compactLine(t, index) {
  const next = t.next && t.next.length ? ` — next: ${t.next[0]}${t.next.length > 1 ? ` (+${t.next.length - 1})` : ''}` : '';
  const group = t.group ? ` {${t.group}}` : '';
  const waits = t.status !== 'done' && index ? waitLabels(index, t) : [];
  const dep = waits.length ? ` — WAITS FOR ${waits.join(', ')}` : '';
  return `${t.id} [${t.status}${t.archived ? ', archived' : ''}]${group} ${t.title}${dep}${next}`;
}

// Open tasks, most actionable first: in-progress, blocked, ready todo, then todo waiting on dependencies.
// Archived tasks are hidden everywhere except `list --all|--archived` and `show`.
function openTasks(index) {
  const rank = (t) =>
    t.status === 'in-progress' ? 0 : t.status === 'blocked' ? 1 : waitingOn(index, t).length ? 3 : 2;
  return index.tasks
    .filter((t) => t.status !== 'done' && !t.archived)
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

const isReady = (index, t) => t.status === 'todo' && !t.archived && !waitingOn(index, t).length;
const doneCount = (index) => index.tasks.filter((t) => t.status === 'done' && !t.archived).length;
const archivedNote = (index) => {
  const n = index.tasks.filter((t) => t.archived).length;
  return n ? `, ${n} archived` : '';
};

// Max open tasks listed at session start / `resume` ("resumeLimit" in the config file).
// In-progress and blocked tasks are always listed; only todo tasks are cut.
const DEFAULT_RESUME_LIMIT = 5;
function resumeLimit() {
  const n = Number(readUserConfig().resumeLimit);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_RESUME_LIMIT;
}

// Kept short on purpose: it is injected into every session start.
function resumeText(c, index, config, all = false) {
  const open = openTasks(index);
  const shown = all ? open : open.slice(0, Math.max(resumeLimit(), open.filter((t) => t.status !== 'todo').length));
  const lines = [
    `[task-tracker] "${config.project}": ${open.length} open, ${doneCount(index)} done${archivedNote(index)}. CLI: ${TT}`,
    ...shown.map((t) => `  ${compactLine(t, index)}`),
  ];
  if (open.length > shown.length) lines.push(`  +${open.length - shown.length} more todo (resume --all)`);
  lines.push('Resume: `show <ID>` of ONE task only; skip tasks that WAIT FOR others.');
  return lines.join('\n');
}

// ---------- board (one file for all projects) ----------
const TEMPLATE = path.join(SKILL_DIR, 'templates', 'board.html');
const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(SKILL_DIR, '..', '..', '.claude-plugin', 'plugin.json'), 'utf8')).version || '0';
  } catch {
    return '0';
  }
})();

const cmpVersion = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

// Plugin version stamped into the existing board, or null when there is no board yet.
function boardVersion() {
  if (!fs.existsSync(BOARD)) return null;
  const fd = fs.openSync(BOARD, 'r');
  const buf = Buffer.alloc(200);
  fs.readSync(fd, buf, 0, 200, 0);
  fs.closeSync(fd);
  const m = buf.toString('utf8').match(/tt-version: ([\d.]+)/);
  return m ? m[1] : '0';
}

// Re-render when the board is missing, was made by an older plugin version, or predates the template.
function renderIfStale() {
  const v = boardVersion();
  if (v === null || cmpVersion(PLUGIN_VERSION, v) > 0 || fs.statSync(TEMPLATE).mtimeMs > fs.statSync(BOARD).mtimeMs) render();
}

function render() {
  // A session still running an older plugin copy must not overwrite a board made by a newer one.
  const v = boardVersion();
  if (v && cmpVersion(v, PLUGIN_VERSION) > 0) return;
  const reg = loadRegistry();
  const projects = reg.projects.map((p) => {
    const c = ctxFor(p);
    const { config, index } = load(c);
    const tasks = index.tasks.map((t) => {
      const f = taskFile(c, t.id);
      return { ...t, body: fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '' };
    });
    return { slug: p.slug, name: config.project || p.name, path: slash(p.path), enabled: config.enabled !== false, tasks };
  });
  // `cli` lets the board offer copyable archive/unarchive commands.
  const data = { generated: now(), cli: SCRIPT, projects };
  const tpl = fs.readFileSync(TEMPLATE, 'utf8');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = tpl.replace('/*__DATA__*/null', () => json).replace(/^<!doctype html>/i, (d) => `${d}\n<!-- tt-version: ${PLUGIN_VERSION} -->`);
  writeAtomic(BOARD, html);
}

// Per-project bookmark that opens the shared board filtered to that project.
function writeStub(c) {
  writeAtomic(c.boardStub, `<!doctype html><meta charset="utf-8"><title>${c.project.name}</title>` +
    `<meta http-equiv="refresh" content="0;url=../../board.html#${c.project.slug}">`);
}

// ---------- scan (cheap overview of md files for import) ----------
function walkMd(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SCAN_SKIP.has(e.name)) walkMd(path.join(dir, e.name), out);
    } else if (/\.(md|markdown)$/i.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

function scan(dir, { items, limit }) {
  dir = path.resolve(dir);
  if (!fs.existsSync(dir)) die(`no such directory: ${dir}`);
  const files = walkMd(dir).sort();
  const boxRe = /^\s*(?:[-*+]|\d+\.)\s+\[( |x|X)\]\s+(.*)$/;
  const statusRe = /\bstatus\b\**\s*[:\-–]\s*\**\s*([a-z][a-z -]{1,20})/i;
  const rows = [];
  let open = 0;
  for (const f of files.slice(0, limit)) {
    const text = fs.readFileSync(f, 'utf8');
    const lines = text.split(/\r?\n/);
    let done = 0, total = 0;
    const unchecked = [];
    lines.forEach((l, i) => {
      const m = l.match(boxRe);
      if (!m) return;
      total++;
      if (m[1] === ' ') unchecked.push(`    L${i + 1}: ${m[2].slice(0, 140)}`);
      else done++;
    });
    open += total - done;
    const status = (text.match(statusRe) || [])[1];
    const headings = lines.filter((l) => /^#{1,6} /.test(l)).length;
    const mod = fs.statSync(f).mtime.toISOString().slice(0, 10);
    const rel = slash(path.relative(dir, f));
    const box = total ? `[${done}/${total} checked]` : '[no checkboxes]';
    rows.push(`${rel}  ${box}${status ? ` status:"${status.trim()}"` : ''}  headings:${headings}  ${Math.ceil(text.length / 1024)}KB  modified:${mod}`);
    if (items && unchecked.length) rows.push(...unchecked.slice(0, 25), ...(unchecked.length > 25 ? [`    … +${unchecked.length - 25} more unchecked in this file`] : []));
  }
  console.log(`Scanned ${slash(dir)}: ${files.length} markdown file(s)${files.length > limit ? `, showing first ${limit}` : ''}; ${open} unchecked item(s).`);
  console.log(rows.join('\n') || '(no markdown files)');
}

// ---------- hooks ----------
function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function hook(kind) {
  const input = readStdin();
  let c;
  try {
    const p = findProject(input.cwd || process.cwd());
    if (!p) return;
    c = ctxFor(p);
    if (load(c).config.enabled === false) return;
  } catch {
    return; // never break the session because of the tracker
  }
  const { config, index } = load(c);

  if (kind === 'session-start') {
    try { render(); } catch {}
    console.log(resumeText(c, index, config));
  } else if (kind === 'prompt') {
    const turnFile = path.join(c.base, '.turn');
    const actFile = path.join(c.base, '.activity');
    // Remind only when the previous turn recorded nothing; a diligent session pays no per-prompt tokens.
    const lastTurn = fs.existsSync(turnFile) ? fs.statSync(turnFile).mtimeMs : 0;
    const lastAct = fs.existsSync(actFile) ? fs.statSync(actFile).mtimeMs : 0;
    writeAtomic(turnFile, now());
    try { renderIfStale(); } catch {}
    if (lastAct < lastTurn) console.log('[task-tracker] Record this request as task(s): add/start/log/next/done, or skip.');
  } else if (kind === 'stop') {
    if (input.stop_hook_active) return;
    const turnFile = path.join(c.base, '.turn');
    const actFile = path.join(c.base, '.activity');
    if (!fs.existsSync(turnFile)) return;
    const turn = fs.statSync(turnFile).mtimeMs;
    const act = fs.existsSync(actFile) ? fs.statSync(actFile).mtimeMs : 0;
    if (act >= turn) return;
    console.log(
      JSON.stringify({
        decision: 'block',
        reason:
          `[task-tracker] Nothing recorded this turn. Run log/next (or done) on the task(s) you worked on, ` +
          `or skip if there was no task work. CLI: ${TT}`,
      })
    );
  }
}

// ---------- commands ----------
const HELP = () => `task-tracker CLI  (${TT} <command>)
Data: ${slash(HOME)}  (from ${HOME_SOURCE})

  usage                             Overview of everything the tracker can do (for users)
  config                            Show where data and the board live
  config set dataDir <dir>          Point the tracker at another data folder (does not move data)
  config set resumeLimit <n>        How many tasks the session-start list shows (default 5)
  move <dir> [--keep-old]           Move all data and the board to <dir> and update the config
  init [dir] [--name "Project"]     Start tracking a folder (default: current folder)
  scan [dir] [--items] [--limit N]  Overview of markdown files: checkbox progress, status lines;
                                    --items also lists unchecked items with line numbers
  off | on                          Pause / resume tracking (data is kept)
  projects                          All tracked projects with task counts
  add "Title" [--goal ".."] [--group ".."] [--next ".."]... [--dep ID]... [--status s] [--summary ".."] [--source ".."]
  bulk <file.json> [--group ".."]   Add many tasks (skips ones whose title+group already exist):
                                    [{"title","goal","group","status","next":[..],"deps":["#1","T-004"],"summary","source"}]
                                    deps: "#n" = n-th item of the file, a task ID, or an exact task title
  dep <ID> <DEP_ID>...              Add dependencies (ID cannot start until DEP_IDs are done);
                                    another project's task: <project>:T-004 (slug, name or folder name)
  undep <ID> <DEP_ID>...            Remove dependencies
  start <ID> [--force]              Set status in-progress (refused while dependencies are unfinished)
  status <ID> <todo|in-progress|blocked|done> [--note ".."]
  done <ID> [--note ".."] [--summary ".."]   Mark done (task file moves to archive/)
  archive <ID>... | unarchive <ID>...  Hide tasks (any status) from lists and the board; archived
                                    tasks no longer hold up the tasks that depend on them
  summary <ID> "text"               Set the "Work done" description
  log <ID> "message"                Append to the progress log
  note <ID> "text"                  Append durable context to Notes
  next <ID> "step" ["step" ...]     Replace the Next steps list
  goal <ID> "text"                  Replace the Goal section
  rename <ID> "New title"
  show <ID>                         Print one task file (use this to resume a task)
  resume [--all]                    Compact list of open tasks (todo capped at resumeLimit unless --all)
  list [--all|--ready|--archived]   List tasks (open only; --all everything; --ready startable todo)
  skip                              Mark this turn as needing no task update
  render                            Rebuild the board
  open                              Open the board (filtered to this project when inside one)
  hook <session-start|prompt|stop>  Used by Claude Code hooks`;

// User-facing overview, shown when the skill is invoked without arguments.
function usageText() {
  const reg = loadRegistry();
  const here = findProject();
  let hereLine = 'This folder: not tracked.';
  if (here) {
    const { config, index } = load(ctxFor(here));
    const open = openTasks(index);
    hereLine = `This folder: tracked as "${config.project}"${config.enabled === false ? ' (paused)' : ''}; ` +
      `${open.length} open (${open.filter((t) => t.status === 'in-progress').length} in progress, ` +
      `${open.filter((t) => isReady(index, t)).length} ready), ${doneCount(index)} done${archivedNote(index)}.`;
  }
  return `TASK TRACKER — what you can do

Status
  Data and board : ${slash(HOME)}  (from ${HOME_SOURCE})
  Board file     : ${slash(BOARD)}
  Projects       : ${reg.projects.length} tracked${reg.projects.length ? ` — ${reg.projects.map((p) => p.name).join(', ')}` : ''}
  ${hereLine}

Start tracking
  "track this"                       Track the current folder; existing markdown plans are imported
                                     (unfinished work -> open tasks, finished work -> done with a summary)
  "track C:\\path\\to\\project"         Track another folder
  "stop tracking" / "resume tracking" Pause or resume (data is kept)

Work and resume
  "continue" / "where were we"       Resume the current in-progress task
  "resume T-003" / "start T-005"     Resume or start a specific task
  "T-004 is unblocked: <reason>"     Move a blocked task back to work
  "what is left?" / "what is ready?" Open tasks / tasks whose dependencies are done
  "progress in all projects"         Cross-project overview
  "archive T-003" / "unarchive T-003" Hide a task (it stops holding up its dependents) / restore it

Dependencies
  "T-005 depends on T-004"           Same project
  "T-005 depends on shop:T-002"      Task in another tracked project (project name or folder name)
  Waiting tasks are not started early; finishing a task announces what became ready.

Board
  "open the board"                   Kanban board with charts, all projects, resume commands;
                                     columns collapse, "Show archive" reveals archived tasks
  "where is the board?"              Show the data folder and config
  "move the board to D:\\Sync\\tasks"  Move all data + board and update the config

CLI reference: ${TT} help`;
}

// `show` output goes straight into Claude's context, so drop what carries no information:
// HTML comments, empty metadata, empty sections, and all but the last few progress-log entries.
const SHOW_LOG_ENTRIES = 5;
function compactTaskMd(md, full) {
  let out = md.replace(/<!--[\s\S]*?-->\n?/g, '').replace(/^- \*\*[^*]+:\*\* -\n/gm, '');
  if (!full) {
    const log = getSection(out, 'Progress log').split('\n').filter(Boolean);
    if (log.length > SHOW_LOG_ENTRIES)
      out = setSection(out, 'Progress log',
        [`- (${log.length - SHOW_LOG_ENTRIES} earlier entries hidden; show --full)`, ...log.slice(-SHOW_LOG_ENTRIES)].join('\n'));
  }
  return out.replace(/\n## [^\n]+\n(?=\n## |\s*$)/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function setSummary(c, t, text) {
  t.summary = text;
  editTaskFile(c, t, (md) => {
    if (/\n## Work done\n/.test(md)) return setSection(md, 'Work done', text);
    return md.replace(/\n## Next steps\n/, () => `\n## Work done\n${text}\n\n## Next steps\n`);
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);

  switch (cmd) {
    case 'init': {
      const dir = path.resolve(pos[0] || process.cwd());
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die(`no such directory: ${dir}`);
      const reg = loadRegistry();
      let p = reg.projects.find((x) => normPath(x.path) === normPath(dir));
      const existed = !!p;
      if (!p) {
        const base = path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
        const hash = crypto.createHash('sha1').update(normPath(dir)).digest('hex').slice(0, 6);
        p = { slug: `${base}-${hash}`, path: dir, name: path.basename(dir), created: now() };
        reg.projects.push(p);
      }
      if (str(flags.name)) p.name = flags.name;
      saveRegistry(reg);
      const c = ctxFor(p);
      fs.mkdirSync(c.tasksDir, { recursive: true });
      fs.mkdirSync(c.archiveDir, { recursive: true });
      const config = readJson(c.configFile, { project: p.name, path: dir, created: now() });
      if (str(flags.name)) config.project = flags.name;
      config.enabled = true;
      writeJson(c.configFile, config);
      if (!fs.existsSync(c.indexFile)) writeJson(c.indexFile, { version: 1, nextId: 1, tasks: [] });
      writeStub(c);
      if (!fs.existsSync(USER_CONFIG)) writeJson(USER_CONFIG, { resumeLimit: DEFAULT_RESUME_LIMIT });
      touchActivity(c);
      render();
      console.log(`${existed ? 'Re-enabled' : 'Started'} task tracking for "${config.project}" (${slash(dir)})`);
      console.log(`Data: ${slash(c.base)}`);
      if (!existed) console.log(`Next: import existing progress -> ${TT} scan "${slash(dir)}" --items`);
      break;
    }
    case 'usage': {
      console.log(usageText());
      break;
    }
    case 'config': {
      if (pos[0] === 'set' && pos[1] === 'resumeLimit') {
        const n = Number(pos[2]);
        if (!Number.isInteger(n) || n < 0) die('usage: config set resumeLimit <whole number >= 0>');
        const cfg = readUserConfig();
        cfg.resumeLimit = n;
        writeJson(USER_CONFIG, cfg);
        console.log(`resumeLimit set to ${n} in ${slash(USER_CONFIG)}`);
        break;
      }
      if (pos[0] === 'set') {
        if (pos[1] !== 'dataDir' || !pos[2]) die('usage: config set dataDir <dir> | config set resumeLimit <n>   (to relocate existing data use `move <dir>`)');
        const dir = path.resolve(pos[2]);
        const cfg = readUserConfig();
        cfg.dataDir = dir;
        writeJson(USER_CONFIG, cfg);
        console.log(`dataDir set to ${slash(dir)} in ${slash(USER_CONFIG)}`);
        if (!fs.existsSync(path.join(dir, 'registry.json')))
          console.log('No tracker data there yet; it is created on the next `init`. To bring existing data along, use `move` instead.');
        if (process.env.TASK_TRACKER_HOME) console.log('Warning: TASK_TRACKER_HOME is set and still overrides this setting.');
        break;
      }
      const reg = loadRegistry();
      console.log([
        `Config file : ${slash(USER_CONFIG)}${fs.existsSync(USER_CONFIG) ? '' : ' (not created yet)'}`,
        `Data folder : ${slash(HOME)}  (from ${HOME_SOURCE})`,
        `Board       : ${slash(BOARD)}${fs.existsSync(BOARD) ? '' : ' (not rendered yet)'}`,
        `Projects    : ${reg.projects.length} tracked`,
        `resumeLimit : ${resumeLimit()} tasks listed at session start (in-progress and blocked are always shown)${'resumeLimit' in readUserConfig() ? '' : ' (default)'}`,
      ].join('\n'));
      break;
    }
    case 'move': {
      if (!pos[0]) die('usage: move <new-dir> [--keep-old]');
      if (process.env.TASK_TRACKER_HOME)
        die('TASK_TRACKER_HOME is set and overrides the config. Unset it (or point it at the new folder yourself) before using move.');
      const src = HOME;
      const dst = path.resolve(pos[0]);
      const ns = normPath(src), nd = normPath(dst);
      if (ns === nd) die('the data already lives there');
      if (nd.startsWith(ns + path.sep) || ns.startsWith(nd + path.sep)) die('the new folder cannot be inside the old one, or the other way round');
      if (fs.existsSync(path.join(dst, 'registry.json'))) die(`${slash(dst)} already contains tracker data; choose an empty folder`);
      const hasData = fs.existsSync(REGISTRY);
      if (hasData) {
        fs.mkdirSync(dst, { recursive: true });
        fs.cpSync(src, dst, { recursive: true });
        const before = countFiles(src), after = countFiles(dst);
        if (after < before) die(`copy incomplete (${after}/${before} files); the old folder was left untouched`);
      }
      const cfg = readUserConfig();
      cfg.dataDir = dst;
      writeJson(USER_CONFIG, cfg);
      setHome(dst);
      if (hasData) render();
      const removed = hasData && !flags['keep-old'];
      if (removed) fs.rmSync(src, { recursive: true, force: true });
      console.log(hasData
        ? `Moved tracker data from ${slash(src)} to ${slash(dst)} (${countFiles(dst)} files).`
        : `No data at ${slash(src)}; new data will be created in ${slash(dst)}.`);
      console.log(`Config updated: ${slash(USER_CONFIG)}`);
      console.log(`Board: ${slash(BOARD)}`);
      if (hasData) console.log(removed ? 'Old folder removed.' : `Old folder kept at ${slash(src)} (--keep-old); delete it when no longer needed.`);
      break;
    }
    case 'scan': {
      const limit = Number(flags.limit) || 200;
      scan(pos[0] || (findProject()?.path ?? process.cwd()), { items: !!flags.items, limit });
      break;
    }
    case 'projects': {
      const reg = loadRegistry();
      if (!reg.projects.length) { console.log('(no tracked projects)'); break; }
      for (const p of reg.projects) {
        const { config, index } = load(ctxFor(p));
        const open = openTasks(index).length;
        const active = index.tasks.filter((t) => t.status === 'in-progress').length;
        console.log(`${config.project || p.name}${config.enabled === false ? ' (paused)' : ''} — open ${open} (in progress ${active}), done ${doneCount(index)}${archivedNote(index)} — ${slash(p.path)}`);
      }
      break;
    }
    case 'off':
    case 'on': {
      const c = ctx();
      const config = readJson(c.configFile, {});
      config.enabled = cmd === 'on';
      writeJson(c.configFile, config);
      touchActivity(c);
      render();
      console.log(`Task tracking ${config.enabled ? 'enabled' : 'paused'} for "${config.project}"`);
      break;
    }
    case 'add': {
      const c = ctx();
      const t = mutate(c, (index) =>
        addTask(c, index, {
          title: pos.join(' '),
          goal: str(flags.goal),
          group: str(flags.group),
          next: asList(flags.next),
          status: str(flags.status) || undefined,
          summary: str(flags.summary),
          source: str(flags.source),
          deps: asList(flags.dep),
        })
      );
      console.log(`${t.id} added [${t.status}]: ${t.title}${t.deps ? ` (depends on ${t.deps.join(', ')})` : ''}`);
      break;
    }
    case 'bulk': {
      const c = ctx();
      if (!pos[0]) die('usage: bulk <file.json>');
      const items = readJson(path.resolve(pos[0]));
      if (!Array.isArray(items)) die('bulk file must contain a JSON array');
      items.forEach((it, i) => {
        if (!it || typeof it.title !== 'string' || !it.title.trim()) die(`item ${i + 1}: missing title`);
      });
      const results = mutate(c, (index) => {
        // Validate every dependency before anything is written, so a bad file leaves no partial import.
        const titles = new Set([...index.tasks, ...items].map((t) => t.title.trim().toLowerCase()));
        items.forEach((it, i) => asList(it.deps).forEach((ref) => {
          const s = String(ref).trim();
          const m = s.match(/^#(\d+)$/);
          if (m) {
            if (Number(m[1]) < 1 || Number(m[1]) > items.length) die(`item ${i + 1}: dependency ${s} is outside the file (1..${items.length})`);
          } else if (titles.has(s.toLowerCase())) {
            // exact title: resolved in pass 2
          } else if (s.includes(':')) {
            normDep(s, c.project.slug); // dies on an unknown project
          } else if (/^T?-?\d+$/i.test(s)) {
            if (!findTask(index, normId(s))) die(`item ${i + 1}: dependency ${normId(s)} does not exist`);
          } else die(`item ${i + 1}: dependency "${s}" matches no task`);
        }));
        // Pass 1: create tasks, so dependencies may point forward or backward within the file.
        const out = items.map((it) => {
          const item = { ...it, deps: [], next: it.next || [], group: it.group || str(flags.group) };
          const dup = index.tasks.find((t) => sameTask(t, item));
          return dup ? { skipped: dup } : addTask(c, index, item);
        });
        // Pass 2: resolve deps given as "#n" (n-th item of this file), an exact title (checked before IDs,
        // so titles like "Phase 1: schema" work), a task ID, or "<project>:T-002".
        const idAt = (r) => (r.skipped ? r.skipped.id : r.id);
        const resolve = (ref) => {
          const s = String(ref).trim();
          const m = s.match(/^#(\d+)$/);
          if (m) return idAt(out[Number(m[1]) - 1]);
          const byTitle = index.tasks.find((t) => t.title.trim().toLowerCase() === s.toLowerCase());
          return byTitle ? byTitle.id : normDep(s, c.project.slug);
        };
        items.forEach((it, i) => {
          if (out[i].skipped || !asList(it.deps).length) return;
          setDeps(c, index, out[i], asList(it.deps).map(resolve));
        });
        return out;
      });
      for (const r of results) {
        if (r.skipped) console.log(`${r.skipped.id} skipped (already exists): ${r.skipped.title}`);
        else console.log(`${r.id} added [${r.status}]: ${r.title}${r.deps ? ` (depends on ${r.deps.join(', ')})` : ''}`);
      }
      break;
    }
    case 'dep':
    case 'undep': {
      const c = ctx();
      const refs = pos.slice(1).map((d) => normDep(d, c.project.slug, cmd === 'undep'));
      if (!refs.length) die(`usage: ${cmd} <ID> <DEP_ID> [DEP_ID ...]`);
      // A stale "<old-project>:T-002" given to undep matches the stored "<old-project>-<hash>:T-002".
      const matches = (stored, ref) => stored === ref || (ref.includes(':') && stored.includes(':') &&
        stored.split(':')[1] === ref.split(':')[1] && stored.split(':')[0].startsWith(ref.split(':')[0]));
      const t = mutate(c, (index) => {
        const t = getTask(index, pos[0]);
        const next = cmd === 'dep' ? [...depsOf(t), ...refs] : depsOf(t).filter((d) => !refs.some((r) => matches(d, r)));
        setDeps(c, index, t, next);
        return t;
      });
      console.log(`${t.id} depends on: ${depsMeta(depsOf(t))}`);
      break;
    }
    case 'start':
    case 'status':
    case 'done': {
      const c = ctx();
      const status = cmd === 'start' ? 'in-progress' : cmd === 'done' ? 'done' : pos[1];
      if (!STATUSES.includes(status)) die(`bad status "${status}" (use ${STATUSES.join(', ')})`);
      let unlocked = [];
      const t = mutate(c, (index) => {
        const t = getTask(index, pos[0]);
        if (t.archived) die(`${t.id} is archived. Run \`unarchive ${t.id}\` first.`);
        const prev = t.status;
        const waits = waitingOn(index, t);
        if (status === 'in-progress' && waits.length && !flags.force) {
          die(`${t.id} waits for unfinished ${waits.map((r) => `${r.label} [${r.task.status}]`).join(', ')}. ` +
            `Finish those first, or pass --force if the user explicitly wants to start it anyway.`);
        }
        const wasReady = dependents(index, t.id).filter((d) => isReady(d.index, d.task)).map((d) => d.task);
        t.status = status;
        t.updated = now();
        if (status === 'done') {
          t.next = [];
          if (prev !== 'done') t.completed = t.updated;
        } else {
          delete t.completed;
          delete t.imported;
        }
        const note = str(flags.note) ? ` — ${flags.note}` : '';
        editTaskFile(c, t, (md) => {
          md = appendToSection(md, 'Progress log', `- ${t.updated} — Status ${prev} → ${status}${note}`);
          return status === 'done' ? setSection(md, 'Next steps', '- (none — task done)') : md;
        });
        if (str(flags.summary)) setSummary(c, t, flags.summary);
        moveForStatus(c, t);
        unlocked = dependents(index, t.id).filter((d) => isReady(d.index, d.task) && !wasReady.includes(d.task))
          .map((d) => depTaskLabel(index, d));
        return t;
      });
      console.log(`${t.id} is now ${t.status}`);
      if (unlocked.length) console.log(`Now ready (all dependencies done): ${unlocked.join('; ')}`);
      break;
    }
    case 'archive':
    case 'unarchive': {
      const c = ctx();
      if (!pos.length) die(`usage: ${cmd} <ID> [ID ...]`);
      const archive = cmd === 'archive';
      const lines = [], unlocked = new Set(), waitAgain = new Set();
      mutate(c, (index) => {
        for (const t of pos.map((id) => getTask(index, id))) {
          if (!!t.archived === archive) { lines.push(`${t.id} is already ${archive ? 'archived' : 'not archived'}`); continue; }
          const wasReady = dependents(index, t.id).filter((d) => isReady(d.index, d.task)).map((d) => d.task);
          t.updated = now();
          if (archive) t.archived = t.updated;
          else delete t.archived;
          editTaskFile(c, t, (md) => appendToSection(upsertMeta(md, 'Archived', archive ? t.updated : '-'),
            'Progress log', `- ${t.updated} — ${archive ? 'Archived' : 'Restored from archive'}`));
          lines.push(`${t.id} ${archive ? 'archived' : 'restored from archive'} [${t.status}]: ${t.title}`);
          for (const d of dependents(index, t.id)) {
            const ready = isReady(d.index, d.task);
            if (ready && !wasReady.includes(d.task)) unlocked.add(depTaskLabel(index, d));
            if (!ready && wasReady.includes(d.task)) waitAgain.add(depTaskLabel(index, d));
          }
        }
      });
      console.log(lines.join('\n'));
      if (unlocked.size) console.log(`Now ready (all dependencies done or archived): ${[...unlocked].join('; ')}`);
      if (waitAgain.size) console.log(`Waiting again on the restored task: ${[...waitAgain].join('; ')}`);
      break;
    }
    case 'summary': {
      const c = ctx();
      const text = pos.slice(1).join(' ');
      if (!text) die('usage: summary <ID> "text"');
      const t = mutate(c, (index) => {
        const t = getTask(index, pos[0]);
        t.updated = now();
        setSummary(c, t, text);
        return t;
      });
      console.log(`${t.id}: work-done summary set`);
      break;
    }
    case 'log':
    case 'note': {
      const c = ctx();
      const text = pos.slice(1).join(' ');
      if (!text) die(`usage: ${cmd} <ID> "text"`);
      const t = mutate(c, (index) => {
        const t = getTask(index, pos[0]);
        t.updated = now();
        editTaskFile(c, t, (md) =>
          cmd === 'log'
            ? appendToSection(md, 'Progress log', `- ${t.updated} — ${text}`)
            : appendToSection(md, 'Notes', `- ${text}`)
        );
        return t;
      });
      console.log(`${t.id}: ${cmd} recorded`);
      break;
    }
    case 'next': {
      const c = ctx();
      const steps = pos.slice(1);
      const t = mutate(c, (index) => {
        const t = getTask(index, pos[0]);
        t.next = steps;
        t.updated = now();
        editTaskFile(c, t, (md) =>
          setSection(md, 'Next steps', steps.length ? steps.map((s) => `- ${s}`).join('\n') : '- (none yet)')
        );
        return t;
      });
      console.log(`${t.id}: ${steps.length} next step(s) set`);
      break;
    }
    case 'goal': {
      const c = ctx();
      const text = pos.slice(1).join(' ');
      const t = mutate(c, (index) => {
        const t = getTask(index, pos[0]);
        t.updated = now();
        editTaskFile(c, t, (md) => setSection(md, 'Goal', text));
        return t;
      });
      console.log(`${t.id}: goal updated`);
      break;
    }
    case 'rename': {
      const c = ctx();
      const title = pos.slice(1).join(' ');
      if (!title) die('usage: rename <ID> "New title"');
      const t = mutate(c, (index) => {
        const t = getTask(index, pos[0]);
        t.title = title;
        t.updated = now();
        editTaskFile(c, t, (md) => md.replace(/^# .*$/m, () => `# ${t.id}: ${title}`));
        return t;
      });
      console.log(`${t.id} renamed`);
      break;
    }
    case 'show': {
      const c = ctx();
      const { index } = load(c);
      const t = getTask(index, pos[0]);
      const f = taskFile(c, t.id);
      const waits = waitingOn(index, t);
      const blocks = t.archived ? [] : dependents(index, t.id).filter((d) => d.task.status !== 'done').map((d) => depTaskLabel(index, d));
      if (t.archived) console.log(`[archived] ${t.archived}: hidden from lists, dependents ignore it (\`unarchive ${t.id}\` restores it)`);
      if (t.status !== 'done' && !t.archived && waits.length)
        console.log(`[deps] WAITS FOR: ${waits.map((r) => `${r.label} ${r.task.title} [${r.task.status}]`).join('; ')}`);
      if (blocks.length) console.log(`[deps] Blocks: ${blocks.join('; ')}`);
      console.log(fs.existsSync(f) ? compactTaskMd(fs.readFileSync(f, 'utf8'), !!flags.full) : compactLine(t, index));
      break;
    }
    case 'resume': {
      const c = ctx();
      const { config, index } = load(c);
      console.log(resumeText(c, index, config, !!flags.all));
      break;
    }
    case 'list': {
      const c = ctx();
      const { index } = load(c);
      const list = flags.all ? index.tasks : flags.archived ? index.tasks.filter((t) => t.archived)
        : flags.ready ? index.tasks.filter((t) => isReady(index, t)) : openTasks(index);
      console.log(list.length ? list.map((t) => compactLine(t, index)).join('\n') : '(no tasks)');
      break;
    }
    case 'skip': {
      const c = ctx();
      touchActivity(c);
      console.log('Turn marked as not needing a task update');
      break;
    }
    case 'render': {
      render();
      console.log(`Board written to ${slash(BOARD)}`);
      break;
    }
    case 'open': {
      render();
      const p = findProject();
      const target = p ? ctxFor(p).boardStub : BOARD;
      const { spawn } = await import('node:child_process');
      const opener =
        process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', target]]
          : [process.platform === 'darwin' ? 'open' : 'xdg-open', [target]];
      spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).unref();
      console.log(`Opened ${slash(target)}`);
      break;
    }
    case 'hook':
      hook(pos[0]);
      break;
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP());
      break;
    default:
      die(`unknown command "${cmd}". Run help.`);
  }
}

await main();
