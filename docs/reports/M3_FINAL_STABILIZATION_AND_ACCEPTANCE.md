# M3 final acceptance — Arabic grounding fix, 2026-11-06

## Current delivery scope update

The later owner instruction authorizes independent local M3–M6 implementation. M4/voice/frontend local work is now implemented; earlier “M4 closed” statements below are historical and superseded. M3 external live/session acceptance remains open. New production runtime uses action-specific ASK/ACT/ANSWER, aggregates proposal issues before one correction and allows a final no-tools conversational clarification instead of an automatic validation dead end. Unknown ages/flight scope remain optional for planning; shared-budget intent requires confirmation for financial comparisons. The captured failed proposals are replayed offline. No further live provider or Supabase call was made. See `CLAUDE_HANDOFF/QA_RESULTS.md` for final consolidated verification and `KNOWN_ISSUES.md` for genuine limits. There is no automation milestone.

**Current decision: the local M3 fix and independent M4–M6 implementation are available for review. M3 acceptance remains open pending the authorized live recheck and controlled Cloud claim/expiry verification. CRM Cloud deployment and live voice/device acceptance also remain open. See the consolidated handoff for final local results.**

## Approved live recheck — executed, FAILED

Evidence: [M3_ARABIC_LIVE_RECHECK_8b235d30-a40a-474f-a069-56707348fbde.json](M3_ARABIC_LIVE_RECHECK_8b235d30-a40a-474f-a069-56707348fbde.json).

One approved run used the exact requested dialogue with transparently seeded synthetic confirmed EGP, ephemeral state and the ten-generation/one-basic-search caps. The initial user turn made **two real Gemini generations**, both successful at provider level. No quota/authentication failure occurred. **Groq 0, OpenRouter 0, Tavily 0, Supabase access/writes 0**. The later budget and traveler follow-ups were not reached; no final answer or constraint commit occurred. The previous failed live evidence was preserved, and no retry evaluation ran.

Actual sequence:
1. Gemini proposed correct destination, five days, two travelers and 3,000,000 EGP minor units, plus an unsupported `adults: 2` assumption from `شخصين`. Strict grounding rejected field `adults` with `CONSTRAINT_VALUE_NOT_EXPLICIT`.
2. The field-specific feedback reached Gemini. Its one correction removed `adults` but still proposed `budgetBasis: party_total` without any evidence entry for that field. It was rejected with `CURRENT_USER_EVIDENCE_REQUIRED` for `budgetBasis`. The existing correction bound terminated the run as `INVALID_MODEL_RESPONSE`; the outer evaluation classified the failed run as `EVALUATION_FAILURE`.

The real argument trace now identifies both failures. Offline replay reproduced both exact rejections and unchanged state; adding the genuine current-user quote `ميزانيتنا` to the second proposal passed all initial constraints, without an adults assumption. This counterfactual is **offline evidence**, not a successful live completion. The Arabic dual/magnitude path progressed; the remaining observed problem is incomplete grounded proposals across the single correction, rather than provider quota. No production code was changed during this execution; the **309/309** baseline and build/typecheck/lint results below are reused, not rerun. The approved live attempt is consumed; further calls require a separately authorized run after addressing this exact tool-proposal issue. Controlled Cloud claim/expiry verification remains blocked as documented below. **M3 is not fully accepted; M4 remains closed.**

## Exact defect and implementation

The old validator compared numeric literals and a short number-word list. It could not compose magnitudes (`30 ألف`), recognize dual quantities (`شخصين`, `يومين`), or distinguish budget intent from budget basis. Currency matching accepted only ISO codes or a few fully qualified names. Conflict feedback lacked the affected field. The historical live trace proves two rejected proposals and feedback delivery; it did not retain argument values, so the tests replay the exact dialogue with representative valid proposals rather than claiming byte-for-byte recovery of Gemini's arguments.

Changed production files: `apps/api/src/travel/grounding.ts`, `apps/api/src/travel/context.ts`, `apps/api/src/tools/registry.ts`, `apps/api/src/agent/runtime.ts`. Regression file: `tests/arabic-grounding.test.ts`.

- Normalize Arabic/Persian/Western digits, diacritics, number words, duals, thousands/millions and supported additive combinations. Keep strict numeric bounds and Zod tool schemas.
- Ground values in exact original user spans with offsets and normalized values. Distinguish confirmed context from values staged in this turn. Tool results retain that evidence; normal durable tool traces can preserve it without a database migration.
- Enforce field/unit compatibility, major/minor units, magnitude boundaries, replacement direction and negation, including cropped evidence. Reject fabricated spans, unsupported values, extra fields and silent currency conversions.
- `ميزانيتنا` grounds a party budget. `ميزانيتي`, `معايا`, and `في حدود` ground budget amounts without automatically establishing a group-total basis. Preserve unchanged dates, duration, destination, party size and money.
- Bare `جنيه`/`دولار` requires confirmed currency or sufficient explicit context. Egyptian dialect/locale alone does not prove EGP. Ambiguity produces `CURRENCY_AMBIGUOUS`, a field name and a clarification instruction without echoing proposed values. One correction remains the maximum.

## Offline verification

New Arabic regressions: **69/69 PASS**. Targeted real agent-loop replay passes: five days/two travelers/EGP 30,000 → EGP 20,000 with other facts preserved → three travelers with party budget unchanged, including retained dates and one observed correction. EGP is explicitly confirmed in that synthetic fixture; the same opening without currency context correctly requests clarification. Existing bounded repeated-failure tests remain intact. Scripted model outputs are test fixtures, not live model evidence.

Final gates after the last code change: **309/309 tests PASS in 23/23 files**, including every previous 240 test and 69 new regressions. `pnpm test --maxWorkers=1` completed in 49.90 seconds, started 01:05:39 Africa/Cairo. `pnpm build`, `pnpm typecheck`, and `pnpm lint` all passed (81 linted files, no fixes). The earlier full run passed 308/308; one final cropped-negation correction and regression justified the final rerun above. No Gemini/Groq/Tavily/OpenRouter calls or Supabase changes occurred during this fix.

## Only mandatory acceptance checks still open

1. A successful live dialogue remains mandatory. The latest approved attempt above failed and its authorization is consumed. A future separately approved bounded live dialogue recheck: exact requested three messages with transparently confirmed synthetic EGP context, Gemini primary/Groq fallback, at most ten actual generations and one basic Tavily search, zero same-provider retries, no OpenRouter/Supabase. Stop on the first quota failure or unrecovered error. Without confirmed currency, the expected safe behavior is clarification, not silently assuming EGP.
2. Controlled Cloud session-claim/expiry fixture and safe deletion through supported Auth administration. Public Auth connectivity was previously HTTP 200, but this workspace has no administrator cleanup credential or working privileged claim-probe channel. No new user, production credential request, Auth-row mutation or audit repetition is authorized or needed here.

The owner-confirmed migration deployment/history entry, seven Cloud contract checks, core two-user checks and deletion of guest B remain closed. Authoritative company programs remain a business-content dependency; never invent offers or inventory. No M4/CRM/frontend/voice/automation work started.
