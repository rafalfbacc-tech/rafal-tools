// Logic of the role chain (`tt chain`). Everything that touches the terminal lives in chain.mjs.

export const GROUP_PREFIX = 'chain: ';
const LINE = /^(T-\d+) \[(todo|in-progress|blocked|done)\] (?:\{(.*?)\} )?(.*?)(?: — (.*))?$/;

export function parseList(text) {
  const tasks = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line.trim());
    if (!m) continue;
    tasks.push({
      id: m[1],
      status: m[2],
      group: m[3] ?? '',
      title: m[4],
      waits: (m[5] ?? '').includes('WAITS FOR'),
    });
  }
  return tasks;
}

export function agentOf(title) {
  return /\[(opus|sonnet|haiku|codex)\]/.exec(title)?.[1] ?? null;
}

// One stage at a time: blocked tasks first, then running work, and only then a new proposal.
export function decide(tasks, launched, hasExited) {
  const blocked = tasks.find((t) => t.status === 'blocked');
  if (blocked) return { kind: 'blocked', task: blocked };

  const active = tasks.find((t) => t.status === 'in-progress' || (t.status !== 'done' && launched.has(t.id)));
  if (active) {
    if (!launched.has(active.id)) return { kind: 'orphan', task: active };
    return { kind: hasExited(active) ? 'aborted' : 'wait', task: active };
  }

  const open = tasks.filter((t) => t.status !== 'done');
  if (open.length === 0) return { kind: 'finished' };
  const ready = open.find((t) => !t.waits);
  return ready ? { kind: 'propose', task: ready } : { kind: 'stuck', task: open[0] };
}

const isYes = (answer, fallback) => {
  const a = String(answer ?? '').trim().toLowerCase();
  if (a === '') return fallback;
  return a === 'y' || a === 'yes';
};

export async function runLoop({ list, start, show, launch, hasExited, clearExit, ask, sleep, log, tt }) {
  const launched = new Set();
  let waitingFor = null;

  const launchTask = (task) => {
    start(task.id);
    clearExit(task);
    launched.add(task.id);
    log(`Starting ${task.id}: ${task.title}`);
    launch(task);
  };

  for (;;) {
    const tasks = list();
    for (const id of [...launched]) {
      const t = tasks.find((x) => x.id === id);
      if (t?.status === 'done') {
        log(`${t.id} done: ${t.title}`);
        launched.delete(id);
      }
    }

    const d = decide(tasks, launched, hasExited);
    if (d.kind !== 'wait') waitingFor = null;

    switch (d.kind) {
      case 'finished':
        log('All stages are done.');
        return 0;
      case 'blocked':
        log(`${d.task.id} is blocked: ${d.task.title}\n${show(d.task.id)}`);
        log(`Once the problem is solved, run: ${tt} status ${d.task.id} todo, then start the chain again.`);
        return 1;
      case 'stuck':
        log(`${d.task.id} is waiting for a task outside this chain: ${d.task.title}`);
        return 1;
      case 'propose': {
        if (!agentOf(d.task.title)) {
          log(`${d.task.id} has no role in its title, so no model was chosen for it: ${d.task.title}`);
          log(`Add a role, for example: ${tt} rename ${d.task.id} "Fix [sonnet]: description"`);
          return 1;
        }
        const answer = await ask(`Start ${d.task.id}: ${d.task.title}? [Y/n] `);
        if (!isYes(answer, true)) {
          log('Stopped. Start the chain again to continue.');
          return 1;
        }
        launchTask(d.task);
        break;
      }
      case 'aborted': {
        const answer = await ask(`${d.task.id}: the agent exited without marking the task done. Start it again? [Y/n] `);
        if (!isYes(answer, true)) {
          log(`Stopped. ${d.task.id} stays in progress.`);
          return 1;
        }
        launchTask(d.task);
        break;
      }
      case 'orphan': {
        const answer = await ask(`${d.task.id} is in progress: ${d.task.title}. Start the agent again? Answer n to wait for an agent that is already running. [y/N] `);
        if (isYes(answer, false)) launchTask(d.task);
        else launched.add(d.task.id);
        break;
      }
      case 'wait':
        if (waitingFor !== d.task.id) {
          log(`Waiting for ${d.task.id}. The agent works in its own tab, where you can type as usual.`);
          waitingFor = d.task.id;
        }
        await sleep();
        break;
    }
  }
}

export function toSlug(name) {
  return name
    .replaceAll('ł', 'l').replaceAll('Ł', 'L')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildTasks(name, description = '') {
  const group = `${GROUP_PREFIX}${name}`;
  const dir = `docs/chain/${toSlug(name)}`;
  const ending = /[.!?]\s*$/.test(description) ? '' : '.';
  const task = description ? ` Task description: ${description}${ending}` : '';
  const stages = [
    ['Assumptions', 'opus', `Write the implementation assumptions for "${name}".${task} Save them in ${dir}/assumptions.md: goal, scope, architecture, files to change, acceptance criteria and risks. Do not change code.`],
    ['Assumption review', 'codex', `Critically review ${dir}/assumptions.md against the project code. Save specific findings in ${dir}/assumptions-review.md. Do not change code or the assumptions.`],
    ['Review decisions', 'opus', `Read ${dir}/assumptions-review.md and decide on every finding. Update ${dir}/assumptions.md and add a short reason next to each rejected finding. Do not change code.`],
    ['Implementation', 'sonnet', `Implement ${dir}/assumptions.md, including tests for new behavior. Commit on the current branch. Describe any deviations from the assumptions in the task summary.`],
    ['Test run', 'haiku', `Run the project tests and record the commands and results in ${dir}/test-report.md. Do not change code. If tests fail, describe that in the report and mark the task blocked.`],
    ['Code review', 'codex', `Review the changes from the implementation stage against ${dir}/assumptions.md. Save findings in ${dir}/code-review.md with severity and code location. Do not change code.`],
    ['Fixes', 'sonnet', `Apply the fixes from ${dir}/code-review.md, run the tests and commit on the current branch. For a rejected finding, add the reason to ${dir}/code-review.md.`],
    ['Implementation assessment', 'opus', `Assess the implementation against the criteria in ${dir}/assumptions.md, using ${dir}/test-report.md, ${dir}/code-review.md and the repository changes. Save the verdict in ${dir}/assessment.md. For each required fix, add a task: tt add "Fix [sonnet]: description" --group "${group}" --goal "what to fix". Do not change code.`],
  ];
  return stages.map(([stage, agent, goal], i) => ({
    title: `${stage} [${agent}]: ${name}`,
    goal,
    group,
    ...(i > 0 ? { deps: [`#${i}`] } : {}),
  }));
}

export function buildPrompt(id, selfPath) {
  return `Run this command: node ${selfPath} brief ${id} and do what it prints.`;
}

export function buildAgentCommand(agent, { prompt, selfPath, ttPath, dataDir }) {
  if (agent === 'codex') return `codex "${prompt}" --add-dir "${dataDir}"`;
  if (/\s/.test(selfPath + ttPath)) {
    throw new Error(`The role chain cannot run from a path with a space, because permission rules cannot match it: ${ttPath}`);
  }
  // --allowedTools takes many values, so it has to come after the prompt.
  // The quoted form is the one that tracker hooks print.
  return `claude "${prompt}" --model ${agent} --allowedTools "Bash(node ${selfPath} *)" "Bash(node ${ttPath} *)" "Bash(node \\"${ttPath}\\" *)"`;
}

export function buildBrief({ id, show, ttPath }) {
  // No quotes around the path: the command has to match the --allowedTools rule literally.
  const tt = `node ${ttPath}`;
  return `${show.trim()}

---
Complete the goal of task ${id}. Check the result of your work before you finish.
The task title holds the role and model chosen by the owner. If the task is unclear, ask the owner here in the console.

The tt command always means: ${tt}
Use only this form, even when a hook or another tracker message shows a different path.
When you finish, run: ${tt} done ${id} --summary "what was done, how it was checked, and file paths"
If you cannot finish, run: ${tt} status ${id} blocked --note "reason"
Do not start other tasks. The next stage starts only when the owner approves it.`;
}

export function pickGroup(tasks, name) {
  const chains = tasks.filter((t) => t.group.startsWith(GROUP_PREFIX));
  if (name) {
    const group = `${GROUP_PREFIX}${name}`;
    if (!chains.some((t) => t.group === group)) throw new Error(`There is no chain named "${name}".`);
    return group;
  }
  const open = [...new Set(chains.filter((t) => t.status !== 'done').map((t) => t.group))];
  if (open.length === 1) return open[0];
  if (open.length === 0) throw new Error('There are no open chains. Create one with: chain new "Name"');
  throw new Error(`Several chains are open, so pass a name: ${open.join(', ')}`);
}

export function parseDataDir(configOutput) {
  const m = /^Data folder\s*:\s*(.+?)\s{2,}\(/m.exec(configOutput);
  if (!m) throw new Error('Could not read the tracker data folder.');
  return m[1];
}
