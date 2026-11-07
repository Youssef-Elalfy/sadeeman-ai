# Production deployment — 2026-11-07

Private source: https://github.com/Youssef-Elalfy/sadeeman-ai. Current local product only; no unrelated repository used.

## Security release evidence
- The controlled disposable user 005eeacb-9800-4b00-8174-1e57eb1c57f0 was deleted by the owner. Read-only Cloud checks confirmed zero users, sessions and refresh tokens for that exact ID. Claims/session evidence: PRODUCTION_SESSION_CLAIMS_2026-11-07.json. No schema or Auth settings changed.
- The production guard now enforces durable, project-pinned Supabase authentication, an exact HTTPS Vercel origin, real Gemini primary/Groq fallback, zero provider retries and disabled synthetic/catalog-demo/OpenRouter modes. Missing prerequisites fail startup.
- Session ownership, RLS, explicit public-data policy and opt-in durable memory consent retained. Sensitive content and provider keys are not logged. File/audio size and content checks retained.
- Aggregate single-replica hourly limits: 30 agent turns, 30 voice requests, 10 guests; two concurrent provider operations; Tavily one basic search/turn and ten searches/hour. Counts include failures. Restarts reset counters; horizontal scaling requires shared limits before enablement. Forwarded client IPs remain untrusted.
- Nonce CSP blocks untrusted scripts; frame protection, HSTS and restricted browser capabilities added. Tokens remain tab-scoped sessionStorage, with XSS risk reduced by strict CSP and escaped content; no claim of HttpOnly cookies. Privacy notice explains processors, persistence, voice and deletion limits.
- Current advisors: eleven intentional anonymous-user policy warnings and disabled leaked-password protection (Free-plan limitation); no application table lacks FORCE RLS. Private-schema API probe denied with 406/PGRST106. These warnings were not suppressed.
- Lockfile advisory audit: 299 packages, zero advisories returned by the npm bulk advisory endpoint. Source secret scan passed (235 allowlisted files).

## Local verification
- Full Vitest run: 428/428 across 34 files; additional API concurrency regression added and all 19 release tests pass (429 tests in current inventory). No live providers in automated tests.
- Contracts/API builds, web/tests strict typechecks and full Biome check passed. Next production build passed with dynamic nonce-protected pages.
- Local Edge/Playwright: HTML 200, all scripts nonced, zero page/CSP errors, no document overflow at 1440px/390px, privacy link present, no provider-key patterns in HTML. Backend was intentionally not running in this UI-only check. Mobile heading width corrected after screenshot inspection.

## Hosting checkpoint
- Railway trial verified: 30 days, 5 dollars remaining credit, no billing upgrade or payment changes. Dedicated project 70b31570-653b-4d18-846c-22265da57655; service 7145d735-1b65-451b-8463-0c1db1ce2775; production environment 635453a5-fb86-419a-8189-1acae6a307d1.
- Railway domain allocated: https://sadeeman-api-production.up.railway.app. Deployment/health not yet verified. 39 reviewed server variables securely sent through stdin and values compared without printing. Only the rotated Tavily key was used; OpenRouter key absent.
- Vercel Hobby verified. Project prj_WpK40ySZ0FUdiBPINRNoKZClItLT created; Node 24, apps/web monorepo root, contracts build and HTTPS API_ORIGIN prepared. No backend secrets uploaded to Vercel.
- Automatic approval review denied clearing Vercel deployment protection; protection remains unchanged. Public access must be tested before requesting an exact setting change.
- No public frontend/backend success or live E2E claim until actual deployment and checks complete.

## Next
Push reviewed source without history rewrite, deploy source-only Railway archive, deploy Vercel from current private repository, verify actual public endpoints and bounded acceptance. Stop on trial/network/billing blockers.
