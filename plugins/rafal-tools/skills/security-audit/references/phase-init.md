# Phase: init (recon)

Goal: a short, accurate map of the app's technology and attack surface in `.security/recon.md`, built without reading the whole codebase.

## Steps

1. Run `sa init-dir <appRoot>` and show its output. If it prints `WARNING: .security/ is tracked by git`, pass the suggested command on to the user.
2. **Budget: read only these.**
   - Manifest and lock-file names (not full contents): `package.json`, `requirements*.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `*.csproj`, `pom.xml`, `build.gradle*`, `pubspec.yaml`, `Podfile`, `composer.json`, `Gemfile`.
   - The folder tree to depth 3 (Glob), skipping `node_modules`, build output and vendored code.
   - Entry points: the server bootstrap/router files, `AndroidManifest.xml`, `Info.plist`, the Electron/Tauri main and preload files and config (`tauri.conf.json`).
   - Auth and config files: auth middleware, session/JWT setup, CORS/CSP config, `.env.example`, `Dockerfile`, `docker-compose*`, IaC.

   Find route definitions with Grep (for example `router\.|app\.(get|post)|@(Get|Post)Mapping|@app\.route`) and list them. Do not open every file. When something important is unclear, note it as an open question instead of reading more.
3. **Detect platforms:**
   - `web`: web app, SaaS or API backend.
   - `mobile`: Android, iOS, React Native, Flutter, Capacitor.
   - `desktop`: Electron, Tauri, .NET WPF/WinForms/MAUI, Qt, Java desktop.
   One project can have several, for example a mobile app plus its backend API.
4. **Write `.security/recon.md`** in English with these sections:

```markdown
# Recon — <app name>
Date: YYYY-MM-DD
Platforms: web, mobile        <- exact line; later phases read it

## Stack
languages, frameworks + versions, DB, cache/queue, hosting/infra files
## Entry points
routes / API groups (path prefix -> file), webhooks, file uploads, websockets, deep links, IPC channels, CLI args
## Auth & roles
mechanism (session/JWT/OAuth/API keys), where enforced (middleware file:line), roles found in code, multi-tenant model
## Sensitive data
PII, payments, secrets, files; where stored
## Data stores
DB type and name (needed for the backup gate), ORM / raw SQL
## External services
payment, email, storage, OAuth providers, AI APIs
## Build / run
how to start locally, ports, health URL candidates
## Open questions
things recon could not determine
```

5. Ask the user to fill in `.security/config.yaml`:
   - the `app` start command and URLs (propose the values you found),
   - one test account per role (use the roles found in code; for multi-tenant apps include a user of a second tenant),
   - `database.backup_command` if they have one.
   Remind them the file stays local and passwords never appear in reports.
6. Run `sa phase-done <appRoot> init`, then give a short summary and the next command.
