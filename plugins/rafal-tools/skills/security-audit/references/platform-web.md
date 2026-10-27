# Platform: web / API / SaaS

Checklist for `plan`. Each item: control · what to check · where in code · how `verify` confirms it. Controls reference OWASP ASVS 5.0 and OWASP API Security Top 10 (2023). Keep items that match the app's features.

## Authentication (ASVS V6)
- ASVS 6.2.1 · passwords checked against breach/strength rules · registration + reset handlers · try a weak/known password.
- ASVS 6.2.2 · no user enumeration (login, reset, signup give uniform answers and timing) · auth handlers · compare responses for known vs unknown accounts.
- ASVS 6.4.x · brute-force protection on login and reset (rate limit / lockout) · auth middleware · covered in `stress`.

## Session management (ASVS V7)
- ASVS 7.1.1 · session tokens random and opaque · session setup · inspect cookies.
- ASVS 7.2.x · session fixation prevented; token rotates on login · login handler · log in and compare tokens.
- ASVS 7.3.1 · cookies `HttpOnly`, `Secure`, `SameSite` · cookie/session config · inspect `Set-Cookie`.
- ASVS 7.4.x · logout and idle/absolute timeout invalidate server-side · logout handler · reuse a token after logout.

## Access control (ASVS V8) — first-class for SaaS
- ASVS 8.1.1 · every endpoint enforces authZ server-side, not just hidden UI · route middleware · request as a lower role.
- API1:2023 (BOLA) · object IDs are authorized against the caller, not just authenticated · resource handlers (`:id` params) · request another user's object ID.
- API5:2023 · function-level authZ: admin routes reject normal users · admin routers · request admin routes as `user`.
- **Multi-tenant isolation** · tenant ID comes from the session/token, never from a request field · query builders, ORM scopes · as `tenant-b-user` request tenant A IDs across read, update, delete, list, export and background jobs. Every query scoped by tenant; IDs unguessable or checked.

## Input / injection (ASVS V5, V10)
- ASVS 5.3.4 · SQL/NoSQL via parameterized queries, never string concatenation · data layer · submit `' OR 1=1 --` style and ORM-bypass payloads.
- ASVS 5.3.8 · no OS command built from input; no unsafe deserialization · exec/spawn, deserializers · inspect and probe.
- API (SSRF) · URLs fetched server-side are validated against an allowlist · webhook/fetch/image-proxy code · point a parameter at an internal address.
- ASVS 5.2.x · path traversal and file-type checks on uploads/downloads · file handlers · request `../` paths.

## Output / XSS (ASVS V5)
- ASVS 5.3.3 · output encoded for its context; templating auto-escapes; no raw-HTML sinks from input (`dangerouslySetInnerHTML`, `v-html`, `innerHTML`) · views/components · inject a script payload, confirm it is escaped.

## CSRF, CORS, headers (ASVS V13, V14)
- ASVS 13.2.3 · state-changing requests need anti-CSRF tokens or are protected by `SameSite` + no cross-site credentialed use · form/middleware config · cross-site POST.
- ASVS 14.5.x · CORS not `*` with credentials; origins allowlisted · CORS config · send a foreign `Origin`.
- ASVS 14.4.x · security headers present (CSP, HSTS, X-Content-Type-Options, frame protection) · header middleware · inspect responses.

## Cryptography & secrets (ASVS V2, V11)
- ASVS 11.x · passwords hashed with bcrypt/scrypt/argon2; no weak/custom crypto · auth storage · code review.
- ASVS 2.10 / 14.1 · no secrets in source, repo history or client bundles · whole tree + gitleaks · grep + gitleaks output.

## Configuration & errors (ASVS V14)
- ASVS 14.3.2 · no stack traces or internals in production error responses · error handler · trigger a 500.
- API8:2023 · debug/admin endpoints, Swagger/actuator, default creds not exposed · routes/config · request them unauthenticated.

## Business logic
- workflow steps cannot be skipped or replayed; amounts, quantities, prices validated server-side; negative/overflow values rejected · service layer · craft out-of-order and boundary requests (often `stress`).

## Logging (ASVS V9)
- ASVS 9.x · auth and access-control failures logged; logs do not contain passwords, tokens or full card numbers · logging config · review log sinks.
