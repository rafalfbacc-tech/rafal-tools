# Platform: mobile (Android / iOS / React Native / Flutter)

Checklist for `plan`. Controls reference OWASP MASVS v2 groups. On-device dynamic testing (emulator/instrumentation) is **out of v1**: do static analysis of the app plus audit the backend API with `platform-web.md`. Note the on-device gap in the report's coverage matrix.

## MASVS-STORAGE
- MASVS-STORAGE-1 · no sensitive data (tokens, PII, keys) in plaintext `SharedPreferences`, `NSUserDefaults`, local DBs or logs · storage calls · static review / MobSF.
- MASVS-STORAGE-2 · secrets kept in Android Keystore / iOS Keychain, not in files · key storage code.
- MASVS-STORAGE-1 · no sensitive data in app backups (`android:allowBackup=false` when appropriate) · `AndroidManifest.xml`.

## MASVS-CRYPTO
- MASVS-CRYPTO-1/2 · strong, standard algorithms; no hardcoded keys or static IVs; no ECB · crypto calls, resources · static review + gitleaks.

## MASVS-AUTH
- MASVS-AUTH-1 · auth and authorization enforced on the backend, never only in the app · backend (use web checklist) · API tests.
- MASVS-AUTH-2 · session/token handling matches the backend; logout invalidates server-side · token code + backend.

## MASVS-NETWORK
- MASVS-NETWORK-1 · TLS everywhere; no cleartext (`usesCleartextTraffic=false`, iOS ATS not globally disabled) · manifest / `Info.plist` / network config.
- MASVS-NETWORK-1 · certificate/host validation not disabled (no "trust all" trust managers) · networking code.

## MASVS-PLATFORM
- MASVS-PLATFORM-1 · exported components (activities, services, receivers, providers) are not unintentionally exported and check caller permissions · `AndroidManifest.xml`, `exported` flags.
- MASVS-PLATFORM-1 · deep links / custom URL schemes / App Links validate and authorize their input · intent filters, link handlers.
- MASVS-PLATFORM-2 · WebViews disable JavaScript when not needed, restrict `addJavascriptInterface`, do not load untrusted URLs, disable file access · WebView setup.

## MASVS-CODE
- MASVS-CODE-3 · no hardcoded API keys, endpoints or credentials in the bundle · strings/resources + gitleaks.
- MASVS-CODE-4 · debug flags off in release (`android:debuggable=false`, no verbose logging) · manifest / build config.
- MASVS-CODE-2 · third-party SDKs/libraries current and without known CVEs · lockfiles · osv-scanner.

## MASVS-RESILIENCE (note, do not over-weight)
- MASVS-RESILIENCE-1 · root/jailbreak and tampering checks exist where the threat model needs them. Treat absence as Info/Low unless the app handles high-value data.

## MASVS-PRIVACY
- MASVS-PRIVACY-1 · only necessary permissions requested; no unexpected data collection · manifest permissions, SDK review.
