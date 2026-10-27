# Phase: report (prioritized report)

Goal: `.security/report.md`, a self-contained English report the user or a coding agent can act on without re-running the audit.

## Inputs (read only these)

- `.security/findings.md`, `.security/test-plan.md`, and the header of `.security/recon.md`.
- Do not re-scan or re-read the codebase.

## Structure of `report.md`

```markdown
# Security audit report — <app name>
Date: YYYY-MM-DD · Phases run: init, plan, scan, verify

## Summary
- Counts: Critical N · High N · Medium N · Low N · Info N
- By confidence: confirmed N · likely N · needs-check N
- Top risks (plain language, most important first):
  1. ...
  2. ...
  3. ...

## Findings
<every finding from findings.md, sorted by severity then confidence>
<each self-contained: location, data path, attack scenario, evidence (redacted),
 fix direction, and how to re-test>

## Needs check
<needs-check items: what was seen and what to inspect>

## Coverage
| Goal | Control | Status | Note |
<every test-plan goal: checked / partially / not checked, with the reason>
<one row per skipped tool or standard area, e.g. "mobile on-device testing — not in v1">

## Tools
<tool version (license) for each used; "not run: <tool> — <why>">

## Data-changing tests
<run or not; backup path, or "none">
```

## Steps

1. Build the report from `findings.md` and `test-plan.md`. Do not invent findings; every entry must already exist in `findings.md`.
2. The coverage matrix must list every goal and must name anything skipped and why (missing tool, no backup, out-of-scope, out of v1). Nothing is silently omitted.
3. Keep prioritization honest: a finding's severity is the impact on a real user if it ships, and confidence is how sure the audit is. Sort by severity, then confidence.
4. Run `sa redact <appRoot>` (final safety pass), then `sa phase-done <appRoot> report`.
5. Tell the user where the report is and read back the top 3 risks in their language.
