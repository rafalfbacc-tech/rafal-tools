---
name: plugin-cost
description: Report each enabled plugin's per-session token cost and how often it was really used, with cleanup suggestions. Use when asked about plugin/skill token cost, context overhead, or which plugins to disable.
---

# Plugin Cost

1. Run `node "<this skill's base directory>/scripts/plugin-cost.mjs"`. It takes ~5–10 s. Add `--days N` for another usage window (default 30), `--here` to measure hooks in the current folder (shows folder-specific injections such as a task list; SessionStart hooks then run there for real, UserPromptSubmit hooks still run in an empty folder), or `--no-hooks` to skip running hooks.
2. Show the output unchanged, in a code block.
3. Below it, give at most 3 concrete recommendations in the user's language, based on the Findings and the numbers:
   - **Never used and costly** → disable globally.
   - **Used only in a few projects** → disable globally and enable per project.
   - **Duplicate scopes** → `claude plugin uninstall <id> --scope project --keep-data`, run in that project folder. Never use `disable --scope project` for this: it turns the plugin off there.
   Include the exact command for each.
4. **Never run `claude plugin disable/enable` or edit settings yourself** unless the user explicitly confirms. Remind them that changes apply from the next session.

How the numbers are built:
- **Skills** = skill and agent descriptions, from `claude plugin details`.
- **Hook** = text that SessionStart hooks inject; the script measures it by running the hooks in an empty temp folder.
- **Usage** = counted from local session history in `~/.claude/projects`.
- **Token counts** are estimates of about 4 characters per token.
