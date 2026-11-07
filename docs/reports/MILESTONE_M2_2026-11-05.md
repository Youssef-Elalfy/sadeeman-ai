# M2 persistence + real AI readiness — 2026-11-05 (Africa/Cairo)

Historical local-only acceptance snapshot. Later approved Cloud migration application, actual hosted acceptance and provider results are recorded in [the Cloud application checkpoint](CLOUD_APPLY_AND_PROVIDERS_2026-11-05.md).

## Done

**Local M2 acceptance passed. Full M2 is not closed:** genuine hosted Supabase Auth/PostgREST/advisor verification and authenticated LLM acceptance remain untested without credentials and an approved target. Production mode stays disabled. No frontend, CRM, voice or automation work was started.

There is still no Git repository (`git status --short` reports not a Git repository), so no commit hash or Git count of “43 changed files” can be supplied. The 43 files described in M0 were the original starter inventory, not an observed Git diff. Existing M1 architecture was extended; all original 47 tests still pass.

| Paths | Actual implementation |
|---|---|
| `supabase/migrations/20261104232715_identity_memory_foundation.sql` | CLI-generated migration; real PostgreSQL customer tables; personal tenancy, RLS/FORCE RLS, ownership/provenance foreign keys, active consent, versioned memory, expiry visibility, durable request deduplication, metadata-only audit and application-session revocation |
| `apps/api/src/persistence/local.ts` | Disk-backed PGlite PostgreSQL, checksummed migration ledger, random hashed guest sessions, transactional user-role context; no hosted connection |
| `apps/api/src/persistence/supabase.ts` | Explicit target validation; publishable-key client; Auth getUser verification; user JWT forwarded to SECURITY INVOKER RPC; guest/refresh/application revocation; no service-role bypass |
| `apps/api/src/persistence/repository.ts`, `types.ts`, `routes.ts` | Typed validated persistence, owned conversations, explicit consent and memory APIs, correction/deletion/revocation, safe storage errors |
| `apps/api/src/server.ts`, `state.ts`, `agent/*` | Restored context and summaries; consent-scoped preference loading as untrusted user data; commit-before-completion; request replay; cancellation after privacy changes; M1 ephemeral compatibility |
| `apps/api/src/providers/*` | Actual Gemini SDK and compatible REST streaming paths, partial tool-call assembly, terminal/byte/schema checks, no retry/fallback after streamed text, observed provider status and reported usage |
| `packages/contracts/src/index.ts` | Strict memory/consent/update/summary contracts, client request IDs and actual response_delta events |
| `tools/db-migrate.ts`, `smoke-persistence.ts`, `providers-check.ts` | Explicit local-only migrations; real HTTP/DB restart smoke; offline config check and opt-in small real model/tool round-trip probe |
| `tests/database.test.ts`, `persistence-api.test.ts`, `supabase.test.ts`, `streaming.test.ts` | 31 added assertions/tests: actual PostgreSQL where labeled; hosted/provider transports mocked only in automated tests |
| `docs/REAL_API_SETUP_GUIDE.md`, README/API/contracts/migration docs, plan/audit, `.env.example` | Windows commands, exact keys, official sources, free-tier/privacy constraints and truthful integration status |
| Root/API manifests, lockfile, pnpm workspace config, `.npmrc` | Exact dependency pins and stable workspace-local store; no global tool upgrade |
| `tools/validate_starter.py` | Excludes private runtime databases and generated CLI state from starter integrity reads |

## Verified — actual commands and outcomes

| Exact command | Observed outcome |
|---|---|
| `git status --short` | Not a Git repository; no init/push/commit performed |
| `pnpm build`, `pnpm test` before M2 behavior integration | M1 builds; original **47/47** tests pass |
| `pnpm exec supabase --version` with workspace `SUPABASE_HOME` | **3.0.0**; actual CLI help inspected for migration new, db push and migration list |
| `node node_modules/supabase/dist/supabase.js migration new identity_memory_foundation --workdir C:\Users\youss\Desktop\Sadeeman` | Created the versioned SQL file locally; no database changed by this command |
| `pnpm build` | API and contracts compiled successfully |
| `pnpm typecheck` | Strict API/contracts/tests/tools checks pass |
| `pnpm lint` | Biome recommended checks pass, **40** files checked, no fixes required |
| `pnpm test` | **78/78 passed, 8 files, 0 failed** |
| `pnpm smoke:persistence` | Actual localhost HTTP + disk PostgreSQL; **2 server restarts**; identity/memory restored; cross-user access denied; memory deleted; session revocation survives restart; **0 real model calls** |
| `pnpm dev`, then `pnpm smoke` | Original ephemeral path still starts on localhost: health **200**, session **201**, conversation **201**, unauthorized **401**, disconnected chat **503**; no provider invoked |
| `pnpm chat --synthetic` | Explicit DISCONNECTED response, no fabricated AI text |
| `pnpm eval:inventory` | **61** unique behavioral specifications inventoried; **0** natural-language behavioral scenarios executed |
| `$env:PERSISTENCE_MODE='local'; pnpm db:migrate --local` | **1 tracked migration**, actual engine **PostgreSQL 18.6 (PGlite 0.5.15)**, **0 remote changes** |
| `pnpm providers:check` | Offline configuration inventory; no configured adapters; **0 authenticated model calls** |
| `pnpm providers:check --live --synthetic --provider=gemini` | Expected **DISCONNECTED**, exit **2**, **0 authenticated calls** because keys/opt-ins are absent; not a live pass |
| `pnpm install --frozen-lockfile` | Passed with pinned workspace store; no lockfile drift; registry supply-chain validation passed for 239 entries during preceding verification |
| `python tools/validate_starter.py` | Source integrity PASS, not counted as AI/behavioral evidence |
| `pnpm list -r --depth 0` | Confirmed PGlite 0.5.15, Supabase JS 2.119.0, CLI 3.0.0 and unchanged pinned primary M1 libraries |

Test composition: **47 original deterministic tests + 19 real embedded PostgreSQL/API durability tests + 6 mocked hosted-Supabase wire tests + 6 mocked provider streaming/status tests = 78**. Persistent API tests use a real database with scripted model answers only within the test harness. They are not live intelligence or model quality evidence.

Real database tests verify non-bypass authenticated roles, different user/tenant views, anon denial, owner reassignment rejection, foreign consent/provenance rejection, direct SQL consent enforcement, atomic messages, durable turn idempotency, extractive summary, approved/denied memory, stale acceptance after revocation, optimistic correction, physical deletion (including expired memory), conversation cascade erasure, immutable consent, session revocation and metadata-only audits. Privacy cancellation and actual SQL commit failure prevent a false completion acknowledgment.

Initial verification exposed an idempotent-bootstrap bug that revoked private-helper schema usage on repeated local migration startup. Five database tests failed; the bootstrap was corrected, and those cases plus disk restart now pass. Stream truncation and partial-answer fallback were also tested explicitly. An offline install check lacked cached registry security metadata; a subsequent locked online verification succeeded. No failed check is represented as a pass.

## Real / mocked / unavailable

- **Genuinely working locally:** PostgreSQL storage and migrations, owned guest identity, disk session restoration, conversation persistence, summaries, consent-based preference CRUD, RLS enforcement, deletion/revocation, metadata audit, authenticated Fastify transport and safe failure paths.
- **Implemented with offline protocol evidence:** Supabase Auth/PostgREST adapters and all three LLM tool/stream adapters. No valid hosted credentials were used, so production transport compatibility is still **untested**.
- **Explicit test doubles:** Scripted model responses, injected SDK calls and mocked hosted/provider fetches in automated tests only. Normal application paths do not fabricate responses or search/CRM successes.
- **Disconnected:** Actual LLMs, hosted Supabase, company catalog, Tavily/research, voice and CRM. No prices, inventory, bookings, leads, handoffs or sources were invented.

Provider status starts `not_verified`; a configured key/model alone is not success. The explicit probe requires an authenticated tool proposal, actual deterministic tool execution and final response before declaring a real round-trip pass. Streaming deltas are real protocol chunks when enabled, but provisional until terminal validation and persistence acknowledgment. There is no simulated streaming timer. Run/event replay remains process-local; durable completed answers can be recovered through history/request ID after restart.

## Blocked / limitations

- No Gemini/Groq/OpenRouter/Tavily keys, no Supabase URL/ref/publishable key, and no `.env`. Actual account model access, free quota, real tool/stream behavior and hosted setup cannot be verified.
- No approved remote target was inspected or modified. Docker/native Postgres are absent. PGlite validates actual PostgreSQL/RLS, not Supabase Auth, PostgREST configuration, hosted advisors, backups or production scaling.
- Personal customer tenants are implemented; shared organization memberships/RBAC are future scope. Local guests are development identities, not full account enrollment/recovery. Production mode remains blocked pending hosted/security/privacy acceptance, including account-erasure operations.
- Summaries are labeled bounded **extractive excerpts**, not invented model summaries. Opt-in memory is separate from original chat history. Expired rows are RLS-inaccessible; explicit forget removes physical content, and no cleanup scheduler was added.
- Model memory-writing tools remain disabled; explicit API consent/review is the supported memory path. CRM, voice, frontend and automation were intentionally not begun.
- Request IDs prevent duplicate durable writes; they do not guarantee exactly-once provider invocation across multiple API instances. Reported usage after failed/retried calls can be incomplete and is not a monetary cap. An abort cannot recall already transmitted provider input or guarantee provider billing stops.
- The 61 behavioral evaluation specifications remain unexecuted as natural-language/model scenarios. No behavioral accuracy, voice performance, browser screenshot or production-readiness claim is made.

## Exact configuration / next gate

Local persistence needs no external secret: `PERSISTENCE_MODE=local`, `LOCAL_DATABASE_PATH=.private/postgres`.

For one real model, configure `MODEL_PROVIDER`, its matching `GEMINI_API_KEY`/`GEMINI_MODEL`, `GROQ_API_KEY`/`GROQ_MODEL`, or `OPENROUTER_API_KEY`/`OPENROUTER_MODEL`, plus `ENABLE_REAL_PROVIDER=true` and `ALLOW_SYNTHETIC_PROVIDER_DATA=true`. `ENABLE_PROVIDER_STREAMING=true` opts into actual streaming; `FALLBACK_PROVIDERS` stays empty unless explicitly selected.

Hosted Supabase needs `PERSISTENCE_MODE=supabase`, `SUPABASE_PROJECT_REF`, matching `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`; optional `ENABLE_SUPABASE_GUEST=true` only after project Auth/CAPTCHA setup. Do not configure a service-role client. Optional future research uses server-only `TAVILY_API_KEY` but is not connected in M2.

Next: configure a synthetic-only live model and run its explicit probe; identify/verify the isolated Supabase project, review existing tables/advisors and permissions, apply the reviewed migration only with authorization, then verify real JWTs and RLS for two hosted users, refresh/logout and memory erasure. Close M2's hosted/live gate before beginning M3. Exact Windows steps and official references are in `docs/REAL_API_SETUP_GUIDE.md`.

## Approval

No approval is needed for the completed local work. No public deployment, push, purchase, paid upgrade, customer data transmission, remote schema change, CRM action, message or scheduled workflow occurred. Remote schema actions retain the project's explicit approval requirement; no extra confirmation is requested for the completed implementation.

The development server was stopped after verification. `pnpm dev` starts it again; no background delivery or scheduled job remains running.
