# Phase: verify (confirm on localhost)

Goal: confirm or clear findings against the running app, so the report separates real issues from code-only suspicions.

## Before anything

Follow `references/dynamic-rules.md` in order: scope check, start the app, the backup gate (ask once), log in per role. Do not send a data-changing request before the backup gate is satisfied.

## Inputs

- `.security/findings.md` (entries with confidence `likely` or `needs-check`) and `.security/test-plan.md` (goals `Covered by: verify`).
- `references/findings-format.md`, `references/dynamic-rules.md`.

## Steps

1. **Reproduce each open finding** and work each `verify` goal, as the relevant role, using `curl` or a small Node script in `.security/tools/`:
   - Reproduced: set the finding to `confirmed` and attach the request and response as evidence (passwords redacted).
   - Not reproduced: keep the confidence and add a note `not reproduced: <reason>` (for example a framework check blocks it).
   - A finding previously `confirmed` whose code has since changed (per `sa changed`) and that no longer reproduces: set `State: fixed`. This is how re-testing after a fix is recorded.
2. **Access-control matrix.** For each sensitive endpoint, send the same request as every role and unauthenticated. Any response that returns another role's or another tenant's data, or performs an action the role should not have, is a confirmed finding.
3. **Baseline web scan** if `tools.md` lists ZAP/nuclei and they are available: run against the in-scope URL, `sa filter` the output, and promote only candidates you can tie to a goal or confirm.
4. Keep load low and bounded; this phase is about correctness of access control, not throughput (that is `stress`).
5. **Finish:** run `sa redact <appRoot>`, then `sa phase-done <appRoot> verify`. If the skill started the app, stop it. Summarize how many findings were confirmed, cleared or newly found, and give the next command.
