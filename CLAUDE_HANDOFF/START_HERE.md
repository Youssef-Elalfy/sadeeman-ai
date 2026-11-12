# SADEEMAN AI — independent review entry point

2026-11-06. Brand: **سَدِيمًا | SADEEMAN AI**. Arabic tagline: **رحلتك أبعد من الخيال.** English tagline: **Beyond Destinations. Beyond Expectations.** This is an independent conversational workspace, not a tourism landing page or another product's fork.

Read `CLAUDE_REVIEW_MASTER_PROMPT.md`, `IMPLEMENTATION_STATUS.md`, `KNOWN_ISSUES.md`, and `QA_RESULTS.md` first. Current owner scope supersedes older historical milestone reports: implement through M6; **business automation is entirely out of scope**. No new Cloud SQL, deployments, purchases or provider acceptance calls without the required separate approval.

## Local setup

Windows PowerShell; Node **24.14.1**, pnpm **11.25.0** are the verified baseline. Edge is used by the browser suite. Package versions are pinned in package.json/pnpm-lock.yaml. Keep one package manager.

```powershell
cd C:\Users\youss\Desktop\Sadeeman
# If your machine requires its enterprise CA, keep TLS verification on:
$env:NODE_OPTIONS='--use-system-ca'
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test --maxWorkers=1
pnpm test:e2e
```

For a transferred copy, use its actual root path. Browser tests require an existing Microsoft Edge; install a supported Playwright browser separately if absent and adjust the test channel. The QA runner binds only loopback 3100/4100, checks an isolated run marker, disables providers and uses an actual disposable local PostgreSQL instance. It serves the production Next build. It kills only the Node processes it spawned; it does not enumerate or terminate unrelated processes.

Copy the safe `.env.example` into the **project root** `.env` manually if needed; never overwrite existing credentials. Root `.env.example` is the authoritative list of names. A minimal public-data local setup uses `PERSISTENCE_MODE=local`, `LOCAL_DATABASE_PATH=.private/postgres`, `ENABLE_TRAVEL_CONTEXT=true`, `ENABLE_TRAVEL_CONTEXT_PERSISTENCE=true`, `ENABLE_REAL_PROVIDER=false`, `ENABLE_VOICE=false`, `ENABLE_OPENROUTER_RUNTIME=false`, `WEB_ORIGIN=http://localhost:3000`. Start everything with one command (2026-11-06, Claude takeover):

```powershell
node tools/dev.ts
```

It builds stale packages, starts the API and web, waits for both, and prints the URL (`http://127.0.0.1:3000/`; `localhost:3000` also works). Ctrl+C stops both. The API's readiness summary explains every disabled feature; `public_only` is the development data policy, not an error. Final evidence: `docs/reports/FINAL_SADEEMAN_RELEASE_REVIEW.md`. Use the explicit public-data guest acknowledgement. Without enabled providers, chat reports unavailable; there are no fake customer replies. CRM, history and memory use real local SQL. Ordinary API startup loads root `.env`; QA intentionally does not.

Transfer source/config/lockfile/tests/brand/docs/this folder. **Exclude `.env`, `.private`, `.pnpm-store`, node_modules, .next, dist, test-results and recordings.** No Git repository or push is claimed. Screenshots in this folder contain only public synthetic QA inputs.
