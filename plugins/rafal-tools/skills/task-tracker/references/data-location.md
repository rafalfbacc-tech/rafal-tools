# Data location, config and moving the board

The data folder holds everything: the registry, all task files and `board.html`. It is resolved in this order:
1. the `TASK_TRACKER_HOME` env var;
2. `"dataDir"` in `~/.claude/task-tracker.config.json`;
3. the default `~/.claude/task-tracker/`.

- **"Where is the board?"** → `tt config`. It shows the config file, the data folder and its source, the board path and the project count.
- **"Move the board/data to <dir>"** → **confirm with the user first**, then `tt move "<dir>"`. It:
  - copies everything and verifies the file count;
  - writes `dataDir` to the config and re-renders the board in the new place;
  - removes the old folder (`--keep-old` keeps it);
  - refuses a target that already holds tracker data, or one nested inside the old folder or the other way round.
- **"Use the data in <dir>"**, e.g. a synced folder that already has tracker data → `tt config set dataDir "<dir>"`. This only repoints the tracker and copies nothing.
- When `TASK_TRACKER_HOME` is set it wins over the config and `move` refuses to run. Tell the user to unset it.

Layout (nothing is written into the repos):
```
<data folder>/registry.json            tracked folders -> project slug
<data folder>/board.html               board for all projects
<data folder>/projects/<slug>/index.json, config.json, tasks/T-007.md (open), archive/T-001.md (done), board.html (bookmark)
```
Always write through the CLI. Never edit these files by hand.

## Other settings (same config file)

- `"resumeLimit": 5` sets how many open tasks the session-start list and `tt resume` show. In-progress and blocked tasks are always shown; the rest is summarized as "+N more todo". Change it with `tt config set resumeLimit <n>` or by editing the file. `tt resume --all` lists everything.
