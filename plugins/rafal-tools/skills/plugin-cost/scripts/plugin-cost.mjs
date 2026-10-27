#!/usr/bin/env node
// Reports what each enabled Claude Code plugin costs per session (skill descriptions + text injected by
// SessionStart / UserPromptSubmit hooks) and how often it was actually used, from local session history.
// Usage: node plugin-cost.mjs [--days N] [--no-hooks] [--here]   (--here: run hooks in the current folder, not an empty one)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execSync, execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const DAYS = Number(args[args.indexOf('--days') + 1]) > 0 && args.includes('--days') ? Number(args[args.indexOf('--days') + 1]) : 30;
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CUTOFF = Date.now() - DAYS * 864e5;

const estTokens = (chars) => Math.round(chars / 4); // same rough ratio Claude Code uses for its estimates
const fmt = (n) => (n == null ? '?' : n >= 1000 ? `~${(n / 1000).toFixed(1)}k` : `~${n}`);
const parseTok = (s) => (!s || s === '-' ? 0 : s.endsWith('k') ? Math.round(parseFloat(s) * 1000) : parseInt(s, 10));
const slash = (p) => p.replace(/\\/g, '/');
const claude = (cmd) => execSync(`claude ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 });

// ---------- enabled plugins ----------
const listed = JSON.parse(claude('plugin list --json'));
const plugins = new Map();
for (const p of listed.filter((x) => x.enabled)) {
  const e = plugins.get(p.id) || { id: p.id, name: p.id.split('@')[0], scopes: [], installPath: p.installPath };
  e.scopes.push(p.scope === 'user' ? 'user' : `${p.scope}:${p.projectPath || '?'}`);
  plugins.set(p.id, e);
}

// ---------- static cost from `claude plugin details` ----------
for (const p of plugins.values()) {
  const out = claude(`plugin details "${p.id}"`);
  p.alwaysOn = parseTok((out.match(/Always-on:\s+~?([\d.]+k?)/) || [])[1]);
  p.components = [];
  const block = out.split(/Per-component.*\n/)[1] || '';
  for (const line of block.split('\n').slice(1)) {
    const m = line.match(/^\s{2}(\S+)\s+~?([\d.]+k?|-)\s+~?([\d.]+k?|-)/);
    if (!m) break;
    p.components.push({ name: m[1], alwaysOn: parseTok(m[2]), onInvoke: parseTok(m[3]) });
  }
}

// ---------- dynamic cost: run hooks that inject text into the model's context ----------
function hookEntries(p, event) {
  const files = [path.join(p.installPath, 'hooks', 'hooks.json'), path.join(p.installPath, '.claude-plugin', 'plugin.json')];
  const entries = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const h = (j.hooks && typeof j.hooks === 'object' ? j.hooks : {})[event] || [];
      for (const group of h) {
        if (event === 'SessionStart' && group.matcher && !/startup/.test(group.matcher)) continue;
        for (const hk of group.hooks || []) if (hk.type === 'command') entries.push(hk.command);
      }
    } catch {}
  }
  return entries;
}

function injectedChars(output) {
  const s = output.trim();
  if (!s) return 0;
  try {
    const j = JSON.parse(s);
    return (j.hookSpecificOutput?.additionalContext || '').length; // systemMessage is shown to the user only
  } catch {
    return s.length; // plain stdout of SessionStart / UserPromptSubmit goes into the context
  }
}

const HERE = flag('here');
const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-cost-'));
const hasBash = (() => { try { execFileSync('bash', ['-c', 'true'], { stdio: 'ignore' }); return true; } catch { return false; } })();
// --here runs only SessionStart hooks in the current folder. UserPromptSubmit hooks always run in the
// empty temp folder: running them for real here would mark a "turn" in tools such as task-tracker.
function runHook(p, command, event) {
  const cwd = HERE && event === 'SessionStart' ? process.cwd() : tmpCwd;
  const input = JSON.stringify({ hook_event_name: event, source: 'startup', cwd, prompt: 'hello', session_id: 'plugin-cost' });
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: p.installPath, CLAUDE_PROJECT_DIR: cwd };
  const opts = { input, env, cwd, encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'ignore'] };
  try {
    return injectedChars(hasBash ? execFileSync('bash', ['-c', command], opts) : execSync(command, opts));
  } catch (e) {
    return e.stdout ? injectedChars(String(e.stdout)) : null;
  }
}

for (const p of plugins.values()) {
  p.sessionHook = 0;
  p.promptHook = 0;
  if (flag('no-hooks')) continue;
  for (const [event, key] of [['SessionStart', 'sessionHook'], ['UserPromptSubmit', 'promptHook']]) {
    for (const cmd of hookEntries(p, event)) {
      const chars = runHook(p, cmd, event);
      if (chars == null) p[`${key}Failed`] = true;
      else p[key] += estTokens(chars);
    }
  }
}
fs.rmSync(tmpCwd, { recursive: true, force: true });

// ---------- usage from local session history ----------
const byName = new Map([...plugins.values()].map((p) => [p.name, p]));
for (const p of plugins.values()) Object.assign(p, { uses: 0, calls: 0, sessions: new Set(), last: '', projects: new Map(), skillUses: new Map() });
let sessionsInWindow = 0;
const seen = new Set();

// kind: 'invoke' = skill / agent / slash command; 'call' = a Bash/PowerShell command running the plugin's scripts.
function credit(pluginName, what, l, kind = 'invoke') {
  const p = byName.get(pluginName);
  if (!p) return;
  if (kind === 'invoke') p.uses++;
  else p.calls++;
  p.sessions.add(l.sessionId);
  if ((l.timestamp || '') > p.last) p.last = l.timestamp || '';
  if (l.cwd) p.projects.set(l.cwd, (p.projects.get(l.cwd) || 0) + 1);
  if (what) p.skillUses.set(what, (p.skillUses.get(what) || 0) + 1);
}

const projectsDir = path.join(CLAUDE_DIR, 'projects');
const files = fs.existsSync(projectsDir)
  ? fs.readdirSync(projectsDir).flatMap((d) => {
      const dir = path.join(projectsDir, d);
      return fs.statSync(dir).isDirectory() ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)) : [];
    })
  : [];
const cliPattern = (p) => [`plugins/cache/${p.id.split('@')[1]}/${p.name}/`, `/plugins/${p.name}/`];

for (const file of files) {
  if (fs.statSync(file).mtimeMs < CUTOFF) continue;
  sessionsInWindow++;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"tool_use"') && !line.includes('<command-name>')) continue;
    let l;
    try { l = JSON.parse(line); } catch { continue; }
    if (l.timestamp && Date.parse(l.timestamp) < CUTOFF) continue;
    const content = l.message?.content;
    const parts = Array.isArray(content) ? content : typeof content === 'string' ? [{ type: 'text', text: content }] : [];
    for (const x of parts) {
      if (x.type === 'tool_use') {
        if (seen.has(x.id)) continue;
        seen.add(x.id);
        const ref = x.name === 'Skill' ? x.input?.skill : x.name === 'Agent' ? x.input?.subagent_type : null;
        if (ref && ref.includes(':')) credit(ref.split(':')[0], ref, l);
        if ((x.name === 'Bash' || x.name === 'PowerShell') && typeof x.input?.command === 'string') {
          const cmd = slash(x.input.command);
          for (const p of plugins.values()) if (cliPattern(p).some((s) => cmd.includes(s))) credit(p.name, null, l, 'call');
        }
      } else if (x.type === 'text' && l.type === 'user') {
        const m = x.text.match(/<command-name>\/([^<\s]+)<\/command-name>/);
        if (m && m[1].includes(':')) credit(m[1].split(':')[0], m[1], l);
      }
    }
  }
}

// ---------- other always-on context ----------
const other = [];
for (const f of [path.join(CLAUDE_DIR, 'CLAUDE.md'), path.join(process.cwd(), 'CLAUDE.md'), path.join(process.cwd(), '.claude', 'CLAUDE.md')]) {
  if (fs.existsSync(f)) other.push([slash(f.replace(os.homedir(), '~')), estTokens(fs.readFileSync(f, 'utf8').length)]);
}
for (const dir of [path.join(CLAUDE_DIR, 'skills'), path.join(process.cwd(), '.claude', 'skills')]) {
  if (!fs.existsSync(dir)) continue;
  let n = 0, chars = 0;
  for (const s of fs.readdirSync(dir)) {
    const f = path.join(dir, s, 'SKILL.md');
    if (!fs.existsSync(f)) continue;
    n++;
    const fm = fs.readFileSync(f, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/); // CRLF files are common on Windows
    chars += fm ? fm[1].length : 0;
  }
  if (n) other.push([`${slash(dir.replace(os.homedir(), '~'))} (${n} standalone skills, descriptions)`, estTokens(chars)]);
}

// ---------- report ----------
const rows = [...plugins.values()].map((p) => ({ ...p, total: p.alwaysOn + p.sessionHook }))
  .sort((a, b) => b.total - a.total);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const total = rows.reduce((s, p) => s + p.total, 0);
const out = [];
out.push(`PLUGIN COST REPORT · ${new Date().toISOString().slice(0, 10)} · usage window: last ${DAYS} days, ${sessionsInWindow} sessions`);
out.push('');
out.push('Per-session cost of enabled plugins (in context before your first message)');
const w = Math.max(...rows.map((p) => p.id.length), 6) + 2;
out.push(`${pad('Plugin', w)}${lpad('Skills', 8)}${lpad('Hook', 8)}${lpad('Session', 9)}${lpad('/prompt', 9)}${lpad('Invoked', 9)}${lpad('Scripts', 9)}${lpad('Sessions', 10)}  Last used`);
for (const p of rows) {
  const hook = p.sessionHookFailed ? '?' : fmt(p.sessionHook);
  out.push(`${pad(p.id, w)}${lpad(fmt(p.alwaysOn), 8)}${lpad(hook, 8)}${lpad(fmt(p.total), 9)}${lpad(p.promptHook ? fmt(p.promptHook) : '-', 9)}` +
    `${lpad(p.uses, 9)}${lpad(p.calls, 9)}${lpad(`${p.sessions.size}/${sessionsInWindow}`, 10)}  ${p.last ? p.last.slice(0, 10) : 'never'}`);
}
out.push(`${pad('Total', w)}${lpad('', 16)}${lpad(fmt(total), 9)}`);
out.push('Skills = skill/agent descriptions (claude plugin details). Hook = text injected by SessionStart hooks, measured');
out.push(HERE ? `by running them in ${slash(process.cwd())}. /prompt = added to every message.`
  : 'by running them in an empty folder (folder-dependent hooks may inject more in real projects; measure with --here). /prompt = added to every message.');
out.push("Invoked = skill, agent and slash-command uses. Scripts = shell commands running the plugin's own scripts. Sessions = sessions using it at all.");

const comps = rows.flatMap((p) => p.components.map((c) => ({ ...c, plugin: p.name, uses: p.skillUses.get(`${p.name}:${c.name}`) || 0 })))
  .sort((a, b) => b.onInvoke - a.onInvoke).slice(0, 12);
if (comps.length) {
  out.push('');
  out.push('Most expensive skills when invoked');
  const cw = Math.max(...comps.map((c) => c.plugin.length + c.name.length + 1)) + 2;
  out.push(`${pad('Skill', cw)}${lpad('On invoke', 10)}${lpad(`Invoked (${DAYS}d)`, 15)}`);
  for (const c of comps) out.push(`${pad(`${c.plugin}:${c.name}`, cw)}${lpad(fmt(c.onInvoke), 10)}${lpad(c.uses, 15)}`);
}

if (other.length) {
  out.push('');
  out.push('Other always-on context (not plugins)');
  for (const [name, t] of other) out.push(`  ${fmt(t).padStart(7)}  ${name}`);
  out.push('  MCP server tool definitions are not measured here.');
}

const findings = [];
for (const p of rows) {
  if (p.scopes.length > 1) findings.push(`${p.id} is enabled ${p.scopes.length} times (${p.scopes.join('; ')}). The user scope already covers every folder: in each listed project folder run ` +
    `claude plugin uninstall ${p.id} --scope project --keep-data (not "disable --scope project", which would turn it off there).`);
  const share = sessionsInWindow ? p.sessions.size / sessionsInWindow : 0;
  if (p.uses + p.calls === 0 && p.total >= 300) {
    findings.push(`${p.id}: never used in ${DAYS} days but costs ${fmt(p.total)} tokens every session. Consider: claude plugin disable ${p.id} --scope user`);
  } else if (p.total >= 500 && share < 0.25 && p.projects.size) {
    const top = [...p.projects].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => slash(d)).join(', ');
    findings.push(`${p.id}: used in ${Math.round(share * 100)}% of sessions (${fmt(p.total)}/session). Consider disabling it globally and enabling it only in: ${top}` +
      ` (claude plugin disable ${p.id} --scope user; then in each folder: claude plugin enable ${p.id} --scope project)`);
  }
}
const unusedHeavy = comps.filter((c) => c.uses === 0 && c.onInvoke >= 10000);
if (unusedHeavy.length) findings.push(`Heavy skills never used in ${DAYS} days: ${unusedHeavy.map((c) => `${c.plugin}:${c.name} (${fmt(c.onInvoke)})`).join(', ')}. They cost nothing until invoked; only their descriptions are always-on.`);
out.push('');
out.push('Findings');
out.push(...(findings.length ? findings.map((f) => `- ${f}`) : ['- Nothing stands out.']));
console.log(out.join('\n'));
