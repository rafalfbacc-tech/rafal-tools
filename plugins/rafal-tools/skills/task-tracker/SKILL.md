---
name: task-tracker
description: Task tracking per project folder with an HTML board. Use for "track this", importing plan progress, resuming work, what is left/ready, task dependencies, the board, and every request where a [task-tracker] notice is present.
---

# Task Tracker

`tt` = `node "<this skill's base directory>/scripts/tt.mjs"`; hook notices print the exact path. Never type `tt` literally. Write only through the CLI; `tt help` lists every command. Keep token use minimal: open reference files only when their topic comes up, and never read the tracker's data files directly.

| When | Do |
|---|---|
| Bare `/rafal-tools:task-tracker` | `tt usage`, show its output unchanged in a code block, then stop |
| "track this" / "track <folder>" | `tt init [dir] [--name ".."]`. After a first init, follow `references/import.md` unless the user wants to start empty. Never init a folder the user did not mark |
| Import or re-assess plans | `references/import.md` |
| Dependencies (also across projects) | `references/dependencies.md` |
| Board location, moving it, config | `references/data-location.md` |
| Stop / resume tracking · board · all projects | `tt off` / `tt on` · `tt open` · `tt projects` |
| Archive / restore tasks | `tt archive <ID>...` / `tt unarchive <ID>...`; archived tasks are hidden and never hold up dependents. Mention tasks it reports as ready |

No `[task-tracker]` notice means the folder is untracked: do nothing.

## 1. One task per independent unit
- Every request in a tracked folder maps to at least one task.
- A plan with N tasks becomes N tasks sharing one `--group`. For more than 3, use `tt bulk <scratchpad>/t.json` with `[{"title","goal","group","next":[..],"deps":["#1"]}]`.
- A task is finishable and verifiable on its own. Split anything larger than a session.
- `--goal` holds the outcome and acceptance criteria in 1–2 sentences.
- A follow-up continues the existing task; never duplicate it.
- If a task needs another task's output, add `--dep T-004`.

## 2. Record progress
1. `tt start <ID>` before working. It refuses tasks that wait for dependencies; use `--force` only if the user insists.
2. `tt log <ID> "milestone"` after meaningful steps. Durable context (files, decisions, gotchas) goes in `tt note <ID> "..."`.
3. Before ending a turn, run `tt next <ID> "step" ...` with concrete steps (files, functions, commands) for every task you touched.
4. Verified → `tt done <ID> --summary "what was built and where"`, then mention any tasks it reports as ready. Stuck → `tt status <ID> blocked --note "why"`.
5. A turn with no task work → `tt skip`.

## 3. Resume cheaply
1. Use the session-start list or `tt resume`.
2. Pick, in this order: the task the user names, the first in-progress task, the first ready todo. Never pick one marked `WAITS FOR`; name its dependencies and offer to do them first.
3. Load only that task with `tt show <ID>`. It shows the last 5 log entries; use `--full` only if needed. Do not reload the original plan when the task file suffices.
4. Phrases:
   - "continue" → the first in-progress task;
   - "resume/start T-005" → `tt start` it if it is todo;
   - "T-004 is unblocked: …" → `tt log` the reason, then `tt start`.
5. Tell the user in one line which task you are resuming and its next step, then continue.
