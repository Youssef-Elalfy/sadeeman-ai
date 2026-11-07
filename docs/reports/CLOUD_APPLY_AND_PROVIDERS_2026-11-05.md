# Sadeeman Cloud application and provider verification — 2026-11-05

Historical cloud application checkpoint. Later [M2 final acceptance](M2_FINAL_ACCEPTANCE_2026-11-05.md) closes the development gate; [M3 results](MILESTONE_M3_2026-11-05.md) record the successful Tavily probe and stopped live recheck. Earlier Tavily-untested and guest-disabled statements below describe this historical snapshot.

Times below use **Africa/Cairo (UTC+02:00)**. This report supersedes earlier pending-approval/absent-credential checkpoint statements; it does not rewrite their historical evidence.

## Done

Applied **only the two reviewed, unchanged migrations**, in order, to existing project **Sadeeman**, ref **`ujdzysbowngtkwndgoqf`**, `eu-west-1`, `ACTIVE_HEALTHY`, PostgreSQL 17.11. Immediately before execution, project identity, empty target tables/history and exact local hashes were verified again.

| Source migration | Verified SHA-256 | Recorded remote version / name |
|---|---|---|
| `supabase/migrations/20261104232715_identity_memory_foundation.sql` | `B7A9A3566CBFB27DE42C371AE6ACBF48CA39245E9FDA86DBCA0AA6810A85EE3A` | `20261105005039` / `identity_memory_foundation` |
| `supabase/migrations/20261105001704_tool_execution_records.sql` | `6DBD694C3D5CC9FDF935BCEF2BF5ABAC768268006A0B140A8F49DF13C49443CF` | `20261105005048` / `tool_execution_records` |

Both `apply_migration` calls returned `success:true`. Hashes were rechecked locally at the end and still match. No extra remote schema change, destructive cleanup SQL, unrelated-project operation, paid upgrade, deployment, repository push or outbound message occurred. The MCP generated remote version timestamps differ from the source filename timestamps; names/order and exact reviewed payload mapping are recorded above. Future CLI migration automation must account for this ledger mapping rather than blindly replaying the local timestamped files. No history repair was performed.

The user enabled Anonymous sign-ins in Sadeeman after the initial read-only Auth check showed it disabled. A subsequent read-only check confirmed `external.anonymous_users=true`. Verification explicitly opted into guest entry per process; the ordinary local `.env` still has `ENABLE_SUPABASE_GUEST=false`. No Auth administrator secret or database password was used.

Local implementation changes:

- `tools/cloud-verify.ts`: added a database-only mode, positive owner/negative other-user PostgREST checks, memory/session/conversation restoration after restart, consent-revocation erasure, and conversation-deletion cascade assertions. No mock provider is imported.
- `tools/service-check.ts` and root `services:check`: bounded, explicit live catalog/auth probes and an optional one-query Tavily search probe; no runtime research tool or M3 integration is activated.
- `apps/api/src/providers/catalog.ts`: typed OpenRouter catalog projection, bounded model identifiers, documented-price shape validation and selection of only zero-priced `:free` models advertising `tools` and `tool_choice`.
- `tests/catalog-boundary.test.ts`: six regression/adversarial tests for real tilde-prefixed catalog aliases, malformed IDs/prices/envelopes, catalog bounds and safe model selection.
- `tools/providers-check.ts`: uses the configured bounded output allowance, capped at 2,048 tokens, so reasoning/tool responses are not artificially restricted to the former 256-token probe budget.

## Verified: installed schema and access

Read-only PostgreSQL catalog inspection and Supabase table/history tools confirmed **nine tables, nine policies, ten functions and five enabled application triggers**.

| Table | RLS / FORCE RLS | Authenticated privileges | Owner policy |
|---|---|---|---|
| `sadeeman_conversations` | Both true | SELECT/INSERT/UPDATE/DELETE | `own_rows` |
| `sadeeman_turns` | Both true | SELECT/INSERT/UPDATE/DELETE | `own_rows` |
| `sadeeman_messages` | Both true | SELECT/INSERT/UPDATE/DELETE | `own_rows` |
| `sadeeman_consents` | Both true | SELECT/INSERT/UPDATE/DELETE | `own_rows` |
| `sadeeman_memories` | Both true | SELECT/INSERT/UPDATE/DELETE | `own_memories`, active consent and expiry predicates |
| `sadeeman_requests` | Both true | SELECT/INSERT/UPDATE/DELETE | `own_rows` |
| `sadeeman_audit_events` | Both true | SELECT only | `own_rows` |
| `sadeeman_session_revocations` | Both true | SELECT/INSERT | `own_sessions` |
| `sadeeman_tool_executions` | Both true | SELECT/INSERT | `own_tool_records` |

The `anon` role has **no SELECT/INSERT/UPDATE/DELETE grant on any of the nine tables**. The `authenticated` role has `rolbypassrls=false`. Owner policies have both USING and WITH CHECK predicates; normal data policies also check application-session revocation. Memory visibility additionally requires unexpired content and active accepted consent.

Six public functions exist as **SECURITY INVOKER**, with empty search paths, authenticated EXECUTE and no anon EXECUTE: `sadeeman_session_active`, `sadeeman_memory_json`, `sadeeman_operation`, `sadeeman_save_tool_executions`, `sadeeman_commit_turn`, `sadeeman_list_tool_executions`.

Four private functions exist with empty search paths: invoker trigger guards `guard_consent` / `guard_memory`; owner-checked definer helpers `record_audit` / `forget_memory`. Audit execution is revoked from ordinary roles; authenticated customers may invoke only their scoped erasure helper. The anon role lacks private-schema USAGE, so its inherited function-level trigger EXECUTE bits do not provide schema access. Supabase default sequence USAGE is present for both generated-ID sequences; audit-table INSERT remains denied to authenticated callers.

Enabled triggers: `immutable_consent`, `valid_memory`, `conversation_audit`, `memory_audit`, `consent_audit`.

## Verified: real cloud operations

`pnpm verify:cloud --live --test-data --database-only` passed at **02:54:54 Cairo**, with `ENABLE_SUPABASE_GUEST=true` selected for that command and **zero model calls**:

- Two genuine non-PII Supabase Auth users, publishable key + their actual JWTs, no service-role bypass.
- Owner direct PostgREST SELECT returned the owned conversation; the other user's direct SELECT returned `[]`, and cross-owner application access returned 404.
- Memory creation without valid consent was denied; accepted consent allowed creation and version-checked correction.
- Verified session, conversation and corrected memory after closing/restarting the API.
- Explicit memory deletion; consent revocation physically erased linked preferences.
- Conversation deletion returned success, subsequent lookup returned 404 and its linked memory was absent.
- Auth refresh and durable application-session revocation behaved correctly.

`pnpm verify:cloud --live --test-data` passed at **02:55:56 Cairo** with actual Gemini `gemini-3.5-flash-lite` and all the database checks above, plus:

- Actual generated conversation marker, successful stored-message restoration after restart and a genuine second model response retaining the marker.
- Actual model-directed `estimate_trip_budget` execution and durable tool metadata.
- **11 actual streamed text chunks**; no scripted model answer or simulated streaming.

These two runs created **four** non-PII guest Auth identities in total. They remain; no privileged Auth deletion was attempted. Owned test conversations/memories were deleted through the reviewed customer APIs; consent/audit/request/revocation metadata was not destructively purged. API processes closed after each run.

## Verified: security and performance advisors

Post-apply **security advisor: no findings (`lints:[]`)**. This is an observed advisor result, not a production-security guarantee.

The initial post-apply performance scan reported:

- **6 INFO foreign-key index findings**: memory consent/provenance, message conversation/turn, tool conversation, and turn conversation constraints. [Official remediation](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
- **8 INFO unused-index findings** at the initial new-table scan, before test traffic. [Official remediation](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

No index was added or removed: only the two approved migration payloads were authorized. No further Supabase SQL or database mutation was executed after the user's later provider-only instruction.

## Provider evidence and stop condition

All probes used current local keys from ignored `.env`, with protected file access. Keys, JWTs, raw provider errors, account metadata and sensitive headers were not printed. Old-key revocation/rotation history was not independently audited.

| Service | Authentication | Generation | Model-directed tool execution | Streaming / persistence |
|---|---|---|---|---|
| Supabase | PASS: two distinct Auth users, refresh and JWT validation | N/A | Application RPC/ownership checks passed | PASS: real Cloud conversation/history/memory after restart |
| Gemini | PASS: authenticated current catalog and actual calls | PASS: `gemini-3.5-flash-lite` | PASS: actual budget tool + durable Cloud trace | PASS: 11 chunks in the combined Cloud run |
| Groq | PASS: authenticated current catalog and actual calls | PASS: `openai/gpt-oss-20b` | PASS: actual budget tool + final model answer | PASS: 14 chunks, 2 actual requests |
| OpenRouter | PASS: `/api/v1/key` and corrected catalog validation | **NOT PASSED: HTTP 429 / PROVIDER_QUOTA** | Unverified; request failed before any tool execution | 0 chunks; exactly 1 generation request, no retry/fallback |
| Tavily | **Not tested** | N/A | Search not tested | Probe prepared; live request not run because of stop instruction |

Groq passed at **03:02:59 Cairo**, reporting 967 input / 274 output tokens across its two requests. This is reported usage, not a free-plan or billing guarantee.

OpenRouter's original HTTP-200 catalog validation failure was diagnosed with permission: its **418-model** response included legitimate public aliases beginning with `~`, e.g. `~unbiased/pareto-latest`. The former ID allowlist rejected that prefix. The fix accepts a single optional leading `~`, keeps length/character constraints and rejects embedded/repeated tildes, malformed numeric prices and malformed catalog structures. Authentication and full catalog parsing then passed at **03:02:38 Cairo**. Only zero-priced `:free` models advertising both tool parameters are eligible for probe selection; arbitrary aliases and paid models are not selected.

The selected catalog-compatible free model `google/gemma-4-26b-a4b-it:free` returned **PROVIDER_QUOTA** on its first generation request. The compatible adapter maps HTTP 429 to that code. **Stopped all live checks immediately**, as the user required: no retry, model switch, paid fallback, Tavily request or new database operation followed. OpenRouter generation/tool compatibility has not passed simply because its catalog did.

## Verified: local regressions and safe fallback

Final commands and observed results:

| Command | Result |
|---|---|
| `pnpm build` | Both workspace packages compiled |
| `pnpm typecheck` | API/contracts/tests/tools passed |
| `pnpm lint` | Passed, 49 files checked |
| `pnpm test` | **89/89 passed in 10 files**; previous 83 and original 78 behaviors preserved |
| `pwsh -NoProfile -File tests/configure-cloud.test.ps1` | PASS; fixture-only credential-helper/ACL/target checks; real `.env` untouched by tests |

Fallback/retry/circuit tests ran inside the automated suite with explicitly test-only adapters and **zero external API calls**. They verify one healthy primary call without fallback, explicit compatible fallback after quota failure, bounded retries, circuit opening after repeated failure and **no retry/fallback after partial streamed output**. No live outage was induced and no actual cross-provider failover is claimed. Production fallback configuration remains empty.

Provider probe commands selected `PERSISTENCE_MODE=ephemeral` per process, so they did not access Supabase. Groq selected `MODEL_PROVIDER=groq`, `GROQ_MODEL=openai/gpt-oss-20b`; OpenRouter selected `MODEL_PROVIDER=openrouter`, `OPENROUTER_MODEL=google/gemma-4-26b-a4b-it:free`. Both explicitly selected real providers/streaming and an empty fallback list, then ran `pnpm providers:check --live --synthetic --provider=...`. The synthetic flag selects test inputs only; responses were actual provider results.

## Blocked / next

**Stopped on OpenRouter quota as instructed.** Supabase Cloud and primary Gemini acceptance passed; the complete multi-provider readiness task remains incomplete because OpenRouter generation is blocked and Tavily has not been exercised. M3, CRM, voice, frontend, deployment and outreach were not started.

Next work requires the user to resume: resolve/check OpenRouter allowance without a paid upgrade, authorize a bounded later retry, and run the prepared single basic Tavily public-document search. No additional Supabase SQL is required for these provider checks. Ordinary local guest entry remains disabled; verification used an explicit per-process opt-in. No secret should be sent in chat.

Current official contracts consulted: [Groq tool use](https://console.groq.com/docs/tool-use/overview), [Groq GPT-OSS model](https://console.groq.com/docs/model/openai/gpt-oss-20b), [OpenRouter current-key API](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key), [model catalog](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), [Tavily usage](https://docs.tavily.com/documentation/api-reference/endpoint/usage), [Tavily search](https://docs.tavily.com/documentation/api-reference/endpoint/search), and [Supabase anonymous Auth](https://supabase.com/docs/guides/auth/auth-anonymous).
