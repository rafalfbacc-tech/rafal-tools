# Import: assess existing progress from markdown

Run after a first `init`, or when the user asks to import or re-assess plans. Goal: a board showing what is **left** and what is **already done**, at minimal token cost.

1. **Overview first:** `tt scan [dir] --items`. It lists every markdown file (node_modules, .git, build output and similar are skipped) with checkbox counts, `Status:` lines and size, plus each unchecked item with its line number. Do not open files yet.
2. **Pick sources:** plans, specs, roadmaps, TODO/CHANGELOG files and task lists. README, docs and API references are not sources unless they contain task lists.
3. **Read only the sources**, and for large files only the relevant sections. Jump straight to the unchecked items by their line numbers.
4. **Assess each task:**
   - `[x]` or an explicit done status → `done`; `[ ]` → not done.
   - No markers, or markers that look stale → check cheaply with Grep/Glob for the files, functions or endpoints the task names. Never read whole modules.
   - Partially done → `in-progress`, with `next` naming what is missing.
   - Unsure → `todo`, plus a short note on what to check.
5. **One `tt bulk` call.** Write the JSON to the scratchpad, never to the repo. Make one task per independent unit, use the plan's name as `group`, and set `source` to `file.md:LINE`:
   ```json
   [
     {"title":"Add order endpoints","group":"Orders plan","status":"done","source":"docs/plan.md:12",
      "goal":"CRUD for /orders","summary":"GET/POST/PUT/DELETE in src/api/orders.ts; covered by orders.test.ts"},
     {"title":"Write integration tests","group":"Orders plan","source":"docs/plan.md:20",
      "goal":"Integration tests for the orders API","next":["Create tests/orders.int.test.ts"],"deps":["#1"]}
   ]
   ```
   - **Done tasks need a `summary`:** one or two sentences on what was built and where.
   - **Open tasks need a `goal`**, and `next` where known.
   - **`deps`:** `"#n"` = the n-th item of this file, `"T-004"` = an existing task, `"other-project:T-002"` = a task in another project, or an exact task title. Record only real dependencies (see `dependencies.md`); plans often state them ("after", "requires", phases).
6. `bulk` skips tasks whose title and group already exist, so re-importing is safe. To change existing tasks, use `status`, `summary` or `next`.
7. Report briefly: how many tasks were imported as done and as open, any uncertain ones, and where the board is.
