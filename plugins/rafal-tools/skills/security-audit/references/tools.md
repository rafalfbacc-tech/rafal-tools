# Tools

## Rules

- **Free licenses only.** Allowed: an OSI open-source license, or a free community edition whose terms allow auditing your own code. Before installing a tool, check its license in this table and on the tool's repo page. If the license has changed to something paid or restrictive, skip the tool.
- **Install only what applies** to the platforms and ecosystems in `recon.md`. First check whether the tool is already on `PATH` (`<tool> --version`).
- **Install with the user's package manager:** Windows `winget`/`scoop`/`choco`, macOS `brew`, Linux the distro package or the official release binary. Python tools via `pipx`. Docker-only tools run only if `docker --version` works; otherwise skip them.
- **Install failed or tool skipped:** continue without it. Add it to `Not run:` in the `findings.md` header with the reason. The report lists it in the coverage matrix.
- **Record** `<tool> <version> (<license>)` on the `Tools:` line of the `findings.md` header.
- **Never read raw output.** Write it to `.security/tools/<tool>.raw.json`, then run `sa filter <appRoot> <tool> .security/tools/<tool>.raw.json`.
- Many scanners exit with code 1 when they find something. That is not an error. An error is only a missing or invalid output file (`sa filter` reports it).

## Static and supply chain (phase `scan`)

| Tool | Purpose | Platforms | License | Run (from `<appRoot>`) | `sa filter` name |
|---|---|---|---|---|---|
| gitleaks | secrets in files and git history | all | MIT | `gitleaks detect --source . --report-format json --report-path .security/tools/gitleaks.raw.json --no-banner` (add `--no-git` when not a git repo) | `gitleaks` |
| osv-scanner | known-vulnerable dependencies (all lockfiles: npm, pip, Go, Cargo, Maven, NuGet, Pub, ...) | all | Apache-2.0 | v2: `osv-scanner scan source -r . --format json > .security/tools/osv-scanner.raw.json` · v1: `osv-scanner -r . --format json > ...` | `osv-scanner` |
| npm audit | npm dependency advisories (only if `package-lock.json` exists) | JS/TS | Artistic-2.0 (part of npm) | `npm audit --json > .security/tools/npm-audit.raw.json` | `npm-audit` |
| semgrep CE | code patterns: injection, XSS, unsafe APIs, misconfig | all languages | engine LGPL-2.1; registry rules under the Semgrep Rules License (free for auditing your own code, not for building a competing product) | `semgrep scan --config p/security-audit --config p/owasp-top-ten --metrics=off --json -o .security/tools/semgrep.raw.json` (add a language pack, e.g. `--config p/javascript`, `p/python`, `p/kotlin`, `p/swift`). On Windows, if the native install fails, use WSL or Docker `semgrep/semgrep`; if neither works, skip it | `semgrep` |
| trivy | Dockerfile, IaC (Terraform, K8s, Compose) misconfig, OS/library vulnerabilities | web/backend | Apache-2.0 | `trivy fs --scanners vuln,misconfig --format json -o .security/tools/trivy.raw.json .` | `trivy` |
| MobSF | static analysis of APK/AAB/IPA | mobile | GPL-3.0 | Docker only: `docker run --rm -p 8000:8000 opensecurity/mobile-security-framework-mobsf`, upload the build through its REST API, fetch `/api/v1/report_json` to `.security/tools/mobsf.raw.json`. No `sa filter` support: extract only `high`/`warning` items with a short Node one-liner, never read the whole report | — |

## Dynamic (phases `verify`, `stress`; target must pass `sa scope-check`)

| Tool | Purpose | License | Run | `sa filter` name |
|---|---|---|---|---|
| OWASP ZAP | baseline web scan: headers, cookies, passive issues; API scan from an OpenAPI file | Apache-2.0 | Docker only: `docker run --rm -v "<appRoot>/.security/tools:/zap/wrk" ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t <url> -J zap.raw.json`. From the container the host is `host.docker.internal`; run `sa scope-check` on the real URL, and if needed add `host.docker.internal` to scope (it is the user's own machine). API scan: `zap-api-scan.py -t <openapi url/file> -f openapi -J zap.raw.json` | `zap` |
| nuclei | known misconfigurations, exposures, CVE templates | MIT (templates MIT) | `nuclei -u <url> -tags misconfig,exposure,cve -rl 20 -jsonl -o .security/tools/nuclei.raw.json -silent` | `nuclei` |
| k6 | scripted load and abuse scenarios | AGPL-3.0 (free to use) | `k6 run .security/tools/<scenario>.js` | — |
| autocannon | quick HTTP load on one endpoint | MIT | `npx autocannon -c 10 -d 10 <url>` | — |

`curl` and small Node scripts in `.security/tools/` are the default for authorization and business-logic tests. Scanners do not find those. On Windows use `curl.exe` (not the PowerShell `curl` alias) and, for a self-signed local cert, `curl.exe -k`; see `references/dynamic-rules.md` for the TLS and binary-dump caveats.
