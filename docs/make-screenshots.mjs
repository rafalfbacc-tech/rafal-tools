// Regenerates the README screenshots of the task-tracker board from English sample data.
// Usage (from the repo root): node docs/make-screenshots.mjs [--browser <path to Edge/Chrome>]
// Everything runs in a temporary tracker home; your real tracker data and config are never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "plugins", "rafal-tools", "docs", "screenshots");
const tt = path.join(ROOT, 'plugins', 'rafal-tools', 'skills', 'task-tracker', 'scripts', 'tt.mjs');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-demo-'));
const home = path.join(work, 'home');
const user = path.join(work, 'user');
const env = { ...process.env, USERPROFILE: user, HOME: user, TASK_TRACKER_HOME: home };
const run = (cwd, ...args) => execFileSync('node', [tt, ...args], { cwd, env, encoding: 'utf8' });

// ---------- sample data ----------
const projects = {
  api: { name: 'Storefront API', fake: 'C:/dev/storefront-api' },
  web: { name: 'Storefront Web', fake: 'C:/dev/storefront-web' },
  docs: { name: 'Docs Site', fake: 'C:/dev/docs-site' },
};
for (const p of Object.values(projects)) {
  p.dir = path.join(work, path.basename(p.fake));
  fs.mkdirSync(p.dir, { recursive: true });
  run(p.dir, 'init', '--name', p.name);
}

const bulk = (key, items) => {
  const f = path.join(work, `${key}.json`);
  fs.writeFileSync(f, JSON.stringify(items));
  run(projects[key].dir, 'bulk', f);
};

bulk('api', [
  { title: 'Database schema and migrations', group: 'Orders v1', status: 'done', source: 'docs/plan.md:8',
    goal: 'Tables for customers, products, orders and order lines.',
    summary: 'Migrations 001-004 in db/migrations; seeded fixtures for local dev.' },
  { title: 'Orders REST endpoints', group: 'Orders v1', deps: ['#1'], goal: 'CRUD for /orders with pagination.' },
  { title: 'Input validation with zod', group: 'Orders v1', deps: ['#2'] },
  { title: 'Integration tests for orders', group: 'Orders v1', deps: ['#2'],
    next: ['Add fixtures for cancelled orders', 'Run npm test -- orders.int'] },
  { title: 'Stripe payment intents', group: 'Payments', goal: 'Create and confirm payment intents for checkout.' },
  { title: 'Refund flow', group: 'Payments', deps: ['#5'] },
  { title: 'Webhook signature verification', group: 'Payments', deps: ['#5'] },
  { title: 'JWT authentication', group: 'Auth', goal: 'Issue and verify access + refresh tokens.' },
  { title: 'Rate limiting', group: 'Hardening' },
  { title: 'Audit log for admin actions', group: 'Hardening' },
  { title: 'GraphQL gateway spike', group: 'Research', goal: 'Dropped: REST covers every client.' },
]);

bulk('web', [
  { title: 'Design tokens and theme', group: 'Foundation', status: 'done',
    summary: 'Color, spacing and type tokens in src/styles/tokens.css; light and dark themes.' },
  { title: 'Product listing page', group: 'Catalog', deps: ['#1'] },
  { title: 'Product detail page', group: 'Catalog', deps: ['#1'] },
  { title: 'Cart drawer', group: 'Checkout', deps: ['#1'] },
  { title: 'Checkout form', group: 'Checkout', deps: ['#4', 'Storefront API:T-005'],
    goal: 'Address, shipping and payment steps wired to the payment intents API.' },
  { title: 'Order history page', group: 'Account', deps: ['Storefront API:T-002'] },
  { title: 'Login and signup', group: 'Account', deps: ['Storefront API:T-008'] },
]);

bulk('docs', [
  { title: 'Docs site scaffold', group: 'Setup', status: 'done', summary: 'Astro Starlight site with search and versioning.' },
  { title: 'API reference generated from OpenAPI', group: 'Content', deps: ['Storefront API:T-002'] },
  { title: 'Getting started guide', group: 'Content', next: ['Write the local setup section'] },
]);

const p = (key) => projects[key].dir;
const flow = (key, id, ...cmds) => cmds.forEach((c) => run(p(key), ...c(id)));
const start = (id) => ['start', id];
const done = (summary) => (id) => ['done', id, '--summary', summary];
const log = (msg) => (id) => ['log', id, msg];
const next = (...steps) => (id) => ['next', id, ...steps];

flow('api', 'T-002', start, log('List and detail endpoints implemented'),
  done('GET/POST/PATCH/DELETE /orders in src/routes/orders.ts with cursor pagination.'));
flow('api', 'T-003', start, done('zod schemas in src/schemas/order.ts; 400 responses with field errors.'));
flow('api', 'T-004', start, log('Happy-path tests passing'), next('Add fixtures for cancelled orders', 'Run npm test -- orders.int'));
flow('api', 'T-005', start, log('Payment intent creation works in test mode'), next('Handle 3-D Secure confirmation', 'Store intent id on the order'));
flow('api', 'T-008', start, done('Access + refresh tokens with rotation in src/auth/.'));
flow('api', 'T-009', start, done('Token bucket per API key, 100 req/min, Redis-backed.'));
run(p('api'), 'status', 'T-007', 'blocked', '--note', 'Waiting for the production webhook secret');
run(p('api'), 'archive', 'T-011');

flow('web', 'T-002', start, done('Grid with filters and infinite scroll in src/pages/products.'));
flow('web', 'T-003', start, log('Gallery and variant picker done'), next('Add reviews section', 'Lazy-load related products'));
flow('web', 'T-004', start, done('Slide-over cart with quantity editing and totals.'));
flow('web', 'T-007', start, next('Wire refresh-token rotation', 'Add "remember me"'));

flow('docs', 'T-003', start, next('Write the local setup section'));

// Spread activity over the last two weeks so the charts look lived-in, and show tidy project paths.
const ago = (days, hours = 0) => {
  const d = new Date(Date.now() - days * 864e5 - hours * 36e5);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
};
const when = {
  api: { 'T-002': 11, 'T-003': 9, 'T-004': 0.2, 'T-005': 4.5, 'T-007': 2, 'T-008': 6, 'T-009': 3, 'T-011': 5 },
  web: { 'T-002': 8, 'T-003': 0.1, 'T-004': 5, 'T-007': 1 },
  docs: { 'T-003': 7 },
};
const reg = JSON.parse(fs.readFileSync(path.join(home, 'registry.json'), 'utf8'));
for (const [key, proj] of Object.entries(projects)) {
  const entry = reg.projects.find((x) => x.name === proj.name);
  entry.path = proj.fake;
  const dir = path.join(home, 'projects', entry.slug);
  const idxFile = path.join(dir, 'index.json');
  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  for (const t of idx.tasks) {
    const d = when[key]?.[t.id];
    if (d === undefined) continue;
    t.updated = ago(d, 2);
    if (t.completed && !t.imported) t.completed = t.updated;
    if (t.archived) t.archived = t.updated;
  }
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2));
  const cfgFile = path.join(dir, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.path = proj.fake;
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
}
fs.writeFileSync(path.join(home, 'registry.json'), JSON.stringify(reg, null, 2));
run(p('api'), 'render');

// ---------- screenshots ----------
function findBrowser() {
  const i = process.argv.indexOf('--browser');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (process.env.BROWSER) return process.env.BROWSER;
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
  ];
  const hit = candidates.find((c) => fs.existsSync(c));
  if (!hit) {
    console.error('No Edge/Chrome found. Pass --browser <path> or set BROWSER.');
    process.exit(1);
  }
  return hit;
}

const browser = findBrowser();
// The archive command in the task dialog shows the CLI path; use a neutral one instead of this machine's.
const board = fs.readFileSync(path.join(home, 'board.html'), 'utf8')
  .replace(/"cli":"[^"]*"/, '"cli":"C:/Users/you/.claude/plugins/cache/rafal-tools/rafal-tools/x.y.z/skills/task-tracker/scripts/tt.mjs"');
const webSlug = reg.projects.find((x) => x.name === 'Storefront Web').slug;

// Each variant is the real board plus a small script that sets up the view to capture.
const variant = (name, js) => {
  fs.writeFileSync(path.join(home, `${name}.html`), board.replace('</body>', `<script>${js}</script></body>`));
  return `${name}.html`;
};
const closeHelp = "document.getElementById('help').open = false;";
const shots = [
  ['board-overview', '1440,1760', variant('v-overview', `${closeHelp} toggleColumn('done'); document.getElementById('archive-toggle').click(); document.activeElement.blur();`)],
  ['board-project-dark', '1440,1240', variant('v-dark', `${closeHelp} setTheme('dark');
    const s = document.getElementById('project'); s.value = '${webSlug}'; s.dispatchEvent(new Event('change'));`)],
  ['task-dialog', '1200,1000', variant('v-dialog',
    "openTask(ALL.find((t) => t.projectName === 'Storefront Web' && t.id === 'T-005'));")],
];
// Headless browsers will not shrink the window below ~500px, so phone width is rendered in a 390px iframe.
fs.writeFileSync(path.join(home, 'v-mobile.html'),
  '<body style="margin:0"><iframe src="board.html" style="width:390px;height:1200px;border:0;display:block"></iframe></body>');
shots.push(['board-mobile', '390,1185', 'v-mobile.html']);

// A fresh profile per shot, so collapsed columns or the archive toggle saved by one variant never leak into the next.
for (const [name, size, page] of shots) {
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    `--user-data-dir=${path.join(work, `profile-${name}`)}`,
    '--virtual-time-budget=2000', `--window-size=${size}`, `--screenshot=${path.join(OUT, `${name}.png`)}`,
    pathToFileURL(path.join(home, page)).href], { stdio: 'ignore' });
  console.log(path.relative(ROOT, path.join(OUT, `${name}.png`)));
}

fs.rmSync(work, { recursive: true, force: true });
