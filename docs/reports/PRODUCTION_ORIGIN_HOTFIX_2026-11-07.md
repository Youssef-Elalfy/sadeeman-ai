# Canonical-origin production hotfix — 2026-11-07

Canonical public URL: **https://sadeeman-ai.vercel.app**.

## Root cause and live backend correction

The existing Railway service allowed only `https://sadeeman-ai-youssef-elalfys-projects.vercel.app`. The canonical Vercel alias also existed, but its browser Origin did not match that exact value. Both direct-backend and frontend-proxied canonical preflights/health requests returned 403 / FORBIDDEN_ORIGIN while the HTML page itself loaded.

The dedicated project/service were verified: project `70b31570-653b-4d18-846c-22265da57655`, service `7145d735-1b65-451b-8463-0c1db1ce2775`, production environment. Only **WEB_ORIGIN** changed, to exactly `https://sadeeman-ai.vercel.app`. Every other variable was compared privately before/after and remained unchanged. No credential value was printed or changed.

One backend image redeployment activated this setting: **`9b374210-d2a9-450c-99bd-d9b4e965d0b8`**, status **SUCCESS**. The existing image was reused; no backend source rebuild, AI change, schema action or authentication change occurred. Strict exact-origin validation remains intact, with no wildcard or alternate-origin CORS allowlist.

## Actual public verification after backend activation

| Request | Observed result |
| --- | --- |
| Backend OPTIONS `/api/v1/agent/messages`, canonical Origin, POST + authorization/content-type preflight | 204; Access-Control-Allow-Origin exactly canonical |
| Backend GET `/api/v1/health`, canonical Origin | 200; SADEEMAN AI |
| Backend GET health, unrelated Origin | 403; no Access-Control-Allow-Origin |
| Canonical frontend HTML | 200 |
| Canonical frontend-proxied OPTIONS agent/messages | 204; exact canonical allow-origin |
| Canonical frontend-proxied GET health | 200 |
| Canonical public POST auth/guest with intentionally invalid empty body | 400 INVALID_REQUEST, not FORBIDDEN_ORIGIN; no identity created |
| Canonical public POST agent/messages without authentication | 401 UNAUTHORIZED, not FORBIDDEN_ORIGIN; no model request |

The canonical URL was opened using a clean Edge/Playwright context: HTML 200, correct CSP nonces, no page/CSP errors, no desktop/mobile document overflow. Its saved screenshot was inspected and showed no FORBIDDEN_ORIGIN error card. A later, stronger browser-script launch was blocked by an Edge startup crash in both available execution contexts; this was not represented as a passing check and no browser retry loop followed. Direct HTTP verification above remains successful.

## Frontend patch prepared for the necessary frontend release

- `apps/web/proxy.ts` and `apps/web/lib/canonical.ts`: hosted alternate `.vercel.app` document requests redirect with 308 to the fixed canonical origin while preserving path/query. The existing proxy matcher excludes API/static/media routes. Local development and the canonical URL do not redirect. This is a navigation redirect, not wildcard CORS. Old immutable deployments retain their original code; use the canonical URL.
- `apps/web/lib/api.ts`: FORBIDDEN_ORIGIN tells customers to open the canonical URL instead of giving local-server, localhost or .env setup instructions.
- `apps/web/components/workspace.tsx`: the network-failure message now describes temporary service unavailability without asking production customers to start a local server.
- `tests/canonical-origin.test.ts`: strict production CORS, alternate document redirect, no redirect loop/open destination and safe origin-error copy.

Validation: **442/442 Vitest tests** across 36 files; four focused canonical-origin tests also passed after final import adjustment. Strict frontend and tests/tools typechecks, Biome checks and the latest Next production build passed. No live AI/research/voice calls or new test users were needed.

## Frontend publication blocker

The existing Vercel project is `prj_WpK40ySZ0FUdiBPINRNoKZClItLT`, team `team_BefFcrk6nP2XFNqmgtRVY7MQ`. Both project/deployment connector read tools were unavailable to the model. The supported official CLI fallback was installed only in ignored `.private/vercel-cli-cache`, pinned to registry-verified **65.12.1**, without changing app dependencies. Its read-only `whoami` check reported **login_required: saved login invalid or expired**. No token was requested, printed or newly created.

The backend origin fix is **live and verified**. The prepared frontend redirect/error-message patch is **not claimed deployed** until the necessary frontend release succeeds. Only Vercel frontend publishing remains; the backend must not be redeployed again for this patch.

The owner can refresh the existing Vercel CLI sign-in from this project with:

```powershell
node .private\vercel-cli-cache\_npx\29d463b7a51d914c\node_modules\vercel\dist\vc.js login
```

Complete the normal sign-in yourself using the same Vercel account; do not paste API tokens, credentials or authentication codes into chat. Afterward verify the exact team/project and deploy only `apps/web` from the reviewed commit, retaining the existing API_ORIGIN and all protection/Auth/provider settings.
