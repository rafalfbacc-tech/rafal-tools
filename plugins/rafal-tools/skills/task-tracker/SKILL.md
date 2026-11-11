---
name: task-tracker
description: Task tracking per project folder with an HTML board. Use for "track this", importing plan progress, resuming work, what is left/ready, task dependencies, the board, and every request where a [task-tracker] notice is present.
---

# Task Tracker

`tt` = `node "<this skill's base directory>/scripts/tt.mjs"`; hook notices print the exact path. Never type `tt` literally. Write only through the CLI; `tt help` lists every command. Keep token use minimal: open reference files only when their topic comes up, and never read the tracker's data files directly.

| When | Do |
|---|---|
| Invoked with no request (e.g. bare `/rafal-tools:task-tracker`) | `tt usage`, show its output unchanged in a code block, then stop |
| "track this" / "track <folder>" | `tt init [dir] [--name ".."]`. After a first init, follow `references/import.md` unless the user wants to start empty. Never init a folder the user did not mark |
| Import or re-assess plans | `references/import.md` |
| Dependencies (also across projects) | `references/dependencies.md` |
| Board location, moving it, config | `references/data-location.md` |
| "What is left?" / "what is ready?" | `tt list` / `tt list --ready` |
| Change a task's goal, title or work-done text | `tt goal <ID> ".."` / `tt rename <ID> ".."` / `tt summary <ID> ".."` |
| Stop / resume tracking · board · all projects | `tt off` / `tt on` · `tt open` · `tt projects` |
| Archive / restore tasks | `tt archive <ID>...` / `tt unarchive <ID>...`; archived tasks are hidden and never hold up dependents. Mention tasks it reports as ready |
| Role chain (Opus, Codex, Sonnet, Haiku stages) | `tt chain new "Name" ["Description"]`. `tt chain run` needs the user's confirmations, so never run it yourself: give the user the exact command for their own terminal |

No `[task-tracker]` notice: with hooks installed the folder is untracked, so do nothing. Without hooks (other agents, standalone install), run `tt resume` once per session; "not tracked" means do nothing.

## 1. One task per independent unit
- Every request that changes the project maps to at least one task. Questions and read-only turns need no tracker call.
- A plan with N tasks becomes N tasks sharing one `--group`. For more than 3, use `tt bulk <temp folder>/t.json` (scratchpad or OS temp, never the repo) with `[{"title","goal","group","next":[..],"deps":["#1"]}]`.
- A task is finishable and verifiable on its own. Split anything larger than a session.
- `--goal` holds the outcome and acceptance criteria in 1–2 sentences.
- A follow-up continues the existing task; never duplicate it.
- If a task needs another task's output, add `--dep T-004`.

## 2. Record progress
Use as few calls as possible; one per task per turn is usually enough. Unknown flags are rejected.
1. Before working: `tt start <ID>`, or for a new task `tt add "Title" --goal ".." --start`. Both refuse tasks that wait for dependencies; use `tt start --force` only if the user insists. A `tt log` on a ready todo task also starts it.
2. Before ending a turn, for every task you touched: `tt log <ID> "what was done" --next "step" [--next ".."] [--note "durable context"]`. `--next` replaces the next steps, so make them concrete (files, functions, commands). `--note` keeps decisions and gotchas.
3. Verified → `tt done <ID> --summary "what was built and where"`, then mention any tasks it reports as ready. Stuck → `tt status <ID> blocked --note "why"`.
4. The stop hook checks only turns that edited project files. If those edits were not task work → `tt skip`.

## 3. Resume cheaply
1. Use the session-start list or `tt resume`.
2. Pick, in this order: the task the user names, the first in-progress task, the first ready todo. Never pick one marked `WAITS FOR`; name its dependencies and offer to do them first.
3. Load only that task with `tt show <ID>`. It shows the last 5 log entries; use `--full` only if needed. Do not reload the original plan when the task file suffices.
4. Phrases:
   - "continue" → the first in-progress task;
   - "resume/start T-005" → `tt start` it if it is todo;
   - "T-004 is unblocked: …" → `tt log` the reason, then `tt start`.
5. Tell the user in one line which task you are resuming and its next step, then continue.
