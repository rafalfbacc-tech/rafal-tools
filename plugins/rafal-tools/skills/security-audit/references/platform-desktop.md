# Platform: desktop (Electron / Tauri / .NET / Qt / Java)

Checklist for `plan`. Each item: what to check · where in code · how to confirm. If the desktop app talks to a backend, also audit that backend with `platform-web.md`.

## Electron
- **contextIsolation on** and **nodeIntegration off** for renderers that load remote or untrusted content · `BrowserWindow` `webPreferences` · code review.
- **Preload exposes a minimal API** via `contextBridge`, not raw `ipcRenderer`, `require` or Node globals · preload scripts · review the exposed surface.
- **IPC handlers validate input** and do not run arbitrary commands or file paths from the renderer · `ipcMain.handle`/`on` · trace each channel's input to its sink.
- **`shell.openExternal` / `openPath` not called with untrusted input** (command/URL execution) · main process · code review.
- **No `webSecurity: false`, no unrestricted `will-navigate`/`window.open`**; external navigation is allowlisted · window setup, navigation handlers.
- **CSP set** for loaded content · window/headers.
- **`sandbox: true`** for untrusted renderers where feasible.

## Tauri
- **allowlist / capabilities scoped** to only the commands and paths needed; `fs`, `shell`, `http` scopes not wide open · `tauri.conf.json`, capability files.
- **`#[tauri::command]` handlers validate input** and restrict file paths · command handlers.
- **No `dangerousRemoteDomainIpcAccess`** granted to untrusted origins · config.

## Auto-update integrity
- updates downloaded over HTTPS and **signature-verified** before applying · updater config/code · confirm the public key / signature check exists and the endpoint is HTTPS.

## Local secrets
- tokens, passwords and keys stored in the OS secret store (Windows Credential Manager / DPAPI, macOS Keychain, libsecret), **not plaintext files or registry** · storage code.
- no secrets hardcoded in the app or shipped config · whole tree + gitleaks.

## OS integration
- **custom URL/file-type handlers** validate and authorize their argument before acting (no command injection, no auto-exec) · protocol/handler registration.
- **library/DLL search path**: no loading from a writable or current directory (DLL hijacking) · native loading code, packaging.
- app **runs with least privilege**; installer does not loosen ACLs or run unexpected elevated steps · installer scripts, manifest.

## Dependencies
- bundled libraries and framework version free of known CVEs · lockfiles · osv-scanner / trivy.
