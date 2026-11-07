# SADEEMAN AI — M1 core / M2 persistence API

M2 is complete for approved development: [acceptance](../../docs/reports/M2_FINAL_ACCEPTANCE_2026-11-05.md). M3's initial research backend exists, but its full gate is incomplete: [current live/offline results](../../docs/reports/MILESTONE_M3_2026-11-05.md).

Fastify + strict TypeScript. Run `pnpm dev` from the project root. Localhost binding only; no deployment or production mode. `pnpm start` runs a previous build. Restart after edits. No web app is served at `/` yet.

| Method | Implemented path | Behavior |
|---|---|---|
| GET | `/api/v1/health` | Safe capabilities; configured is not proof of provider connectivity |
| POST | `/api/v1/dev/sessions` | Localhost/Host/Origin checked; ephemeral (1h) or local guest (7d); public-data acknowledgment in development, synthetic-data acknowledgment in tests; disabled for hosted Supabase |
| POST | `/api/v1/auth/guest` | Explicit public-data development or synthetic-input test acknowledgment; local or enabled Supabase guest identity |
| GET / DELETE | `/api/v1/auth/session` | Verify/restore identity or durably revoke it in persistent modes |
| POST | `/api/v1/auth/refresh` | Hosted Supabase refresh, with application-session revocation check |
| POST / GET | `/api/v1/conversations` | Create/list current owner's conversations in selected persistence mode |
| GET | `/api/v1/conversations/:id` | Owner-scoped successful conversation messages |
| GET | `/api/v1/conversations/:id/tools` | Owner-scoped durable actual tool execution metadata |
| POST | `/api/v1/agent/messages` | Strict request; 503 disconnected, 202 accepted, or 200 durable replay for the same clientRequestId |
| GET | `/api/v1/agent/runs/:id` | Owner-scoped actual events, completion and reported usage counts |
| GET | `/api/v1/agent/events/:id` | Authenticated SSE; replay, Last-Event-ID, actual tool events and full completed response |
| DELETE | `/api/v1/agent/runs/:id` | Request actual in-flight cancellation |
| GET | `/api/v1/providers` | Authenticated provider observations; initially not_verified |
| POST / DELETE | `/api/v1/consents`, `/api/v1/consents/:id` | Explicit versioned preference consent / revocation |
| GET / POST / PATCH / DELETE | `/api/v1/memory`, `/api/v1/memory/:id` | Consent-scoped owned memory, correction, deletion |
| GET | `/api/v1/audit` | Own metadata-only activity history |
| DELETE | `/api/v1/conversations/:id` | Delete owned history and memories tied to its provenance |

All except health/dev-session/guest/refresh require `Authorization: Bearer ...`. No token in URLs. Browser clients use authenticated `fetch` streaming. CORS permits only `WEB_ORIGIN`; there is no cookie auth. Local opaque guest identity is development-only. Supabase verifies users through Auth and sends their JWTs to SECURITY INVOKER RPCs under RLS, without service-role bypass. Memory consent is a separate durable fact; a guest session is not consent.

Adapters: Gemini official SDK; Groq/OpenRouter compatible REST. Sequential fallback, capability/context limits, deadlines, at most two configured retries, circuit breaker and bounded output. SDK automatic execution/continuation are disabled. `ENABLE_PROVIDER_STREAMING=true` forwards actual provider text chunks as response_delta; interrupted/malformed streams fail safely. No retry/fallback follows a partial answer. response_completed.textDelta contains the full final text and, in persistent modes, is emitted only after database acknowledgment. Raw errors, tool arguments and private thoughts are never public events or logs. Offline wire tests are separate from the actual Gemini generation/tool/stream/recovery observations in the dated report; Groq/OpenRouter remain live-unverified.

Tools: `estimate_trip_budget` does real integer minor-unit arithmetic on supplied estimates, retaining assumptions and `bookable=false`. With catalog disabled, `search_company_packages` reports `CATALOG_DATABASE_NOT_CONNECTED`. The approved/applied schema and `ENABLE_COMPANY_CATALOG=true` provide SQL search/detail/comparison; real persisted Cloud tool checks passed. No runtime fixture imports. `ENABLE_TRAVEL_CONTEXT=true` registers strict model-directed constraint proposals; durable mode additionally requires `ENABLE_TRAVEL_CONTEXT_PERSISTENCE=true`. These three flags are enabled in the dedicated Cloud development configuration, with demo access false and an empty business catalog. See [setup and semantics](../../docs/M3_HARDENING_GUIDE.md). Memory/lead/quote/handoff mutation registration is rejected until durable authorization exists. Booking/payment/outreach do not exist.

With `ENABLE_TRAVEL_RESEARCH=true`, the same model loop registers `research_destination`, `search_external_travel_listings`, `analyze_travel_requirements`, `build_itinerary` and `compare_travel_options`. Tavily calls are basic, bounded and non-retrying; official-source dates remain provider estimates or unknown. Company packages, external unverified listings, supplier live inventory and estimates are distinct. No supplier inventory integration is connected. Plans require source IDs actually fetched in the current owned run; unsupported days stay unfilled. Comparisons use supplied estimates in one currency, without FX.

Research-enabled responses retain actual provider chunks until final URL-citation validation and database acknowledgment. Unknown citations fail completion. Owned run snapshots include `sourceEvidence`; source payloads remain process-local and do not enter metadata-only persistent tool traces. Invalid tool arguments return field paths/types without values; one correction per tool is allowed, then the run fails safely. Live budget-follow-up correction remains unverified because the approved recheck stopped earlier on model quota.

Limits: 16,000 input characters, 24,000 output characters; default 5 tool rounds / 12 calls / 4 calls per output; 15s model and 60s turn deadlines. Completed run replay expires after 15 minutes and retains the latest 100 actual events; run events remain process-local. Confirmed messages, bounded extractive summaries, consent, memory and metadata audits persist in local/Supabase modes. Original ephemeral mode remains RAM-only. Session/consent revocation and memory corrections/deletions abort in-flight owner runs; previously transmitted model input cannot be recalled. A confirmed database commit is the completion point if cancellation arrives late. Failed pre-commit turns leave history unchanged. Idempotency prevents duplicate durable writes, not exactly-once provider billing across multiple API instances. Usage after failures/retries can be incomplete.

Actual tool status, code, duration and identifiers persist without arguments, results or private reasoning. Completed turns commit their tool metadata atomically; failed turns can save actual attempt metadata separately and expose `tracePersisted` truthfully. No trace is invented when database storage fails.

See [Windows setup guide](../../docs/REAL_API_SETUP_GUIDE.md) for exact configuration and payloads and [current live evidence](../../docs/reports/CLOUD_APPLY_AND_PROVIDERS_2026-11-05.md) for authenticated observations. Local database startup applies both versioned migrations with checksum verification; hosted startup never applies migrations. The two approved hosted migrations are installed. The schema implements personal customer tenants, not shared organization membership.

Hosted Supabase JWT/PostgREST isolation, restart persistence and consent/erasure tests previously passed with real users. The new catalog/context migration is now applied and its real two-user/data/tool checks passed. The current advisors report guest-policy/password-protection security warnings and RLS/index performance findings; see the [actual Cloud report](../../docs/reports/M3_CLOUD_APPLICATION_2026-11-05.md). Actual Gemini and Groq tool/stream verification and Tavily basic search previously passed; this migration work made zero model/search calls. OpenRouter remains disabled. Pending: M3 live model acceptance and authoritative catalog data, broader source/planning coverage, registered-account onboarding/recovery and account-erasure operations, CRM, voice and frontend. Production remains disabled. Unimplemented target-outline paths return 404.
