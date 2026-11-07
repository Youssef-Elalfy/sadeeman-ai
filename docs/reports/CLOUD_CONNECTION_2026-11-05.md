# Cloud + Gemini integration checkpoint — 2026-11-05

Historical preparation checkpoint. Subsequent approved migration application, real two-user Cloud acceptance and current provider outcomes are in [the application report](CLOUD_APPLY_AND_PROVIDERS_2026-11-05.md).

## Done

- Verified only the existing **Sadeeman** project, `ujdzysbowngtkwndgoqf`, `eu-west-1`, `ACTIVE_HEALTHY`, actual PostgreSQL 17.11, through the authenticated Supabase connector. No other project's schema/data was inspected or changed.
- Pinned its public target in `config/supabase-target.json`; normal runtime rejects another ref/URL. Test doubles remain test-only.
- Configured the ignored local `.env` without displaying keys. Both Gemini and Supabase publishable keys are present. Selected `gemini-3.5-flash-lite` after an authenticated complete model catalog and actual tool/stream verification. No database password, service-role key, custom JWT secret or paid upgrade is required or configured by this work.
- Normal development uses actual provider responses and public, nonsensitive inputs. Synthetic input opt-in is restricted to explicit test processes. Live verification uses real adapters, never scripted model responses.
- Added the second, additive tool-execution metadata migration and atomic turn/trace storage, owned trace API, failure metadata handling and real PostgreSQL tests. Original applied local migration is unchanged. No CRM action/table is activated.
- Added masked credential setup, read-only cloud preflight, authenticated model catalog, genuine local Gemini end-to-end verification and prepared real-cloud end-to-end verification.
- Fixed startup environment loading to resolve the project's `.env` from the module location. Fixed credential ACL handling for Codex's sandbox account: the executing account, actual workspace owner and LocalSystem retain access; inheritance is disabled. Verified the real Windows account can start the configured API.
- Updated `README.md`, `apps/api/README.md`, and `docs/REAL_API_SETUP_GUIDE.md`. The static brand preview and future frontend/voice/CRM scope are unchanged.

## Verified

Story: terminal/public-data acknowledgment → authenticated API → real Gemini + local PostgreSQL → actual tool execution → SSE completion; cloud identity/database acceptance is a separately blocked branch.

| Command / check | Observed outcome |
|---|---|
| Original pre-change `pnpm test` | 78/78 passing in 8 files |
| Final application `pnpm test` | **83/83 passing**, 9 files; original behaviors preserved |
| `pnpm build` | Both workspace packages compiled successfully |
| `pnpm typecheck` | API/contracts and tests/tools passed |
| `pnpm lint` | Passed; 46 files checked |
| `pwsh -NoProfile -File tests/configure-cloud.test.ps1` | PASS; fixture-only helper checks, protected ACL, preserve-key model selection, Supabase setup, wrong-project rejection without changing the file; real `.env` untouched by tests |
| `pnpm smoke:persistence` | PASS; actual disk PostgreSQL + localhost HTTP; two restarts, restored identity/memory, cross-user denial, deletion and revocation; zero model calls |
| `pnpm gemini:models` | Actual HTTP success: authenticated complete catalog accepted; catalog alone claims no generation/tool pass |
| `pnpm providers:check --live --synthetic --provider=gemini` | `REAL_AUTHENTICATED_TOOL_ROUNDTRIP_PASSED` at **2026-11-05T00:29:23.921Z**; 2 actual Gemini requests, `estimate_trip_budget`, 3 real stream chunks; reported 722 input / 80 output tokens |
| `pnpm verify:gemini --live --test-data` | `REAL_GEMINI_LOCAL_E2E_PASSED` at **2026-11-05T00:31:14.773Z**; actual generation, conversation marker restored after restart, actual model-directed tool + durable local trace, 13 streamed chunks, deadline failure without a committed turn, successful next request with retained context |
| `pnpm start`, then `pnpm smoke` | API bound to localhost in `public_only`; real health/session/conversation/auth checks passed; smoke deliberately made zero model calls |
| `pnpm chat --public-data` | Actual Arabic Gemini reply to a public test greeting: identified itself as Sadeeman, an intelligent travel/conversation assistant. No key, JWT or private customer text printed. CLI and server stopped after verification |
| `pnpm providers:check` | Offline configuration only, zero model requests; fresh process correctly starts with `not_verified`, rather than importing another process's observations |
| Supabase MCP tables + migrations | Both target schemas empty; migration history empty; **zero remote writes** |
| Supabase MCP advisors | Security/performance returned no lints on the empty pre-migration schema; not an RLS acceptance pass |
| Supabase read-only prerequisite SQL | `auth.users`, `auth.uid()`, non-bypass authenticated role, SHA-256/advisory-lock permissions available |
| `pnpm cloud:check` | Actual app publishable key accepted: Auth **200**; `external.anonymous_users=false`; local guest flag false. PostgREST **404 / PGRST205** because the conversation table has not been created. No Auth identities or remote mutations created |

Networked commands used `$env:NODE_USE_SYSTEM_CA='1'` and approved network execution after sandbox requests returned `EACCES`; TLS verification was not disabled. The first catalog attempts under network restriction failed and were not counted as successful integration. Live model verification initially selected the model with `$env:GEMINI_MODEL='gemini-3.5-flash-lite'`; the verified model is now saved locally without rewriting key values.

The timeout test sends a real request with a deliberately short **50ms deadline**, checks safe failure/history preservation, then restores the normal deadline and succeeds. This is controlled deadline recovery, not evidence of a natural provider outage or automatic recovery from every network fault. Cross-provider fallback, quota errors and interrupted-wire behavior have offline test coverage; Groq/OpenRouter have **no live verification** and remain disabled. No model quality percentage or numerical free quota is claimed.

## Blocked

1. **Remote migration approval is pending.** The exact payloads, order, effects and SHA-256 hashes are in `docs/CLOUD_MIGRATION_PLAN.md`. The user's instruction explicitly requires approval before applying them. No remote migration was applied.
2. **Anonymous Auth is disabled** in the dedicated project and locally. The current MCP tools do not expose an Auth-settings mutation. Enable anonymous sign-ins in Sadeeman's Auth settings for the non-PII two-user acceptance flow, then opt in locally with `ENABLE_SUPABASE_GUEST=true`. No email/phone enrollment or privileged Auth deletion is substituted.
3. **Hosted authenticated RLS, two real users, cloud restart/history/memory and combined Cloud+Gemini acceptance are untested** until the first two blockers are resolved. The cloud verification script exists but does not itself prove a pass.

Required runtime credentials and target/model values are present; no additional secret is requested in chat. Cloud persistence is selected locally, with guest entry disabled until schema/Auth readiness. No server is left running.

## Next / approval needed

Approve the two reviewed SQL files **only for `ujdzysbowngtkwndgoqf`**. Recheck target/history/file hashes, apply in order, inspect actual policies/function grants and advisors, enable the explicit guest verification path, then run `pnpm verify:cloud --live --test-data`. It will create two non-PII guest Auth identities and exercise consented test rows; the reviewed cleanup deletes only owned test conversation/memory data, with no destructive schema or admin Auth deletion.

**M2 is not officially complete.** Finish genuine hosted acceptance first. Do not start M3 research/catalog, CRM, voice, 3D frontend, deployment or outreach while these gates remain open.

## Current official references

- [Google model documentation](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite) and [pricing](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite): checked before selecting this actually catalog-listed model; account allowance still depends on the account.
- [Supabase Auth settings source](https://github.com/supabase/auth/blob/master/internal/api/settings.go): verified the actual `external.anonymous_users` response field.
- [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous) and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
