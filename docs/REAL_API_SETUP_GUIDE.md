# Real service setup — Windows / SADEEMAN AI

Verified against official documentation on **2026-11-05 (Africa/Cairo)**. Local PostgreSQL tests are real database evidence; provider/hosted-Supabase doubles in automated tests are not authenticated integration evidence. See the dated [cloud application and provider report](reports/CLOUD_APPLY_AND_PROVIDERS_2026-11-05.md) for actual live passes and the OpenRouter quota stop. A model configured in Codex does not grant API credit to this product.

## 1. Install and verify without credentials

Open PowerShell inside this project:

```powershell
$env:NODE_USE_SYSTEM_CA='1'
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm smoke:persistence
pnpm providers:check
```

The certificate setting uses Windows system trust; do not disable TLS verification. Native Node 24 runs the tools; no global packages, Docker, paid subscription or external database is required for the local PostgreSQL path. `providers:check` without `--live` sends **zero** model requests. `smoke:persistence` creates a dedicated synthetic local database, runs actual HTTP/DB operations across server restarts, then removes that temporary database.

Enter credentials locally through the masked helper, which preserves other settings and restricts `.env` to the executing account, the workspace owner and LocalSystem:

```powershell
pwsh -NoProfile -File .\tools\configure-cloud.ps1 -Service Gemini
pnpm gemini:models
pwsh -NoProfile -File .\tools\configure-cloud.ps1 -Service Gemini -Model THE_EXACT_SELECTED_MODEL
pwsh -NoProfile -File .\tools\configure-cloud.ps1 -Service Supabase
```

Leave a hidden key prompt blank to preserve its existing value. The first Gemini step can leave the model blank so you can inspect the authenticated catalog first; catalog success alone does not prove generation. Never paste keys into chat, screenshots, logs or source files. No key should have a `NEXT_PUBLIC_` prefix. Ordinary development accepts public, nonsensitive conversation with actual model responses; private customer processing and production remain disabled. `ALLOW_SYNTHETIC_PROVIDER_DATA=true` is rejected outside an explicitly selected `NODE_ENV=test` process.

## 2. Local PostgreSQL persistence first

Set these values in `.env`:

```dotenv
PERSISTENCE_MODE=local
LOCAL_DATABASE_PATH=.private/postgres
ENABLE_REAL_PROVIDER=false
```

Then:

```powershell
pnpm db:migrate --local
pnpm dev
```

This is **PGlite, an actual embedded PostgreSQL engine**, stored on disk in this project. It is not a mock Supabase server and does not run Supabase Auth/PostgREST. See [PGlite filesystem persistence and parameterized queries](https://pglite.dev/docs/) and [transaction API](https://pglite.dev/docs/api). A single local process owns the database; this path is for development, not multi-instance production. Never point its path at an unrelated directory. Local startup applies checksummed migrations; edited already-applied migrations fail closed. Add a new migration for an upgrade.

Guest sessions are random bearer secrets stored as hashes with seven-day expiry. The caller keeps the returned token privately and supplies it to restore identity after restart. Losing/expiring the guest token means losing that guest identity; a fresh guest is a different customer. Tokens are not logged or saved to a CLI file. Local account recovery and registered-user sign-in belong to the hosted identity path below.

Authenticated endpoints:

| Request | Required data / result |
|---|---|
| `POST /api/v1/auth/guest` | Development: `{ "acceptPublicDataPolicy": true }`; explicit test environment: `{ "acceptSyntheticDataPolicy": true }`. Returns token and expiry; save privately in the client |
| `GET /api/v1/auth/session` | Bearer token; verified owner and persistence mode |
| `DELETE /api/v1/auth/session` | Durable application-session revocation |
| `POST /api/v1/conversations` | `{}`; creates a durable owned conversation |
| `GET /api/v1/conversations/:id` | Owned messages, bounded extractive summary, persistence mode |
| `GET /api/v1/conversations/:id/tools` | Owned durable tool execution metadata, without arguments or results |
| `DELETE /api/v1/conversations/:id` | Erases owned history and preferences whose provenance is that conversation |
| `POST /api/v1/consents` | Explicit `{purpose:"travel_preferences",accepted:true/false,version:"memory-v1",requestId:UUID}` |
| `POST /api/v1/memory` | `consentId`, allowed `category`, `content`, `sourceConversationId`, `requestId`; optional `expiresInDays` (1–365, default 90) |
| `PATCH /api/v1/memory/:id` | Reviewed content/category/consent, `expectedVersion`, new `requestId`; optional expiry |
| `DELETE /api/v1/memory/:id` | Idempotent erasure, including expired content |
| `DELETE /api/v1/consents/:id` | Revokes consent and erases linked preferences |
| `GET /api/v1/audit` | Own action/resource/time metadata; no stored message or preference text |

Every request except health/guest needs `Authorization: Bearer <token>`. The backend derives ownership; never send `ownerId`, `tenantId`, a role claim or `consentGranted`. Such fields cannot authorize memory storage. Model tools cannot write memory or CRM in this milestone; memory writes are explicit structured customer API actions. Deleting a preference does not erase the separate conversation where the user originally mentioned it; delete that conversation when that history must also be erased. Expired preferences are hidden by RLS; explicit deletion physically erases them. No automatic cleanup job is scheduled.

Consent responses distinguish the historical `accepted` fact from its current `active` state. Replaying an older acceptance after revocation does not reactivate it. Revocation and memory corrections/deletions abort current owner runs to prevent further use of removed context; input already sent to a provider cannot be recalled. A confirmed database commit is the completion point when a cancellation arrives late.

The database uses a personal tenant per customer (`tenant_id=owner_id`), not shared organization/team memberships. Database tests set the non-bypass `authenticated` role for different users; they do not rely solely on privileged reads. Hosted Supabase advisors, real JWT gateways and production-scale behavior still need verification.

## 3. Google Gemini

Use [Google AI Studio API keys](https://aistudio.google.com/api-keys), [current models](https://aistudio.google.com/docs/models), [official SDK](https://aistudio.google.com/docs/libraries), [function calling](https://aistudio.google.com/docs/function-calling) and [pricing/data-use policy](https://aistudio.google.com/docs/pricing).

The provider offers limited free access to selected models; not every model is free or available to every account. Free-tier content may be used to improve Google's products. Check the current console/terms for your region and selected model; no quota or account entitlement is assumed here. Do not enable billing or upgrade without approval.

```dotenv
MODEL_PROVIDER=gemini
GEMINI_API_KEY=your_secret_in_local_env_only
GEMINI_MODEL=the_exact_current_tool_capable_model_from_your_console
ENABLE_REAL_PROVIDER=true
ALLOW_SYNTHETIC_PROVIDER_DATA=false
ENABLE_PROVIDER_STREAMING=true
FALLBACK_PROVIDERS=
```

Then run the small, explicitly live synthetic probe:

```powershell
pnpm build
pnpm providers:check --live --synthetic --provider=gemini
```

`--synthetic` explicitly selects `NODE_ENV=test` for that command's inputs; it always uses actual provider responses. Success requires **two actual authenticated responses**, a model-proposed validated tool call, actual deterministic budget-tool execution, and a final model response. Only `REAL_AUTHENTICATED_TOOL_ROUNDTRIP_PASSED` is success. The probe prints status/counts/usage, never keys or customer text. It can consume your provider allowance; choose a model whose charges/terms you have checked. Missing credentials return DISCONNECTED with zero calls.

For genuine multi-turn, streaming, local database restart, durable tool metadata and controlled timeout recovery, run `pnpm verify:gemini --live --test-data`. This creates/removes its own local PostgreSQL directory; it does not access or verify Supabase Cloud. It applies a 50ms real-request deadline, checks that failure does not commit a conversation turn, then retries with the normal deadline. This is controlled recovery evidence, not a claim that a natural provider outage occurred. Ordinary terminal chat uses `pnpm chat --public-data` against the running development server.

## 4. GroqCloud

Create a key through the [official Groq quickstart](https://console.groq.com/docs/quickstart). Select a current [tool-capable model](https://console.groq.com/docs/tool-use/overview) and inspect the account's [limits](https://console.groq.com/docs/rate-limits) and [data policy](https://console.groq.com/docs/your-data). Development access is subject to organization/model limits; check the account console for its free-plan availability. No numerical quota or voice capability is assumed by this code.

```dotenv
MODEL_PROVIDER=groq
GROQ_API_KEY=your_secret_in_local_env_only
GROQ_MODEL=the_exact_supported_model_from_your_console
ENABLE_REAL_PROVIDER=true
ALLOW_SYNTHETIC_PROVIDER_DATA=false
ENABLE_PROVIDER_STREAMING=true
```

```powershell
pnpm providers:check --live --synthetic --provider=groq
```

The adapter uses the documented Chat Completions endpoint with strict JSON/tool validation, real SSE when enabled, bounded response bytes and deadlines. STT/TTS are later milestones; configuring this text key does not make voice functional.

## 5. OpenRouter (optional)

Use [official quickstart](https://openrouter.ai/docs/quickstart), [tool calling](https://openrouter.ai/docs/guides/features/tool-calling), [free variants](https://openrouter.ai/docs/guides/routing/model-variants/free) and [provider privacy controls](https://openrouter.ai/docs/guides/features/zdr). A free variant exists only when listed in the current catalog. Paid fallbacks can incur charges; leave fallback selection empty until deliberately configured and reviewed. Check each underlying processor's data policy.

```dotenv
MODEL_PROVIDER=openrouter
OPENROUTER_API_KEY=your_secret_in_local_env_only
OPENROUTER_MODEL=an_exact_current_tool_capable_catalog_id
ENABLE_REAL_PROVIDER=true
ALLOW_SYNTHETIC_PROVIDER_DATA=false
```

```powershell
pnpm providers:check --live --synthetic --provider=openrouter
```

To opt into application fallback later, set for example `FALLBACK_PROVIDERS=groq,openrouter` and configure those keys/models. Normal turns use one provider, moving sequentially only on compatible failures. No retry/fallback occurs after text was already streamed. Partial deltas are provisional; only `response_completed` acknowledges a saved successful turn. Retry budgets and reported token counts are not a monetary spending guarantee, especially after failed requests.

## 6. Hosted Supabase / PostgreSQL

Use the **existing dedicated Sadeeman project**, verified as `ujdzysbowngtkwndgoqf`, in the [Supabase dashboard](https://supabase.com/dashboard/project/ujdzysbowngtkwndgoqf). Do not create another project. Review [anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous), [getUser verification](https://supabase.com/docs/reference/javascript/auth-getuser) and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). No paid upgrade is authorized.

First verify the project reference and owner in its dashboard. Record it privately in `.env`:

```dotenv
PERSISTENCE_MODE=supabase
SUPABASE_PROJECT_REF=ujdzysbowngtkwndgoqf
SUPABASE_URL=https://ujdzysbowngtkwndgoqf.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_project_publishable_key
ENABLE_SUPABASE_GUEST=false
```

The URL/ref must match exactly. The backend uses **publishable key + each verified user's JWT**, so RLS runs as that user. A legacy anon JWT key can be supplied under `SUPABASE_PUBLISHABLE_KEY`; service-role and `sb_secret_` keys are rejected. `SUPABASE_SERVICE_ROLE_KEY`, old `SUPABASE_ANON_KEY`, `JWT_SECRET` and `DATABASE_URL` are not used by this runtime. Never provide a service-role key to a frontend or use it as an RLS test identity. A database administrator URL/password, if later needed for migrations, is server/operator-only and must not be printed or placed on command lines.

The hosted schema comprises `supabase/migrations/20261104232715_identity_memory_foundation.sql` and `supabase/migrations/20261105001704_tool_execution_records.sql`. The original migration remains unchanged. Review the [exact migration approval plan](CLOUD_MIGRATION_PLAN.md), including both file hashes, before explicitly approving a remote apply. The project does not auto-migrate Supabase at startup. Ordinary runtime rejects URL/ref values outside `config/supabase-target.json`. MCP connector access does not configure application credentials; no administrator password or service-role key is needed for this runtime or the prepared MCP migration path.

This project pins CLI **3.0.0**. Its [v3 migration guide](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3) changed defaults: database commands are local by default and hosted changes require confirmation. Keep CLI state inside this folder ([official SUPABASE_HOME documentation](https://github.com/supabase/cli/blob/develop/apps/cli/docs/supabase-home.md)):

```powershell
$env:SUPABASE_HOME=Join-Path (Get-Location) '.private/supabase-cli'
pnpm exec supabase --version
pnpm exec supabase migration new --help
pnpm exec supabase db push --help
pnpm exec supabase migration list --help
```

These help commands make no database change. The cloud plan uses the authenticated Supabase MCP migration tool after explicit approval, pinned to Sadeeman. Do not add `--yes` or use an unreviewed remote. Local full-stack Supabase additionally needs Docker; this machine did not have Docker. PGlite does not validate GoTrue, PostgREST configuration or hosted advisors.

Registered users can present an existing Supabase access JWT to the API; the server calls `getUser` and validates the RLS identity before use. To allow the explicit guest endpoint, enable anonymous sign-ins in that isolated project's Auth settings, configure abuse/CAPTCHA protection, then set `ENABLE_SUPABASE_GUEST=true`. A guest's JWT uses the `authenticated` role but only its own subject's records. Refresh through `POST /api/v1/auth/refresh` with `{refreshToken}`; keep returned access/refresh secrets in the client and never log them. App logout durably revokes its session ID in the database, including refreshed tokens for that session. It is application revocation, not a claim that every Supabase Auth access token was globally invalidated. Registered-account enrollment, account recovery and full customer deployment remain subject to a hosted end-to-end acceptance pass.

## 7. Tavily (optional, M3)

Tavily now has an actual server-only adapter and one successful authenticated travel-search probe. See [M3 evidence and current quota stop](reports/MILESTONE_M3_2026-11-05.md). The key's earlier exposure is a user-accepted temporary development exception, not a claim of rotation. Never send contact information, passport contents or private travel details as search queries. No paid service or upgrade is enabled.

After successful service verification, the masked helper can apply the currently verified runtime policy:

```powershell
pwsh -NoProfile -File .\tools\configure-cloud.ps1 -Service RuntimePolicy -EnableResearch -EnableGuest
pnpm providers:check
```

This preserves secrets and sets Gemini primary, verified Groq fallback, OpenRouter disabled and same-provider retries 0. Search caps are two per turn and twenty per hour **per API process**; they are not an account-wide billing cap. `-EnableGuest` only selects the local path already enabled in the verified Sadeeman project. `pnpm providers:check` remains offline.

**All live model/search probes are paused pending quota availability and explicit user approval.** The future dialogue command is `pnpm eval:travel --live --public-test-data --quota-ready-confirmed --approved-run`; these flags are required, not approval by themselves. It caps total Tavily requests at two, uses ephemeral persistence and never calls OpenRouter/Supabase. See [M3 hardening guide](M3_HARDENING_GUIDE.md) for exact acceptance limits and [applied catalog schema](M3_CATALOG_MIGRATION_PLAN.md) for the separately completed Cloud database gate. Research evidence includes retrieval time and nullable publication estimates; neither a search hit nor a source timestamp proves booking availability or visa eligibility. The source-backed planner leaves unsupported days unfilled; no FX, confirmed schedules or real company stock is invented.

## 8. How to know what actually works

- `pnpm test`: deterministic tests, with real embedded PostgreSQL/RLS where labeled and mocked provider/hosted API transports where labeled. Not live model quality evidence.
- `pnpm smoke:persistence`: real local HTTP + disk PostgreSQL across restarts, zero model calls.
- `pnpm providers:check`: configuration only. Explicit `--live --synthetic --provider=...` requires real authenticated tool round-trip success.
- `pnpm gemini:models`: authenticated catalog only; never claims a generation/tool pass.
- `pnpm cloud:check`: read-only app-key/Auth settings/PostgREST preflight against the locked project; no identities, DDL or model calls. It reports anonymous Auth availability without changing it.
- `pnpm services:check --live --service=groq|openrouter|tavily`: actual catalog or key-authentication probe; never treats a catalog as a generation pass. Tavily `--search` opts into one basic public-document search. Current live checks are stopped on the reported OpenRouter quota; do not retry automatically.
- `pnpm verify:gemini --live --test-data`: real Gemini + temporary local PostgreSQL, restart/context/tools/streaming and controlled deadline recovery; no cloud verification.
- `pnpm verify:cloud --live --test-data`: only after the two reviewed migrations are approved/applied, local credentials are ready and anonymous Auth is enabled. Uses two real guest Auth users, direct PostgREST RLS, consent/update/delete, restored session/history and actual Gemini/tool/streaming. Leaves two non-PII guest Auth accounts; no admin deletion. A blocked/failed stage is not a pass.
- Add `--database-only` to verify Cloud identity/RLS/consent/memory/restart/deletion with zero model calls. It does not seed scripted assistant messages or claim a generation pass.
- `GET /api/v1/health`: configured vs disconnected capability information; configuration is not proof of connectivity.
- Authenticated `GET /api/v1/providers`: observations from successful/failed provider requests in this running server. `not_verified` is the starting state; timestamps are observations, not uptime promises. A standalone CLI probe runs in a separate process and does not update server observations.
- `pnpm eval:inventory`: the 61 desired behavioral scenarios remain distinct from executed assertions; no accuracy percentage is claimed.

If a provider returns 401/403, check the key/model in its console; 429 means quota/rate limits, not an invitation to upgrade automatically. Timeouts/outages produce a safe failure and preserve prior conversation context. If a migration checksum fails, restore the original applied file and add a new migration; do not silently change the ledger. Back up `.private/postgres` only while the server is stopped. It contains private local session hashes and conversation data; don't commit or share it.
