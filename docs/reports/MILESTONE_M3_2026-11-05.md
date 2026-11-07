# M3 Travel Intelligence checkpoint — 2026-11-05 (Africa/Cairo)

Historical initial checkpoint. The subsequent [M3 hardening report](M3_HARDENING_2026-11-05.md) supersedes its catalog implementation and test counts; the saved live results below remain unchanged. No later live pass is implied.

**M2 is formally complete for the approved development scope:** [final acceptance](M2_FINAL_ACCEPTANCE_2026-11-05.md). **M3 is implemented as an initial backend slice, but its full acceptance gate is NOT satisfied.** Live calls are stopped after the single approved recheck returned model-provider quota exhaustion. No frontend, business automation, CRM or public deployment was started.

## Done — implementation paths

| Path | Actual behavior |
|---|---|
| `packages/contracts/src/travel.ts` | Strict public research/planning/comparison schemas and source provenance. Contact/URL/document-number terms are rejected from research fields; this pattern guard is not a complete PII detector |
| `apps/api/src/research/tavily.ts` | Actual fixed-endpoint authenticated Tavily POST; basic search, auto parameters off, no retries, deadline/body limits, strict response projection, safe HTTPS citations, control-character removal, source deduplication and date metadata |
| `apps/api/src/research/travel.ts` | Real model-callable destination research, external listings and official-source requirement research; per-run source ownership, query cache, search quotas and cooldown |
| `apps/api/src/research/planning.ts` | Source-ID-based estimated itinerary with pace/interests/daily allowance, explicitly unfilled unsupported days; deterministic one-currency estimate comparison with integer arithmetic and disclosed rounding |
| `apps/api/src/research/scope.ts`, `grounding.ts` | Sources belong to an authenticated run; final research citations must match URLs actually retrieved in that run. Unknown/invented URLs and missing required citations fail completion |
| `apps/api/src/tools/registry.ts` | Typed tool registration, existing argument/output budgets and side-effect denial retained. Invalid arguments produce value-free field paths/types and bounded safe unexpected-field names, without values or raw errors |
| `apps/api/src/agent/runtime.ts`, `prompt.ts` | Genuine existing model-directed loop, Egyptian Arabic/context instructions, official-source scope rules, no fabricated inventory/prices/URLs; a rejected argument proposal can be corrected once per tool per turn. A second invalid proposal stops the run |
| `apps/api/src/server.ts` | Research wiring into the actual API; safe health capability state and owned run `sourceEvidence`. No second scripted response path |
| `apps/api/src/providers/router.ts`, `config.ts` | Gemini primary/Groq fallback policy, exhausted-quota cooldown, OpenRouter opt-in flag disabled. Partial streamed output is never merged with a fallback |
| `tools/configure-cloud.ps1` | Secure runtime policy setup preserving all keys/target; Gemini `gemini-3.5-flash-lite`, Groq `openai/gpt-oss-20b`, only Groq in active fallback, OpenRouter disabled and same-provider retries 0 |
| `tools/verify-tavily.ts`, `tools/eval-travel.ts`, `tests/evals/m3.scenarios.jsonl` | Explicit actual-service probes and two-case live dialogue evaluator; observer records actual tool outcomes, validation feedback delivery and exact financial checks. It never changes model proposals or substitutes tool results |
| `tests/research.test.ts`, `tests/routing-policy.test.ts`, `tests/m3-agent.test.ts` | Dedicated transport, adversarial, arithmetic, isolation, routing and actual orchestration protocol tests; external/model fixtures exist only in automated tests |

Research results distinguish official-government, curated official-tourism and unverified-publisher sources. Company packages still return **CATALOG_DATABASE_NOT_CONNECTED**: the M2 identity/memory tables are not an approved company catalog. External listings are **unverified availability**, structured advertised prices are not extracted, live inventory is false and booking is false. No fictional fixture is loaded into runtime inventory.

Requirement research prefers destination authorities for Japan, UK, US and Canada. Other destinations use explicitly scoped official advisory sources; these may target the issuing country's nationals. Eligibility remains **not_determined**. No passport numbers, submission, visa guarantee or automatic admission decision exists. This is not complete worldwide legal/entry coverage.

Itinerary blocks are sourced research suggestions, not verified opening hours, route feasibility, transport times or hotel/flight stock. Unsupported days stay unfilled. Budget comparisons operate only on supplied **estimates**, preserve currency/party totals, do no FX conversion and disclose upward minor-unit rounding. Sources in a run snapshot are process-local; completed answer citations can persist through the existing conversation store. New turns must retrieve fresh evidence for current claims.

Research text chunks come from the actual provider. They are buffered until final citation validation and persistence acknowledgment, then forwarded; no fabricated typing/timed stream is generated. Intermediate tool-preface text is not released as a grounded final answer. Core non-research streaming behavior remains covered by the original tests.

## Verified — Tavily

`pnpm verify:tavily --live --authorized-key-use` passed at **15:53:37 Cairo**, making exactly **one** basic travel search with two results. Authentication and typed response parsing succeeded. Actual sources were:

- [JNTO official tourism guide](https://www.japan.travel/en/ca).
- [JNTO brochures and guides](https://www.japan.travel/en/au/plan/brochures).

Both publication estimates were **null**. The response retained the actual retrieval timestamp, without inventing a publisher date or claiming freshness from retrieval alone. [Captured probe evidence](TAVILY_LIVE_EVIDENCE_2026-11-05.json).

The user explicitly authorized temporary use of the currently configured key despite its prior screenshot exposure. No rotation or old-key revocation is claimed. No credential, sensitive header or customer content was printed. No paid service, upgrade or unlimited retry was enabled.

## Verified — live agent attempts and exact limits

Two distinct attempts are recorded; neither is being represented as a fully passing dialogue.

**Initial attempt:** [captured result](M3_LIVE_ATTEMPT_1_2026-11-05.json).

1. `research_destination` → **ok**; actual Tavily search.
2. `build_itinerary` → **ok**; source IDs validated from that run.
3. First case completed; Arabic-script and actual-source citation checks passed.
4. `compare_travel_options` → **rejected / INVALID_TOOL_ARGUMENTS** in the budget follow-up.
5. Evaluation stopped at **1/2 cases passed**, one search. No invalid comparison was executed. The original harness did not retain the answer or field-level rejection details, so the exact rejected live field cannot be reconstructed and is not guessed here.

**After explicit user approval, exactly one bounded recheck:** [actual failure artifact](M3_LIVE_EVIDENCE_2026-11-05.json).

1. `research_destination` → **ok**.
2. `build_itinerary` → **ok**.
3. Model routing returned **PROVIDER_QUOTA** before a completed final response in case `M3-LIVE-001`.
4. **One** basic Tavily search was made, below the hard dialogue cap of two. The budget follow-up was **not reached**. No invalid-tool proposal occurred in this recheck, and `feedbackDelivered` is correctly empty.
5. Live calls stopped. There was no additional retry, OpenRouter call, Supabase operation or fabricated replacement answer. No completed case is claimed in the recheck.

The earlier comparison rejection exposed an orchestration-observability weakness: the model received a generic rejection without field-level repair guidance. The local fix now supplies only schema paths/error categories/types, preserves strict rejection and permits **one** correction before terminating further invalid proposals. Offline tests verify that this actual feedback is present in the next model input, a corrected proposal executes, and a second invalid proposal ends the run without a successful answer/history mutation.

The approved recheck failed due to **provider quota**, not another observed schema error. It therefore did **not** verify live comparison recovery. The financial evaluator explicitly checks EGP, two travellers, two days, option totals **200000 / 300000** and total budget **250000** minor units; those checks must pass before a live comparison is accepted. They were not silently relaxed. No claim is made about which model quota dimension was exhausted; no extra diagnostics or sensitive headers were logged after the failure.

`lastHttp:200` in the artifact describes the successful local SSE transport, not the upstream generation result. The terminal run failure was `PROVIDER_QUOTA`. No original comparison-field mismatch can be inferred from this later quota failure; the instrumented follow-up was never reached.

All live M3 evaluation servers used **ephemeral persistence**, `ENABLE_OPENROUTER_RUNTIME=false`, same-provider retries 0 and the real Gemini/Groq adapters. The evaluator's observed tool wrapper only records actual outcomes; it does not replace results. No new Supabase SQL, migration or cloud data mutation was executed during M3.

## Verified — offline checks

Final observed commands:

- `pnpm build`: both workspace packages compiled.
- `pnpm typecheck`: strict contracts/API/tests/tools passed. An intermediate tooling optional-field type error was corrected by omitting undefined optional fields; strict compiler options were retained.
- `pnpm lint`: passed, 60 files checked.
- `pnpm test`: **130/130 passed in 13 files**, preserving all original 89 and adding 41 dedicated tests.
- `pwsh -NoProfile -File tests/configure-cloud.test.ps1`: PASS; fixture-only checks for ACL, key preservation, target binding and selected runtime policy. Tests do not alter real `.env`.
- `pnpm eval:inventory`: 61 original desired scenarios inventoried; **zero** executions by that inventory command. These are not added to live pass counts.

Coverage includes real protocol serialization with test-only HTTP transport fixtures, 401/403/quota/outage/timeout/malformed/oversized responses, unsafe URLs and spoofed authority domains, source ownership, consent-side-effect denial, source cache/rate budgets, official-source filtering, unavailable company catalog, estimated arithmetic, unfilled itinerary days, malicious source text, citation rejection, bounded argument repair and off-topic conversation. Mocked provider tests are not live quality evidence.

## Acceptance and blockers

| M3 criterion | Status |
|---|---|
| Actual authenticated search + attribution/freshness fields | PASS |
| Backend tools connected to the real agent loop | IMPLEMENTED; actual destination research and planning executed live |
| Estimate arithmetic and validation/error/ownership controls | PASS offline |
| Complete two-case live research + budget-follow-up evaluation | **NOT PASSED**; initial schema rejection, bounded recheck blocked before follow-up by model quota |
| Approved live company catalog and catalog comparison | **UNAVAILABLE**; no real business records/approved catalog schema supplied |
| Broad official-country coverage and verified route feasibility | Initial limited source policy; broader coverage and route validation remain |
| Comprehensive factual/dialect quality evaluation | Not claimed; live checks are structural, not a quality percentage |

**Full M3 acceptance is not satisfied.** Stop live calls until the user resumes after provider allowance is available. Next remains M3: finish the budget-follow-up live proof, then approved company catalog integration, broader official-source coverage and planning-quality evaluation. Do not advance to premium 3D frontend, CRM or business automation.
