# M2 final acceptance — 2026-11-05 (Africa/Cairo)

**M2 COMPLETE for the approved local/development scope.** This is not production approval or completion of the whole product. The user explicitly made OpenRouter optional; its quota block does not invalidate the verified Gemini/Groq core. M3 is now in development. No frontend, CRM, voice, deployment or automation is accepted by this gate.

## Mandatory acceptance review

| Criterion | Observed evidence | Result |
|---|---|---|
| Isolated dedicated cloud target | Sadeeman `ujdzysbowngtkwndgoqf`, `eu-west-1`, PostgreSQL 17.11, healthy; unrelated projects untouched | PASS |
| Exact approved migrations | Two unchanged SQL files; hashes and remote ledger versions mapped in [application report](CLOUD_APPLY_AND_PROVIDERS_2026-11-05.md); nine installed tables | PASS |
| Auth, grants and tenancy | Two actual Auth users; real JWT/PostgREST owner-positive/other-user-negative tests; authenticated role has no RLS bypass | PASS |
| Database-level RLS | RLS/FORCE RLS on all nine tables, scoped policies, explicit table/function permissions and private definer checks | PASS |
| Persistent identity and history | Actual Cloud API restart/restoration, completed messages and real model continuity after restart | PASS |
| Consent and memory | Missing consent denied; accepted consent allows storage; correction/version check, restart restoration, explicit deletion, revocation erasure and conversation-provenance cascade verified | PASS |
| Session refresh and revocation | Real refresh and durable application logout verified | PASS |
| Tool execution records | Actual model-directed budget execution + confirmed Cloud tool metadata | PASS |
| Genuine primary model | Gemini `gemini-3.5-flash-lite`: generation, multi-turn context, tools and streaming verified | PASS |
| Verified fallback provider | Groq `openai/gpt-oss-20b`: actual generation, tool round trip and streaming verified | PASS |
| Bounded honest recovery | Automated retry/fallback/partial-stream/circuit tests; actual controlled Gemini deadline failure/recovery in local verification; no fabricated answer path | PASS |
| Current runtime selection | Gemini primary, Groq only active fallback, OpenRouter explicitly disabled, same-provider retries 0 and 60-second exhausted-quota cooldown | PASS |
| Original regressions | Original 89 tests passed after M3 wiring; added routing/evidence tests passed separately | PASS |
| Supabase security checks | Post-apply advisor returned zero security findings; six foreign-key index and eight initial unused-index INFO findings reported, no unapproved SQL applied | PASS, performance follow-up recorded |

Primary dated evidence: [Cloud/database/provider application report](CLOUD_APPLY_AND_PROVIDERS_2026-11-05.md), [original local M2 evidence](MILESTONE_M2_2026-11-05.md), source tests and the commands recorded there. This review reuses those observed successful integrations; it does not claim to have repeated cloud mutations during the M3 work.

## Runtime and privacy scope

`tools/configure-cloud.ps1 -Service RuntimePolicy -EnableResearch -EnableGuest` saves the verified model pair and enabled local guest entry while preserving existing secrets/target. Real accounts use the existing owner/JWT/RLS boundary; no service-role key is introduced. Production stays disabled because deployment, registered-account onboarding/recovery, operational policy and private-customer processing have separate gates.

Fresh process status starts `not_verified` until that process observes a successful call; offline configuration does not fabricate an uptime check. Quota exhaustion moves to the configured fallback under bounded policy; partial streamed text is never combined with another provider's output. OpenRouter credentials/model remain configured, but `ENABLE_OPENROUTER_RUNTIME=false` prevents activation even if accidentally included in a fallback string. No OpenRouter retry or purchase occurred.

The user explicitly authorized temporary use of the currently configured Tavily key despite its prior exposure. No claim is made that this key was rotated or that the exposed key was revoked. The current one-shot Tavily authentication/search succeeded; this is the M3 gate, not a replacement for the M2 database evidence.

## Next

Continue M3 source-grounded travel intelligence and its live/automated evaluations. Actual company catalog data, supplier inventory, CRM, voice, frontend and outreach are outside this completed M2 gate. No additional Supabase migration is authorized or required for the current research slice.
