# Phase: stress (abuse and resilience — optional)

Goal: find places where the app can be overwhelmed or where limits are missing. Security-oriented, not a performance benchmark.

## Before anything

Follow `references/dynamic-rules.md`: scope check, start the app, the backup gate (ask once), log in per role. All the same rules apply.

## Checks

Work the goals marked `Covered by: stress`, plus these standard ones where the feature exists:

- **Rate limiting** on login, password reset, signup, OTP/2FA and expensive API endpoints (CWE-307). Send a bounded burst and see whether it is ever throttled or locked out.
- **Resource limits** (CWE-770): unbounded pagination or page size, very large or many file uploads, requests with large bodies, expensive search / regex / report queries.
- **Race conditions** (CWE-362) on balances, quotas, coupons, stock: a few concurrent identical requests that should each be allowed only once.

## How

- Use `k6` or `autocannon` from `tools.md` for volume, or a small concurrent Node script for races. Keep scripts in `.security/tools/`.
- **Bounded load.** Start low (around 10 requests/second), stop at the first sign of degradation, and never exceed what the user approved. The aim is to show a limit is missing, not to take the app down.
- Record results as findings per `findings-format.md` with the matching CWE.

## Finish

Run `sa redact <appRoot>`, then `sa phase-done <appRoot> stress`. If the skill started the app, stop it. Summarize and give the next command.
