---
name: security-audit
description: Security audit / pentest / vulnerability scan of the user's own app (web, SaaS, API, mobile, desktop), run phase by phase - recon, test plan, code scan with free scanners, localhost verification with test accounts per role, abuse/load checks, prioritized report in .security/. Use when asked to check an app for security holes, find vulnerabilities, or run /rafal-tools:security-audit <phase>.
---

# Security Audit

`sa` = `node "<this skill's base directory>/scripts/sa.mjs"`. Never type `sa` literally. `sa help` lists every command.
`<appRoot>` = the current working directory unless the user names another folder.

## Phases: one per invocation

Read **only** the reference file of the requested phase, plus the `platform-*.md` files named on the `Platforms:` line of `.security/recon.md` when that phase says so. Do not read other phases' files.

| Invocation | Read | Writes |
|---|---|---|
| bare, or `status` | nothing: run `sa status <appRoot>`, show its output, stop | none |
| `init` | `references/phase-init.md` | `recon.md`, `config.yaml`, `.gitignore` entry |
| `plan` | `references/phase-plan.md` | `test-plan.md` |
| `scan [area\|--changed]` | `references/phase-scan.md` | `findings.md`, `tools/*` |
| `verify` | `references/phase-verify.md` | updates `findings.md` |
| `stress` (optional) | `references/phase-stress.md` | updates `findings.md` |
| `report` | `references/phase-report.md` | `report.md` |

If `.security/` is missing and the phase is not `init`, tell the user to run `init` first and stop.

## Rules for every phase

- **Own apps only.** Dynamic tests run only against hosts in the config scope (`localhost`, own test environment). Never production, never third-party hosts.
- **English files, the user's language in chat.** Everything written to `.security/` is in English.
- **No passwords anywhere.** Refer to accounts by role (`admin`, `user`, ...). Never print `config.yaml` contents.
- **Two anti-goals:**
  1. *False positives:* no finding without a traced data path (`references/findings-format.md`). Scanner output only provides candidates. Reject false positives with `sa reject` so they never come back.
  2. *Token use:* read what the test plan points at, not the whole codebase. Never read raw scanner output; use `sa filter`. Hand large scans to subagents.
- **Escalate on blockers.** If you hit a blocker and are not already on the most capable model, switch to **Opus 4.8** before continuing or giving up — in Claude Code `/model opus`, or dispatch the hard step to a subagent on Opus 4.8 (`model: "opus"`). Blockers include: a scanner that will not install, a candidate whose exploitability you cannot determine from the code, a cross-file data path you cannot trace, or a tool that keeps failing. Do not abandon or downgrade a phase while a more capable model could resolve it; a weaker model that guesses produces exactly the two anti-goals above.
- **End of every phase:** run `sa phase-done <appRoot> <phase>`, then give the user a 2–4 line summary in their language and the next command from that output.
