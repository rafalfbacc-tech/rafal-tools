# Findings format

`.security/findings.md` starts with a header, then one entry per finding, then a `## Needs check` section.

## Header

```markdown
# Findings — <app name>
Updated: YYYY-MM-DD · Phases: scan, verify, ...
Tools: <tool> <version> (<license>), ... · Not run: <tool> — <why>
Backup: <path, or "none — data-changing tests not run">
```

## Entry

```markdown
### F-001 — <short title>
- Severity: High · Confidence: likely · State: open
- CWE: CWE-639 · Goal: G-04 · Fingerprint: <fp from sa filter, or "manual">
- Location: `src/api/invoices.ts:42`
- Data path: `req.params.id` (src/api/invoices.ts:38) → `getInvoice(id)` (src/db/invoices.ts:15) → SQL without tenant filter
- Attack: a `user` of tenant A requests `/api/invoices/<id of tenant B>` and receives tenant B's invoice.
- Evidence: code excerpt or request/response (secrets and passwords redacted)
- Fix direction: scope the query by `session.tenantId`; return 404 for foreign IDs.
- Re-test: as `tenant-b-user`, GET `/api/invoices/<tenant A id>` → expect 404.
```

Number IDs sequentially and never reuse one. A finding that turns out false later gets `State: rejected` plus a reason, and you also run `sa reject`.

## Severity

| Severity | Meaning | Example |
|---|---|---|
| Critical | Full compromise or mass data exposure, no special access needed | unauthenticated RCE, SQL injection on a public endpoint, cross-tenant data access, leaked production secret |
| High | Serious compromise needing low privileges or one user action | IDOR on sensitive data, stored XSS, auth bypass for one role, missing auth on admin API |
| Medium | Limited impact or harder to exploit | CSRF on a state-changing action, missing rate limit on login, reflected XSS needing interaction, verbose errors with internals |
| Low | Minor weakness, little direct impact | missing security headers, weak password policy, version disclosure |
| Info | Hardening suggestion, no vulnerability | outdated but unaffected dependency, defense-in-depth idea |

## Confidence

- `confirmed`: reproduced in `verify` or `stress`, with the evidence recorded. Only those phases may set it.
- `likely`: the full path from source to sink is traced in code, and no sanitizer or check on that path stops it.
- `needs-check`: partial evidence, for example the sink was found but the path is unclear, or it depends on runtime config. These go in the `## Needs check` section, not the main list.

## False positives

When a candidate is not a real problem, run `sa reject <appRoot> <fp> <reason>` — where `<fp>` is the `fp:<...>` value printed on that candidate's line by `sa filter` — and do **not** list it. Later `sa filter` runs drop it automatically until that code changes.

## Order

Sort by severity (Critical → Info), then confidence (`confirmed` → `likely`). `needs-check` entries always go in their own section.
