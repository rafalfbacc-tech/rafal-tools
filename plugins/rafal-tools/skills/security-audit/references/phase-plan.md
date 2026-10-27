# Phase: plan (test plan)

Goal: `.security/test-plan.md`, a numbered list of concrete things to check, each tied to a standard control and to the phase that covers it.

## Inputs (read only these)

- `.security/recon.md`.
- `.security/config.yaml`: read only the role names, `depth` and `scope`. Never repeat passwords.
- `references/platform-<p>.md` for each platform on the `Platforms:` line of `recon.md`.

## Steps

1. Walk the platform checklist(s) against the recon. Keep an item only if the app has the relevant feature; drop controls for features the app does not have (for example no file-upload goals when there are no uploads).
2. For every entry-point group, add at least one goal. For access control, add one goal per sensitive resource and per role pair that must be isolated (for example `user` vs `admin`, tenant A vs tenant B).
3. Map each goal to a control ID from the platform checklist (ASVS / API Top 10 / MASVS / desktop checklist).
4. Set a priority:
   - P1: authentication, access control, injection, secrets, multi-tenant isolation.
   - P2: session, CSRF, validation, transport, configuration and headers.
   - P3: hardening and defense-in-depth.
5. Apply `depth` from the config: `quick` keeps P1 only, `standard` keeps P1–P2, `deep` keeps all.
6. Assign each goal to the phase that covers it: `scan` (visible in code), `verify` (needs a running app), or `stress` (abuse/load).
7. **Write `.security/test-plan.md`** in English:

```markdown
# Test plan — <app name>
Depth: standard · Goals: 14

## G-01 — Tenant isolation on invoices
- Control: ASVS 4.2.1 · Priority: P1 · Covered by: verify
- Idea: a user of tenant A must not read, change or delete tenant B's invoices.
- Where: src/api/invoices.*, src/db/invoices.*
- Pass/fail: any cross-tenant read or write = fail.

## G-02 — ...
```

8. Tell the user to review and edit `test-plan.md` (add or remove goals) before running `scan`. Run `sa phase-done <appRoot> plan`, then give a short summary and the next command.
