# Dependencies

Record a dependency only when a task **cannot start or finish without another task's output**: a schema before the endpoints that use it, an API before its client, a helper before its callers, or explicit plan ordering ("after", "requires", "once X is merged", "Phase 2"). Do not link tasks that merely sit near each other in the plan, since over-linking hides parallel work. When in doubt, add a note instead.

## Recording

- `tt add "Title" --dep T-004 --dep T-002`
- `tt dep <ID> <DEP_ID>...` adds and `tt undep <ID> <DEP_ID>...` removes.
- In `bulk` `"deps"`: `"#n"` (the n-th item of the same file), `"T-004"`, or an exact task title.
- **Another project:** `<project>:T-002`, where `<project>` is the slug, the project name or the folder name (`tt projects` lists them). Example: `tt dep T-005 backend:T-002`.
- The CLI rejects unknown projects or IDs, self-dependencies and cycles, including cycles that span projects.
- When a dependency shows up mid-work ("this needs the auth refactor first"), add it with `tt dep` and tell the user.

## Behaviour

- A todo task with unfinished dependencies **waits**. `resume` and `list` mark it `WAITS FOR ...`, and `list --ready` shows only startable tasks.
- `tt start` refuses a waiting task. Use `--force` only when the user explicitly insists.
- `tt show` starts with `[deps]` lines naming the unfinished dependencies and the tasks this one blocks.
- `tt done` prints the tasks that just became ready, in any project. Offer them to the user as the next work.
- An **archived** dependency counts as satisfied, so `tt archive` can also make tasks ready (it prints them). New dependencies on archived tasks are rejected, and `tt unarchive` reports tasks that wait again.
