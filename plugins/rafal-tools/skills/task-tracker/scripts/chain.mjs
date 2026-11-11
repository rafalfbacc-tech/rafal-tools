#!/usr/bin/env node
// Role chain: runs tracker tasks one at a time, each with its own agent in a Windows Terminal tab.
// The next stage starts only after the owner confirms it. Run through `tt chain`.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  agentOf, buildAgentCommand, buildBrief, buildPrompt, buildTasks,
  parseDataDir, parseList, pickGroup, runLoop,
} from './chain-lib.mjs';

const POLL_MS = 3000;
const slash = (p) => p.replaceAll('\\', '/');
const THIS_FILE = fileURLToPath(import.meta.url);
const USAGE = `Usage, inside a tracked project:
  chain new "Name" ["Task description"]   add the 8 stages to the tracker
  chain run ["Name"]                      lead the chain and propose each next stage
  chain brief <ID>                        print the instructions for an agent`;

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.question(question, (answer) => { answered = true; rl.close(); resolve(answer); });
    rl.on('close', () => { if (!answered) resolve('n'); });
  });
}

// selfPath is the script the user started, so agents return through the same entry point.
export async function main(argv, ttFile = path.join(path.dirname(THIS_FILE), 'tt.mjs')) {
  const ttPath = slash(ttFile);
  const selfPath = slash(path.resolve(process.argv[1]));
  const tt = (...args) => execFileSync(process.execPath, [ttPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const [command, ...args] = argv;

  switch (command) {
    case 'new': {
      const [name, description] = args;
      if (!name) throw new Error(USAGE);
      const file = path.join(os.tmpdir(), `chain-${process.pid}.json`);
      fs.writeFileSync(file, JSON.stringify(buildTasks(name, description ?? '')));
      try {
        process.stdout.write(tt('bulk', file));
      } finally {
        fs.rmSync(file, { force: true });
      }
      console.log(`Ready. To start, run in your own terminal: node "${selfPath}" run "${name}"`);
      return 0;
    }
    case 'run': {
      const group = pickGroup(parseList(tt('list', '--all')), args[0]);
      const exitFile = (task) => path.join(os.tmpdir(), `chain-exit-${process.pid}-${task.id}`);
      console.log(`Chain: ${group.slice('chain: '.length)}. Ctrl+C closes this control window; agents keep working.`);
      return runLoop({
        list: () => parseList(tt('list', '--all')).filter((t) => t.group === group),
        start: (id) => tt('start', id),
        show: (id) => tt('show', id),
        launch: (task) => launchInTab(task, exitFile(task), selfPath),
        hasExited: (task) => fs.existsSync(exitFile(task)),
        clearExit: (task) => fs.rmSync(exitFile(task), { force: true }),
        ask,
        sleep: () => new Promise((r) => setTimeout(r, POLL_MS)),
        log: (message) => console.log(message),
        tt: `node "${ttPath}"`,
      });
    }
    case 'brief':
      if (!args[0]) throw new Error(USAGE);
      console.log(buildBrief({ id: args[0], show: tt('show', args[0]), ttPath }));
      return 0;
    case '_agent': {
      const [id, agent, exitPath, trackerHome] = args;
      if (trackerHome) process.env.TASK_TRACKER_HOME = trackerHome;
      const agentCommand = buildAgentCommand(agent, {
        prompt: buildPrompt(id, selfPath),
        selfPath,
        ttPath,
        dataDir: parseDataDir(tt('config')),
      });
      const result = spawnSync(agentCommand, { shell: true, stdio: 'inherit' });
      fs.writeFileSync(exitPath, String(result.status ?? 'error'));
      return result.status ?? 1;
    }
    default:
      console.log(USAGE);
      return command ? 1 : 0;
  }
}

function launchInTab(task, exitPath, selfPath) {
  const agent = agentOf(task.title);
  const args = ['-w', 'tt-chain', 'new-tab', '--title', `${task.id} ${agent}`, '-d', process.cwd(),
    'node', selfPath, '_agent', task.id, agent, exitPath];
  if (process.env.TASK_TRACKER_HOME) args.push(process.env.TASK_TRACKER_HOME);
  const child = spawn('wt', args, { detached: true, stdio: 'ignore' });
  child.on('error', (e) => {
    console.error(`Could not open Windows Terminal: ${e.message}`);
    fs.writeFileSync(exitPath, 'error');
  });
  child.unref();
}

export function runCli(argv, ttFile) {
  return main(argv, ttFile)
    .then((code) => { process.exitCode = code ?? 0; })
    .catch((e) => {
      console.error((e.stderr || e.message).toString().trim());
      process.exitCode = 1;
    });
}

if (path.resolve(process.argv[1] ?? '') === THIS_FILE) runCli(process.argv.slice(2));
