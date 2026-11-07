# M3 hardening checkpoint — 2026-11-05, Africa/Cairo

Historical offline checkpoint. The subsequent [Cloud application report](M3_CLOUD_APPLICATION_2026-11-05.md) supersedes its pending catalog-schema/activation status. The historical live quota evidence and remaining live-model gate are unchanged. The approved SQL moved unchanged from `supabase/migrations/proposed/` to the root migration directory after application.

**M2 remains complete for the approved development scope. M3 hardening passes offline checks; full M3 acceptance remains OPEN.** Zero live model/search requests, zero Cloud SQL/migrations/data/Auth changes during this work. Documentation lookup only used the Supabase docs service. No frontend, voice, CRM, outreach, paid services or deployment work was started. Branding remains سَدِيمًا | SADEEMAN AI.

## Quota investigation: evidence and limits

The unchanged [saved recheck](M3_LIVE_EVIDENCE_2026-11-05.json) records:

```text
stage: M3-LIVE-001
research_destination → ok
build_itinerary → ok
terminal code: PROVIDER_QUOTA
Tavily requests: 1
completed evaluated cases: 0
local SSE HTTP status: 200
```

The failed operation was the **subsequent model-generation stage**, after successful research/planning. This is not a Tavily search-authentication failure: search completed, and search quota has the separate SEARCH_QUOTA category. The recorded HTTP 200 is the local SSE connection status, not the model provider's upstream status.

**Exact provider/model cannot be established from the historical artifact.** It did not capture per-attempt provider identity or upstream status. The adapter's PROVIDER_QUOTA category represents upstream 429; the router can also retain that category during a quota cooldown. The artifact does not establish daily quota versus RPM/TPM/rate limit versus model-specific restriction. All are **unknown**, rather than inferred from a raw message that was not saved. Gemini primary/Groq fallback configuration alone cannot attribute the failing request. Historical OpenRouter quota is separate evidence and does not identify this failure's origin.

The [first attempt](M3_LIVE_ATTEMPT_1_2026-11-05.json) separately passed research/planning and reached a rejected `compare_travel_options` call in the budget follow-up. That old artifact did not record the rejected field; its exact original schema mismatch cannot be reconstructed. Current deterministic tests exercise missing required comparison fields and safe correction; they do not prove what the earlier live model proposed.

New diagnostics record actual adapter/provider, configured model, generation versus streamed generation, allowlisted category, numeric upstream status, timestamp, and explicitly unknown quota scope when unsupported. Raw body/headers/organization identifiers/credentials are discarded. Owned run snapshots and the future evaluator retain these diagnostics even for a failed run. Historical evidence is preserved; the evaluator writes a separate future report.

## Done — company catalog

| Files | Implemented behavior |
|---|---|
| `packages/contracts/src/company.ts` | Strict package, price-basis/provenance, dates, inclusions/exclusions, activities/schedules, references/comparison and travel-state schemas |
| `apps/api/src/travel/catalog.ts` | Persistent SQL search/detail/comparison, exact stored ordinal references, budget-aware ranking, currency-preserving arithmetic, cheaper comparable option search, explicit unknowns |
| `apps/api/src/persistence/{local,supabase,repository,types}.ts` | Scoped transport/RPC mapping; local opt-in proposed schema; atomic context/message/tool commit; strict repository reads |
| `supabase/migrations/proposed/20261105144113_company_catalog_travel_context.sql` | Two new RLS tables, three invoker RPCs; locally tested, **not applied to Cloud** |
| `tools/catalog-import.ts`, root package script | Insertion-only local operator JSON import; rejects demo data, wrong scope/size/schema; no hosted client or automatic fixture seeds |

Only four existing fictional program fixtures were found. Their synthetic prices and inclusions are used **only in automated tests**. The legacy `pricePerAdult` field is conservatively modeled as per-adult in those tests; it does not imply all travelers are adults. No authoritative company prices or schedules were supplied. Descriptions, dates and activities absent from the fixtures remain null/empty. No real programs were fabricated or seeded.

The catalog distinguishes `company_verified`, `company_demo` (FICTIONAL DEMO), external listings with unverified availability, and estimated itineraries. It never claims supplier-live inventory or booking. A known per-adult amount becomes a party total only when the confirmed adult count equals total travelers. Party-total prices require a matching priced party size. Missing figures/composition and currency mismatches retain unknown suitability. No FX conversion or guessed discount occurs.

Tests insert a new program by database data, retrieve it without changing conversational logic, close/reopen PostgreSQL and retrieve stored records again. Production/default authenticated access hides demos and drafts; user metadata cannot elevate access. Catalog writes are denied to authenticated users. Search is bounded to 20 database candidates and six returned summaries; details and comparisons re-read current records.

**Activation status:** all new catalog/context feature flags remain false in the current Supabase configuration. New schema is available for explicit local development/tests; Cloud activation and real operator data remain pending. The import command's missing-argument guard was executed; a real authoritative-business-data import is **untested/unavailable**, since none was supplied.

## Done — multi-turn context and recovery

`apps/api/src/travel/context.ts`, `tools/registry.ts`, `agent/{runtime,prompt}.ts`, `state.ts`, and `server.ts` implement:

- Model-directed `propose_travel_constraints`, quoting current-user evidence for changed fields. Unchanged destination, days, traveler/adult counts, currency and budget remain intact. No implicit numeric “lower budget,” default party size or silent currency conversion.
- Arabic/Persian numeric normalization and small Arabic number words; conservative explicit-value checks, not a claim of full language understanding. Destination/day/exclusion changes invalidate stale ordinal options. Prior adult count is preserved after a traveler-count change, leaving mixed/unknown party pricing unknown until clarified.
- Per-tool strict Zod parsing before execution; field paths/codes/types without proposed values. Confirmed-constraint conflicts have allowlisted field/reason feedback. The actual model loop receives that feedback and gets **one** correction attempt per tool within existing round/call/time/token budgets.
- Repeated invalid arguments/conflicts fail with a safe natural limitation event and no invented result. Provider quota has a safe operational message. These are failure events, not synthetic successful model replies.
- A failed model call or durable commit leaves prior context/history unchanged. Successful persistence commits context and existing messages/tool metadata in one SQL transaction, with optimistic versions and idempotency. Owner isolation and conversation deletion apply to the structured profile.
- Structured context without durable-context mode is explicitly session/process-only. Durable profiles belong to one conversation; they do not create cross-conversation long-term memory or bypass consent-scoped memory APIs.

Observed offline protocol paths include:

```text
invalid constraint proposal → structured CONSTRAINT_CONFLICT delivered to scripted test model
→ corrected proposal → successful answer → commit only changed days

repeated invalid proposal → second rejection → run_failed
→ previous confirmed state/history unchanged, no fabricated completion

API: explicit proposal → actual SQL catalog search (empty test catalog) → answer → atomic SQL commit
→ clear in-memory state → restore SQL constraints → days-only proposal → answer → commit
```

These traces exercise real runtime/registry/SQL using **test-only scripted adapters**, not a live model-quality evaluation.

## Verified — exact checks

| Command/check | Observed outcome |
|---|---|
| `pnpm build` | PASS, both workspace packages compile |
| `pnpm typecheck` | PASS, packages plus tests/tools under strict TypeScript |
| `pnpm lint` | PASS, 68 files, no warnings/fixes |
| `pnpm test` | **170/170 PASS in 16 files**, 22.18 seconds on final run; all 130 original tests preserved plus 40 new |
| `pnpm exec vitest run tests/company-catalog.test.ts tests/m3-hardening-api.test.ts` | 24/24 PASS; real local SQL plus explicitly mocked hosted/provider wire boundaries |
| `pwsh -NoProfile -File tests/configure-cloud.test.ps1` | PASS, fixture-only secure setup; actual project `.env` untouched |
| `pnpm eval:travel` (without approval/quota flags) | Correct refusal before live calls; child exits 2 (pnpm wrapper exits 1). Historical evidence files untouched |
| `node tools/catalog-import.ts` (without local/file flags) | Correct refusal, USAGE_LOCAL_FILE_REQUIRED, exits 1; no database import |
| Selected non-secret runtime config inspection | Gemini primary, Groq fallback, retries 0, OpenRouter false; persistence Supabase; catalog/context/durable-context/demo false |
| `Get-FileHash -Algorithm SHA256` for all migration sources | Both approved M2 files unchanged; proposed SQL matches the hash in the migration plan |

New tests: 14 catalog/SQL checks, 16 structured-context/recovery checks, 10 API/provider/hosted-wire/config checks. All deterministic tests block accidental global fetch calls; explicit provider transports and model replies are fixtures confined to tests. Real PGlite tests check disk restart, data-only package additions, filters, money/unknown handling, ordinal references, RLS/FORCE RLS, invoker search_path and role permissions, metadata spoofing, two-user isolation, version rollback, idempotency, revocation and erasure. New hosted RPC serialization is tested with mocked fetch, **not** the Cloud project. Broader source attribution/error tests remain passing.

## Proposed database changes and security status

Review [exact migration plan and hash](../M3_CATALOG_MIGRATION_PLAN.md). Proposal SHA256:

`4752202DF60641FBA0C2786A13D024F4C0BAB3E35E9E42F7057EF094976F62D4`

No DROP/TRUNCATE/DELETE or UPDATE without WHERE. The new profile RPC has a conflict-targeted UPDATE with owner WHERE, RLS and expected-version checks. Its conversation FK cascade removes only the new owned profile when a conversation is explicitly deleted. No existing objects are replaced. Zero new SECURITY DEFINER functions. Anonymous execute is denied and authenticated catalog writes are denied in the real local permission tests, consistent with [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) and [function permissions](https://supabase.com/docs/guides/database/functions).

The previous hosted M2 security-advisor result remains historical. **No current Cloud advisor scan, collision inspection, new hosted RLS test or hosted migration was performed in this offline task.** Those are required after explicit schema approval; no assertion that the unapplied Cloud schema passed them. Local tests are not a comprehensive security audit or production-readiness claim.

## Blocked, next and approval needed

1. Historical quota provider/model/scope is unknown because the old trace omitted it. Relevant quota availability has not been confirmed. No additional live request was used to investigate.
2. Full M3 live research → itinerary → lower-budget follow-up → constraint preservation → useful Egyptian Arabic answer still needs one bounded, explicitly approved run. The prepared evaluator allows at most two basic Tavily searches, zero same-provider retries, no OpenRouter and no Supabase operations. It stops on failure.
3. Actual live invalid-argument recovery is not yet proved. If no invalid proposal naturally occurs, report NOT_OBSERVED; do not claim a pass or inject fake results. Offline bounded recovery is verified. Natural usefulness requires reviewing actual answers, not just Arabic-script detection.
4. Cloud catalog/context migration needs approval of its exact plan/file/hash, then project/ledger/object rechecks, application and hosted security/isolation verification. Do not enable these Cloud flags first.
5. Authoritative company program data is still needed. Worldwide official entry coverage, real inventory, route feasibility and broader live language/source quality remain limited as stated in the initial M3 report; no production or legal eligibility guarantee.

**Readiness:** code and offline checks are ready for the remaining M3 verification steps, subject to the separate quota/live and Cloud approval gates. **M3 is not formally accepted and no later milestone is started.** Next milestone remains completing M3 acceptance; CRM, premium frontend, voice and automation remain deferred.
