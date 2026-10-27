// Tests for sa.mjs. Run: node --test plugins/rafal-tools/skills/security-audit/scripts/sa.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseYaml, loadConfig, initDir, scopeCheck, phaseDone, statusText,
  normalize, rejectByFp, filterOutput,
  changedFiles, markAudited, redactFiles,
} from './sa.mjs';

let app;
beforeEach(() => {
  app = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-'));
});

const cfg = (text) => fs.writeFileSync(path.join(app, '.security', 'config.yaml'), text);

// ---------- Task 1: config, init-dir, scope, state ----------
test('parseYaml handles nested maps, lists of maps, quotes, comments, CRLF', () => {
  const y = 'app:\r\n  base_url: http://localhost:3000 # c\r\nscope:\r\n  - localhost\r\naccounts:\r\n  - role: admin\r\n    username: a@t.local\r\n    password: "p#ss: \'x\'"\r\n';
  assert.deepEqual(parseYaml(y), { app: { base_url: 'http://localhost:3000' }, scope: ['localhost'],
    accounts: [{ role: 'admin', username: 'a@t.local', password: "p#ss: 'x'" }] });
});

test('parseYaml reports line number on unsupported syntax', () => {
  assert.throws(() => parseYaml('a: 1\nb: |\n  x'), /line 2/);
});

test('initDir creates .security with config template and gitignore entry', () => {
  const r = initDir(app);
  assert.ok(fs.existsSync(path.join(app, '.security', 'config.yaml')));
  assert.match(fs.readFileSync(path.join(app, '.gitignore'), 'utf8'), /^\.security\/$/m);
  assert.equal(r.gitignoreUpdated, true);
});

test('config template parses and has example roles', () => {
  initDir(app);
  const c = loadConfig(app);
  assert.deepEqual(c.accounts.map((a) => a.role), ['admin', 'user', 'tenant-b-user', 'guest']);
});

test('initDir keeps existing config and does not duplicate gitignore variants', () => {
  fs.writeFileSync(path.join(app, '.gitignore'), 'node_modules\r\n/.security/\r\n');
  initDir(app);
  cfg('depth: deep\n');
  const r = initDir(app);
  assert.equal(r.gitignoreUpdated, false);
  assert.equal(fs.readFileSync(path.join(app, '.security', 'config.yaml'), 'utf8'), 'depth: deep\n');
});

test('loadConfig fills defaults', () => {
  initDir(app);
  cfg('depth: deep\n');
  const c = loadConfig(app);
  assert.deepEqual(c.scope, ['localhost', '127.0.0.1']);
  assert.equal(c.depth, 'deep');
  assert.deepEqual(c.accounts, []);
});

test('scopeCheck refuses lookalike hosts and accepts exact ones', () => {
  initDir(app);
  cfg('scope:\n  - localhost\n  - 127.0.0.1\n  - ::1\n');
  for (const u of ['http://localhost.evil.com', 'http://127.0.0.1.nip.io', 'http://evil.com/?x=localhost'])
    assert.equal(scopeCheck(app, u).allowed, false, u);
  for (const u of ['http://LOCALHOST:3000/x', 'http://[::1]:8080', 'https://127.0.0.1'])
    assert.equal(scopeCheck(app, u).allowed, true, u);
});

test('statusText shows next phase and skips optional stress', () => {
  initDir(app);
  for (const p of ['init', 'plan', 'scan', 'verify']) phaseDone(app, p);
  assert.match(statusText(app), /Next: \/rafal-tools:security-audit report/);
  assert.throws(() => phaseDone(app, 'bogus'));
});

// ---------- Task 2: scanner filter, fingerprints ----------
test('normalize semgrep maps fields and severity', () => {
  const raw = JSON.stringify({ results: [{ check_id: 'js.sqli', path: 'src\\db.js', start: { line: 12 },
    extra: { severity: 'ERROR', message: 'SQL built from input' } }] });
  assert.deepEqual(normalize('semgrep', raw), [{ tool: 'semgrep', rule: 'js.sqli', severity: 'high',
    file: 'src/db.js', line: 12, message: 'SQL built from input' }]);
});

test('normalize gitleaks never includes the secret', () => {
  const raw = JSON.stringify([{ RuleID: 'aws-key', File: '.env', StartLine: 3, Description: 'AWS key',
    Secret: 'AKIASECRETVALUE', Match: 'AKIASECRETVALUE' }]);
  assert.doesNotMatch(JSON.stringify(normalize('gitleaks', raw)), /AKIASECRETVALUE/);
});

test('normalize osv-scanner maps CVSS to severity', () => {
  const raw = JSON.stringify({ results: [{ source: { path: 'package-lock.json' }, packages: [{
    package: { name: 'lodash', version: '4.17.15' }, vulnerabilities: [{ id: 'GHSA-1', summary: 'Proto pollution' }],
    groups: [{ ids: ['GHSA-1'], max_severity: '9.8' }] }] }] });
  const [c] = normalize('osv-scanner', raw);
  assert.equal(c.severity, 'critical');
  assert.equal(c.message, 'lodash@4.17.15: Proto pollution');
});

test('normalize trivy and npm-audit map severities', () => {
  const trivy = JSON.stringify({ Results: [{ Target: 'Dockerfile', Misconfigurations: [{ ID: 'DS002', Severity: 'HIGH',
    Title: 'root user', CauseMetadata: { StartLine: 4 } }], Vulnerabilities: [{ VulnerabilityID: 'CVE-1',
    PkgName: 'openssl', InstalledVersion: '1.0', Severity: 'UNKNOWN', Title: 't' }] }] });
  assert.deepEqual(normalize('trivy', trivy).map((c) => [c.rule, c.severity, c.line]), [['CVE-1', 'medium', 0], ['DS002', 'high', 4]]);
  const npm = JSON.stringify({ vulnerabilities: { minimist: { severity: 'moderate', range: '<1.2.6' } } });
  assert.deepEqual(normalize('npm-audit', npm)[0], { tool: 'npm-audit', rule: 'npm:minimist', severity: 'medium',
    file: 'package.json', line: 0, message: 'minimist <1.2.6' });
});

test('normalize nuclei reads jsonl and zap reads riskdesc', () => {
  assert.equal(normalize('nuclei', '{"template-id":"x","matched-at":"http://localhost/a","info":{"severity":"low","name":"n"}}\n\n').length, 1);
  const zap = JSON.stringify({ site: [{ alerts: [{ pluginid: '10038', alert: 'CSP missing', riskdesc: 'Medium (High)', instances: [{ uri: 'http://localhost/' }] }] }] });
  assert.equal(normalize('zap', zap)[0].severity, 'medium');
});

test('normalize truncates messages to one line of 160 chars', () => {
  const raw = JSON.stringify({ results: [{ check_id: 'r', path: 'a.js', start: { line: 1 },
    extra: { severity: 'INFO', message: `line1\nline2 ${'x'.repeat(300)}` } }] });
  const m = normalize('semgrep', raw)[0].message;
  assert.ok(m.length <= 160 && !m.includes('\n'));
});

test('normalize rejects invalid JSON and unknown tools with clear errors', () => {
  assert.throws(() => normalize('semgrep', '{oops'), /invalid semgrep output/);
  assert.throws(() => normalize('foo', '{}'), /unknown tool foo/);
});

test('rejecting by fingerprint drops a line>0 candidate until its code changes', () => {
  fs.mkdirSync(path.join(app, 'src'));
  fs.writeFileSync(path.join(app, 'src', 'a.js'), 'l1\nl2\nq(x)\nl4\n');
  initDir(app);
  const raw = path.join(app, 'raw.json');
  fs.writeFileSync(raw, JSON.stringify({ results: [{ check_id: 'r', path: 'src/a.js', start: { line: 3 }, extra: { severity: 'WARNING', message: 'm' } }] }));
  const [c] = filterOutput(app, 'semgrep', raw).kept;
  rejectByFp(app, c.fp, 'input is a constant');
  rejectByFp(app, c.fp, 'dup');
  assert.equal(JSON.parse(fs.readFileSync(path.join(app, '.security', 'rejected.json'), 'utf8')).length, 1);
  assert.equal(filterOutput(app, 'semgrep', raw).droppedRejected, 1);
  fs.writeFileSync(path.join(app, 'src', 'a.js'), 'l1\nl2\nq(req.body.x)\nl4\n');
  assert.equal(filterOutput(app, 'semgrep', raw).kept.length, 1);
});

test('rejecting by fingerprint drops a line-0 candidate (npm-audit) on the next run', () => {
  initDir(app);
  const raw = path.join(app, 'raw.json');
  fs.writeFileSync(raw, JSON.stringify({ vulnerabilities: { minimist: { severity: 'moderate', range: '<1.2.6' } } }));
  const [c] = filterOutput(app, 'npm-audit', raw).kept;
  assert.equal(c.line, 0);
  rejectByFp(app, c.fp, 'accepted risk');
  assert.equal(filterOutput(app, 'npm-audit', raw).droppedRejected, 1);
});

test('filterOutput writes compact sorted candidates file', () => {
  initDir(app);
  const raw = path.join(app, 'raw.json');
  fs.writeFileSync(raw, JSON.stringify({ results: [
    { check_id: 'low', path: 'b.js', start: { line: 1 }, extra: { severity: 'INFO', message: 'm' } },
    { check_id: 'hi', path: 'a.js', start: { line: 1 }, extra: { severity: 'ERROR', message: 'm' } }] }));
  filterOutput(app, 'semgrep', raw);
  const lines = fs.readFileSync(path.join(app, '.security', 'tools', 'semgrep.candidates.txt'), 'utf8').trim().split('\n');
  assert.match(lines[0], /^HIGH semgrep a\.js:1 hi — m \[fp:[0-9a-f]{12}\]$/);
  assert.match(lines[1], /^LOW semgrep b\.js:1 low/);
});

test('filterOutput handles empty results', () => {
  initDir(app);
  const raw = path.join(app, 'raw.json');
  fs.writeFileSync(raw, JSON.stringify({ results: [] }));
  assert.deepEqual(filterOutput(app, 'semgrep', raw), { kept: [], droppedRejected: 0 });
});

// ---------- Task 3: change detection, redaction ----------
test('changedFiles without git and without state lists all files except skipped dirs', () => {
  fs.mkdirSync(path.join(app, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(app, 'node_modules', 'x', 'i.js'), '');
  fs.writeFileSync(path.join(app, 'a.js'), '1');
  initDir(app);
  assert.deepEqual(changedFiles(app), { files: ['.gitignore', 'a.js'], method: 'first-run' });
});

test('changedFiles by hash returns only new or modified files', () => {
  fs.writeFileSync(path.join(app, 'a.js'), '1');
  fs.writeFileSync(path.join(app, 'b.js'), '1');
  initDir(app);
  markAudited(app);
  fs.writeFileSync(path.join(app, 'b.js'), '2');
  fs.writeFileSync(path.join(app, 'c.js'), '1');
  assert.deepEqual(changedFiles(app), { files: ['b.js', 'c.js'], method: 'hash' });
});

test('redactFiles replaces passwords literally, including regex characters', () => {
  initDir(app);
  cfg('accounts:\n  - role: admin\n    username: a\n    password: "p.*s$(1)"\n  - role: guest\n    password: ""\n');
  const f = path.join(app, '.security', 'findings.md');
  fs.writeFileSync(f, 'login with p.*s$(1) worked; pXXs untouched');
  assert.equal(redactFiles(app, [f]), 1);
  assert.equal(fs.readFileSync(f, 'utf8'), 'login with [REDACTED:admin] worked; pXXs untouched');
});

test('redactFiles catches an unquoted password containing a comment char', () => {
  initDir(app);
  cfg('accounts:\n  - role: admin\n    username: a\n    password: my pass #1\n');
  const f = path.join(app, '.security', 'findings.md');
  fs.writeFileSync(f, 'leaked: my pass #1 here');
  redactFiles(app, [f]);
  assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /my pass #1/);
});
