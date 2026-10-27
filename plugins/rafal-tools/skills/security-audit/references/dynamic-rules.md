# Rules for dynamic tests (verify, stress)

Follow these steps in order before the first request of the phase.

## 1. Scope

- Before sending requests to any host for the first time in this phase, run `sa scope-check <appRoot> <url>`.
- Exit 2 (`refused`): do not send anything to that host. Tell the user, who can add it to `scope` in `config.yaml` only if it is their own test environment.
- Never test production or a third-party host, even if the user's code calls it.

## 2. App running

- If `app.health_url` answers, use the running app.
- Otherwise start it with `app.start_command` in the background, then poll the health URL (up to ~60 s). If it does not come up, show the last lines of its output and stop the phase.
- If the skill started the app, stop it at the end of the phase.
- **Self-signed HTTPS (local TLS):** poll and test with `curl.exe -k` (or Node `fetch` with `NODE_TLS_REJECT_UNAUTHORIZED=0`). On Windows PowerShell 5.1 `Invoke-WebRequest` has no `-SkipCertificateCheck` and fails on a self-signed cert — do not use it for the health probe.

## 3. Backup gate (before any data-changing request)

Data-changing requests (create, update, delete, state changes) are allowed on the **test** database, but only after this gate. Ask once per phase run, in the user's language:

1. "Is there a current backup of the test database?" If yes, note its path and continue.
2. If not: "Will you make one, or should I?"
   - **User makes it:** wait until they confirm, then note the path.
   - **Skill makes it:** use `database.backup_command` from `config.yaml`. If that is empty, propose a command for the database named in `recon.md` (PostgreSQL `pg_dump -Fc <db> -f .security/backup.dump`, MySQL/MariaDB `mysqldump <db> > .security/backup.sql`, SQLite: copy the `.db` file into `.security/`, MongoDB `mongodump --out .security/backup`). Run it **only after the user approves the exact command**, then check that the file exists and is not empty.
   - **Binary dumps on Windows:** a command that pipes a binary dump through shell redirection (`pg_dump -Fc ... > file`) must run in a POSIX shell (the Bash tool) or `cmd /c`, never via the PowerShell tool — PowerShell's `>` re-encodes the stream and corrupts the dump. Prefer `pg_dump`'s own `-f <file>` over `>` when you propose a command. Verify the result: a valid custom-format dump starts with the bytes `PGDMP`.
3. **No backup and no approval:** run read-only checks only. Goals that need data changes keep their findings at `likely`. List them in the coverage gaps as "not run: no backup".

Record the backup path, or `none`, in the `Backup:` line of the `findings.md` header.

## 4. Accounts

- Log in as each role from `config.yaml` (`accounts`) through the app's real login flow. Keep tokens and cookies only in memory, or in `.security/tools/` if a script needs them.
- In findings, chat and scripts, refer to roles only, never passwords. A role with an empty username means unauthenticated.
- Scripts you write go into `.security/tools/` and read credentials from `config.yaml` at runtime. Never hard-code them.

## 5. End of phase

Run `sa redact <appRoot>` before `sa phase-done`, so no password leaks into `.security/` files.
