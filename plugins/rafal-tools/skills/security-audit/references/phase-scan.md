# Phase: scan (code analysis)

Goal: turn the test plan into verified findings in `.security/findings.md`, keeping false positives out.

## Arguments

- none: all goals whose `Covered by:` is `scan`.
- `<area>`: only goals whose title or `Where:` match the area (for example `auth`, `invoices`).
- `--changed`: only files reported by `sa changed <appRoot>` (changed since the last audit). Use this for re-runs after fixes.

## Inputs

- `.security/test-plan.md` and `.security/recon.md` (`Platforms:` line).
- `references/findings-format.md` for the finding schema and rubric.
- `references/tools.md` for which scanners to run and how.

## Steps

1. **Run the applicable scanners** from `tools.md` for the detected platforms and ecosystems, each writing to `.security/tools/<tool>.raw.json`. Record each tool's version and license on the `findings.md` header; a tool that will not install goes on the `Not run:` line.
2. **Filter, never read raw output:** for each tool run `sa filter <appRoot> <tool> .security/tools/<tool>.raw.json`. This gives a short candidate list and drops previously rejected ones.
3. **Verify each candidate and work each goal in code.** Open only the referenced file region (the candidate's `file:line`, or the files named in the goal's `Where:`), plus the functions directly on the data path. Trace from the untrusted source to the sink:
   - Real problem with a traced source -> sink path and no effective check on it: write a finding per `findings-format.md`, confidence `likely`.
   - Candidate that a check, escaping or framework protection neutralizes: run `sa reject <appRoot> <fp> <reason>` with the `fp:<...>` printed on that candidate's line; do not list it.
   - Sink found but the path or exploitability is unclear: record it in the `## Needs check` section at confidence `needs-check`, not in the main list.
4. **Budget per goal:** read only the files the goal names plus their direct callers. If confirming would need broad reading across the codebase, stop and record `needs-check` with what to inspect, rather than reading widely.
5. **Fan out when large.** For more than ~5 goals or ~30 candidate files, dispatch one subagent per goal group. Give each subagent: its goal list, the specific files to read, and the path to `references/findings-format.md`. Require it to return findings in the entry format only (not file dumps). Merge the returned findings into `findings.md`.
6. **Finish:** run `sa mark-audited <appRoot>`, then `sa phase-done <appRoot> scan`. Summarize counts by severity and confidence, and give the next command.

Code analysis cannot confirm runtime behavior, so most scan findings stay `likely` until `verify`.
