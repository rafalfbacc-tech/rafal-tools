#!/usr/bin/env node
// security-audit CLI: deterministic helpers for the security-audit skill, so Claude spends tokens on analysis only.
// Works on <appRoot>/.security/ (config, phase state, scanner candidates, rejected false positives).
// Run `node sa.mjs help` for the command list.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const SKILL_DIR = path.dirname(path.dirname(SCRIPT));
const TEMPLATE = path.join(SKILL_DIR, 'templates', 'config.yaml');
const PHASES = ['init', 'plan', 'scan', 'verify', 'stress', 'report'];
const REQUIRED_PHASES = ['init', 'plan', 'scan', 'verify', 'report']; // stress is optional
const CMD = '/rafal-tools:security-audit';

// ---------- helpers ----------
const slash = (p) => p.replace(/\\/g, '/');
const secDir = (appRoot) => path.join(appRoot, '.security');
const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function die(msg) {
  console.error(`sa: ${msg}`);
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

function git(appRoot, args) {
  try {
    return execFileSync('git', ['-C', appRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null; // not a repo, or git missing
  }
}

// ---------- YAML subset ----------
// Supports nested maps (indented), "- scalar" lists, "- key: v" lists of maps, comments, quoted/bare scalars.
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i);
    }
  }
  return s;
}

function splitKey(s) {
  // returns [key, rest] for "key: rest" / "key:", or null
  const m = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(s);
  return m ? [m[1], (m[2] ?? '').trim()] : null;
}

function parseScalar(v, lineNo) {
  if (v === '') return null;
  if (v[0] === '"') {
    if (!v.endsWith('"') || v.length < 2) throw new Error(`config.yaml line ${lineNo}: unterminated string`);
    return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (v[0] === "'") {
    if (!v.endsWith("'") || v.length < 2) throw new Error(`config.yaml line ${lineNo}: unterminated string`);
    return v.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[|>[{&*!]/.test(v)) throw new Error(`config.yaml line ${lineNo}: unsupported syntax "${v}"`);
  if (v === 'true' || v === 'false') return v === 'true';
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

export function parseYaml(text) {
  const lines = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const s = stripComment(raw).replace(/\s+$/, '');
    if (!s.trim()) return;
    if (/^\s*\t/.test(s)) throw new Error(`config.yaml line ${i + 1}: tabs are not allowed for indentation`);
    lines.push({ indent: s.length - s.trimStart().length, text: s.trim(), no: i + 1 });
  });
  let pos = 0;

  function block(indent) {
    const first = lines[pos];
    if (first.text === '-' || first.text.startsWith('- ')) return list(indent);
    return map(indent);
  }

  function value(rest, line, parentIndent) {
    if (rest !== '') return parseScalar(rest, line.no);
    const next = lines[pos];
    if (next && (next.indent > parentIndent || (next.indent === parentIndent && next.text.startsWith('- ')))) {
      return block(next.indent);
    }
    return null;
  }

  function map(indent, obj = {}) {
    while (pos < lines.length && lines[pos].indent === indent && !lines[pos].text.startsWith('- ')) {
      const line = lines[pos];
      const kv = splitKey(line.text);
      if (!kv) throw new Error(`config.yaml line ${line.no}: expected "key: value"`);
      pos++;
      obj[kv[0]] = value(kv[1], line, indent);
    }
    if (pos < lines.length && lines[pos].indent > indent) {
      throw new Error(`config.yaml line ${lines[pos].no}: unexpected indentation`);
    }
    return obj;
  }

  function list(indent) {
    const arr = [];
    while (pos < lines.length && lines[pos].indent === indent && (lines[pos].text === '-' || lines[pos].text.startsWith('- '))) {
      const line = lines[pos];
      const rest = line.text.slice(1).trim();
      pos++;
      if (rest === '') {
        arr.push(value('', line, indent));
        continue;
      }
      const kv = splitKey(rest);
      if (!kv) {
        arr.push(parseScalar(rest, line.no));
        continue;
      }
      // "- key: v" starts a map whose further keys sit at indent + 2
      const obj = { [kv[0]]: value(kv[1], line, indent + 2) };
      if (pos < lines.length && lines[pos].indent === indent + 2) map(indent + 2, obj);
      arr.push(obj);
    }
    return arr;
  }

  if (!lines.length) return {};
  const result = block(lines[0].indent);
  if (pos < lines.length) throw new Error(`config.yaml line ${lines[pos].no}: unexpected indentation`);
  return result;
}

// ---------- config ----------
export function loadConfig(appRoot) {
  const file = path.join(secDir(appRoot), 'config.yaml');
  if (!fs.existsSync(file)) throw new Error(`missing ${slash(file)} — run the init phase first`);
  const c = parseYaml(fs.readFileSync(file, 'utf8')) || {};
  return {
    app: { base_url: null, start_command: null, health_url: null, ...(c.app || {}) },
    scope: (Array.isArray(c.scope) && c.scope.length ? c.scope : ['localhost', '127.0.0.1']).map((h) => String(h).toLowerCase()),
    database: { backup_command: '', ...(c.database || {}) },
    depth: c.depth || 'standard',
    accounts: (Array.isArray(c.accounts) ? c.accounts : []).map((a) => ({
      role: String(a.role ?? ''), username: String(a.username ?? ''), password: String(a.password ?? ''),
    })),
  };
}

// ---------- init-dir ----------
const GITIGNORE_VARIANTS = new Set(['.security', '.security/', '/.security', '/.security/']);

export function initDir(appRoot) {
  const sec = secDir(appRoot);
  const created = [];
  for (const d of [sec, path.join(sec, 'tools')]) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      created.push(slash(d));
    }
  }
  const cfgFile = path.join(sec, 'config.yaml');
  if (!fs.existsSync(cfgFile)) {
    fs.copyFileSync(TEMPLATE, cfgFile);
    created.push(slash(cfgFile));
  }

  const gi = path.join(appRoot, '.gitignore');
  let gitignoreUpdated = false;
  const old = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (!old.split(/\r?\n/).some((l) => GITIGNORE_VARIANTS.has(l.trim()))) {
    const eol = old.includes('\r\n') ? '\r\n' : '\n';
    const sep = old && !old.endsWith('\n') ? eol : '';
    fs.writeFileSync(gi, `${old}${sep}.security/${eol}`);
    gitignoreUpdated = true;
  }

  const tracked = git(appRoot, ['ls-files', '.security']);
  return { created, gitignoreUpdated, trackedWarning: Boolean(tracked && tracked.trim()) };
}

// ---------- scope ----------
export function scopeCheck(appRoot, url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return { allowed: false, host: String(url) };
  }
  return { allowed: loadConfig(appRoot).scope.includes(host), host };
}

// ---------- phase state ----------
const stateFile = (appRoot) => path.join(secDir(appRoot), 'state.json');

export function readState(appRoot) {
  return { phases: {}, lastAudit: null, gitHead: null, hashes: {}, ...readJson(stateFile(appRoot), {}) };
}

export function writeState(appRoot, state) {
  writeJson(stateFile(appRoot), state);
}

export function phaseDone(appRoot, phase) {
  if (!PHASES.includes(phase)) throw new Error(`unknown phase "${phase}"; valid: ${PHASES.join(', ')}`);
  const st = readState(appRoot);
  st.phases[phase] = now();
  writeState(appRoot, st);
}

export function statusText(appRoot) {
  const st = readState(appRoot);
  const rows = PHASES.map((p) => `${p.padEnd(7)}${st.phases[p] ? `done ${st.phases[p]}` : '-'}${p === 'stress' ? '  (optional)' : ''}`);
  const next = REQUIRED_PHASES.find((p) => !st.phases[p]);
  rows.push(next ? `Next: ${CMD} ${next}` : `Next: re-run ${CMD} scan --changed after code changes`);
  return rows.join('\n');
}

// ---------- scanner output → compact candidates ----------
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
const sev = (s, map = {}) => {
  const v = String(s ?? '').toLowerCase();
  const m = map[v] ?? v;
  return SEVERITIES.includes(m) ? m : 'medium';
};
const cvss = (score) => {
  const n = parseFloat(score);
  if (Number.isNaN(n)) return 'medium';
  return n >= 9 ? 'critical' : n >= 7 ? 'high' : n >= 4 ? 'medium' : n > 0 ? 'low' : 'info';
};
const cand = (tool, rule, severity, file, line, message) =>
  ({ tool, rule: String(rule), severity, file: slash(String(file ?? '')), line: Number(line) || 0, message: oneLine(message) });

const NORMALIZERS = {
  semgrep: (j) => (j.results || []).map((r) => cand('semgrep', r.check_id, sev(r.extra?.severity, { error: 'high', warning: 'medium', info: 'low' }),
    r.path, r.start?.line, r.extra?.message)),
  // Secret and Match hold the leaked value: never read them.
  gitleaks: (j) => (Array.isArray(j) ? j : []).map((r) => cand('gitleaks', r.RuleID, 'high', r.File, r.StartLine, r.Description)),
  'osv-scanner': (j) => (j.results || []).flatMap((res) => (res.packages || []).flatMap((p) => (p.vulnerabilities || []).map((v) => {
    const group = (p.groups || []).find((g) => (g.ids || []).includes(v.id));
    return cand('osv-scanner', v.id, cvss(group?.max_severity), res.source?.path, 0,
      `${p.package?.name}@${p.package?.version}: ${v.summary ?? ''}`);
  }))),
  trivy: (j) => (j.Results || []).flatMap((r) => [
    ...(r.Vulnerabilities || []).map((v) => cand('trivy', v.VulnerabilityID, sev(v.Severity), r.Target, 0,
      `${v.PkgName}@${v.InstalledVersion}: ${v.Title ?? ''}`)),
    ...(r.Misconfigurations || []).map((m) => cand('trivy', m.ID, sev(m.Severity), r.Target, m.CauseMetadata?.StartLine, m.Title)),
  ]),
  'npm-audit': (j) => Object.entries(j.vulnerabilities || {}).map(([name, v]) =>
    cand('npm-audit', `npm:${name}`, sev(v.severity, { moderate: 'medium' }), 'package.json', 0, `${name} ${v.range ?? ''}`)),
  zap: (j) => (j.site || []).flatMap((s) => (s.alerts || []).map((a) => cand('zap', `zap:${a.pluginid}`,
    sev(String(a.riskdesc ?? '').split(' ')[0], { informational: 'info' }), a.instances?.[0]?.uri, 0, a.alert))),
  nuclei: (lines) => lines.map((r) => cand('nuclei', r['template-id'], sev(r.info?.severity), r['matched-at'], 0, r.info?.name)),
};

export function normalize(tool, raw) {
  const fn = NORMALIZERS[tool];
  if (!fn) throw new Error(`unknown tool ${tool}; supported: ${Object.keys(NORMALIZERS).join(', ')}`);
  let data;
  try {
    data = tool === 'nuclei'
      ? raw.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l))
      : JSON.parse(raw.trim() || 'null');
  } catch (err) {
    throw new Error(`invalid ${tool} output: ${err.message}`);
  }
  return data == null ? [] : fn(data);
}

export function fingerprint(appRoot, c) {
  let window = c.message;
  if (c.line > 0) {
    try {
      const lines = fs.readFileSync(path.join(appRoot, c.file), 'utf8').split(/\r?\n/);
      window = lines.slice(Math.max(0, c.line - 3), c.line + 2).map((l) => l.trim()).join('\n');
    } catch { /* unreadable → message */ }
  }
  return crypto.createHash('sha1').update(`${c.rule}|${c.file}|${window}`).digest('hex').slice(0, 12);
}

const rejectedFile = (appRoot) => path.join(secDir(appRoot), 'rejected.json');

// Reject by the exact fingerprint printed on the candidate line ([fp:...]), so the stored
// fp always equals what filterOutput computes — for line-0 candidates (osv, npm, trivy, zap,
// nuclei) as well as line>0 ones. A recomputed fp would never match those and they would recur.
export function rejectByFp(appRoot, fp, reason) {
  if (!/^[0-9a-f]{12}$/.test(fp)) throw new Error(`invalid fingerprint "${fp}"; copy the fp:<...> shown on the candidate line`);
  const list = readJson(rejectedFile(appRoot), []);
  if (!list.some((r) => r.fp === fp)) {
    list.push({ fp, reason, date: now() });
    writeJson(rejectedFile(appRoot), list);
  }
  return fp;
}

const candLine = (c) => `${c.severity.toUpperCase()} ${c.tool} ${c.file}:${c.line} ${c.rule} — ${c.message} [fp:${c.fp}]`;

export function filterOutput(appRoot, tool, rawFile) {
  const rejected = new Set(readJson(rejectedFile(appRoot), []).map((r) => r.fp));
  let droppedRejected = 0;
  const kept = [];
  for (const c of normalize(tool, fs.readFileSync(rawFile, 'utf8'))) {
    c.fp = fingerprint(appRoot, c);
    if (rejected.has(c.fp)) droppedRejected++;
    else kept.push(c);
  }
  kept.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.file.localeCompare(b.file) || a.line - b.line);
  const out = path.join(secDir(appRoot), 'tools', `${tool}.candidates.txt`);
  writeAtomic(out, kept.map(candLine).join('\n') + (kept.length ? '\n' : ''));
  return { kept, droppedRejected };
}

// ---------- change detection ----------
export const SKIP_DIRS = new Set(['node_modules', '.git', '.security', 'dist', 'build', 'out', 'vendor', '.next', 'coverage',
  'target', '.venv', 'venv', '__pycache__', 'bin', 'obj', '.idea', '.vscode', 'Pods', '.gradle', 'DerivedData']);
const skipped = (rel) => rel.split('/').some((part) => SKIP_DIRS.has(part));

export function listFiles(appRoot) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(appRoot, '');
  return out.sort();
}

const hashFile = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

export function changedFiles(appRoot) {
  const st = readState(appRoot);
  if (!Object.keys(st.hashes).length && !st.gitHead) return { files: listFiles(appRoot), method: 'first-run' };
  if (st.gitHead) {
    const diff = git(appRoot, ['diff', '--name-only', st.gitHead]);
    const untracked = git(appRoot, ['ls-files', '--others', '--exclude-standard']);
    if (diff !== null && untracked !== null) {
      const files = [...new Set(`${diff}\n${untracked}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))]
        .filter((f) => !skipped(f) && fs.existsSync(path.join(appRoot, f))).sort();
      return { files, method: 'git' };
    }
  }
  const files = listFiles(appRoot).filter((f) => st.hashes[f] !== hashFile(path.join(appRoot, f)));
  return { files, method: 'hash' };
}

export function markAudited(appRoot) {
  const st = readState(appRoot);
  const head = git(appRoot, ['rev-parse', 'HEAD']);
  st.lastAudit = now();
  st.gitHead = head ? head.trim() : null;
  st.hashes = Object.fromEntries(listFiles(appRoot).map((f) => [f, hashFile(path.join(appRoot, f))]));
  writeState(appRoot, st);
}

// ---------- redaction ----------
const unquote = (v) => {
  if (v.length >= 2 && v[0] === '"' && v.endsWith('"')) return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (v.length >= 2 && v[0] === "'" && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
};

// Passwords straight from config.yaml text, paired with their role. This is the truncation-safe
// source: parseYaml trims an inline "#..." off an unquoted value, so the parsed password can be a
// prefix of the real one — redacting only the prefix would leak the tail. Raw + parsed are unioned.
function rawAccountPasswords(appRoot) {
  const file = path.join(secDir(appRoot), 'config.yaml');
  if (!fs.existsSync(file)) return [];
  const pairs = [];
  let role = 'account';
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const r = /^\s*(?:-\s*)?role:\s*(.+?)\s*$/.exec(line);
    if (r) { role = unquote(r[1].trim()); continue; }
    const p = /^\s*password:\s*(\S.*?)\s*$/.exec(line);
    if (p) { const v = unquote(p[1].trim()); if (v) pairs.push({ role, password: v }); }
  }
  return pairs;
}

export function redactFiles(appRoot, files) {
  const set = new Map(); // password -> role
  try {
    for (const a of loadConfig(appRoot).accounts) if (a.password) set.set(a.password, a.role);
  } catch { /* no config → nothing to redact */ }
  for (const { role, password } of rawAccountPasswords(appRoot)) if (!set.has(password)) set.set(password, role);
  // Longest first: a full value is redacted before any truncated prefix of it.
  const entries = [...set.entries()].sort((a, b) => b[0].length - a[0].length);
  let total = 0;
  for (const file of files) {
    let text = fs.readFileSync(file, 'utf8');
    let n = 0;
    for (const [password, role] of entries) {
      const parts = text.split(password); // literal match, no regex
      n += parts.length - 1;
      text = parts.join(`[REDACTED:${role}]`);
    }
    if (n) writeAtomic(file, text);
    total += n;
  }
  return total;
}

function defaultRedactTargets(appRoot) {
  const sec = secDir(appRoot);
  const top = fs.readdirSync(sec).filter((f) => f.endsWith('.md')).map((f) => path.join(sec, f));
  const toolsDir = path.join(sec, 'tools');
  const tools = fs.existsSync(toolsDir)
    ? fs.readdirSync(toolsDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(toolsDir, e.name))
    : [];
  return [...top, ...tools];
}

// ---------- CLI ----------
const HELP = `security-audit helper — node sa.mjs <command> ...
  init-dir <appRoot>                  create .security/, config template, .gitignore entry
  scope-check <appRoot> <url>         exit 0 "allowed <host>" or exit 2 "refused <host>"
  phase-done <appRoot> <phase>        record a finished phase (${PHASES.join(', ')})
  status <appRoot>                    phases done and the next command
  filter <appRoot> <tool> <rawFile> [--limit N]
                                      scanner output → .security/tools/<tool>.candidates.txt
                                      tools: ${Object.keys(NORMALIZERS).join(', ')}
  reject <appRoot> <fp> <reason...>   remember a false positive (fp from the candidate line) so it is not reported again
  changed <appRoot>                   files changed since the last mark-audited (git, else hashes)
  mark-audited <appRoot>              remember the current code state for "changed"
  redact <appRoot> [files...]         replace config passwords with [REDACTED:<role>]
                                      (default: .security/*.md and .security/tools/*)
  help                               this list`;

function main(argv) {
  const [cmd, appRoot, ...rest] = argv;
  try {
    switch (cmd) {
      case 'init-dir': {
        const r = initDir(appRoot);
        for (const c of r.created) console.log(`created ${c}`);
        console.log(r.gitignoreUpdated ? 'added .security/ to .gitignore' : '.gitignore already ignores .security/');
        if (r.trackedWarning) console.log('WARNING: .security/ is tracked by git — run: git rm -r --cached .security');
        break;
      }
      case 'scope-check': {
        const r = scopeCheck(appRoot, rest[0]);
        if (r.allowed) console.log(`allowed ${r.host}`);
        else {
          console.log(`refused ${r.host} — not in scope`);
          process.exit(2);
        }
        break;
      }
      case 'phase-done':
        phaseDone(appRoot, rest[0]);
        console.log(statusText(appRoot));
        break;
      case 'status':
        console.log(statusText(appRoot));
        break;
      case 'filter': {
        const [tool, rawFile] = rest;
        const li = rest.indexOf('--limit');
        const limit = li >= 0 ? Number(rest[li + 1]) : 200;
        const r = filterOutput(appRoot, tool, rawFile);
        console.log(`${tool}: ${r.kept.length} candidates (${r.droppedRejected} dropped as previously rejected) → .security/tools/${tool}.candidates.txt`);
        for (const c of r.kept.slice(0, limit)) console.log(candLine(c));
        if (r.kept.length > limit) console.log(`… ${r.kept.length - limit} more in the candidates file`);
        break;
      }
      case 'reject': {
        const [fp, ...reason] = rest;
        if (!fp || !reason.length) die('usage: reject <appRoot> <fp> <reason...>  (fp is the fp:<...> on the candidate line)');
        console.log(`rejected fp:${rejectByFp(appRoot, fp, reason.join(' '))}`);
        break;
      }
      case 'changed': {
        const r = changedFiles(appRoot);
        console.log(`method: ${r.method}, ${r.files.length} files`);
        for (const f of r.files) console.log(f);
        break;
      }
      case 'mark-audited':
        markAudited(appRoot);
        console.log('code state recorded in .security/state.json');
        break;
      case 'redact': {
        const files = rest.length ? rest : defaultRedactTargets(appRoot);
        console.log(`redacted ${redactFiles(appRoot, files)} occurrence(s)`);
        break;
      }
      case 'help':
      case undefined:
        console.log(HELP);
        break;
      default:
        die(`unknown command "${cmd}"\n${HELP}`);
    }
  } catch (err) {
    die(err.message);
  }
}

if (process.argv[1] && SCRIPT === path.resolve(process.argv[1])) main(process.argv.slice(2));
