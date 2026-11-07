# M3 hardening: local operation and pending live gate

The catalog/context schema is [applied and database-verified](reports/M3_CLOUD_APPLICATION_2026-11-05.md). The three Cloud feature flags are enabled; demo access remains false. Real company records are not yet supplied. Temporary automated Cloud test fixtures were removed; application code never imports fixtures. Live model/search acceptance remains paused.

## Local development

Use a **local** development configuration: `PERSISTENCE_MODE=local`, `LOCAL_DATABASE_PATH=.private/postgres`, `ENABLE_COMPANY_CATALOG=true`, `ENABLE_TRAVEL_CONTEXT=true`, `ENABLE_TRAVEL_CONTEXT_PERSISTENCE=true`, `ALLOW_CATALOG_DEMO=false`. Local startup applies all three root migrations with checksum tracking. This cannot apply hosted SQL. Keep external integrations off while doing offline development. A local guest session remains development-only and accepts public nonsensitive test inputs.

An operator can add new approved records without changing agent code:

```powershell
pnpm build
pnpm catalog:import --local --file .private/approved-company-packages.json
```

Input is an array matching `CompanyPackage` in `packages/contracts/src/company.ts`. Fill authoritative values only; use null for unknown description/price/nights and empty departures/activities if absent. Published non-demo records require nonempty approval sourceRef + ISO verifiedAt; known non-demo prices require currency, basis and price verifiedAt. A party-total price also requires the exact priced party size. Dates never imply available seats. `isDemo=true` imports are rejected: fixtures are automated-test data only. Imports are insertion-only and transactional; duplicate IDs/codes fail without overwriting existing records. CLI uses only embedded PostgreSQL and never a hosted client. In Cloud, operator data entry remains a separately scoped administrative action after schema approval; no admin UI or write tool is exposed to the model.

`search_company_packages` reads filtered published database records and ranks known within-budget options. Search reads at most 20 candidates and returns at most six; it is not an exhaustive catalog export. Currency is preserved, no FX is attempted, and per-adult prices do not imply child or whole-party costs. `cheaperThanOption` compares a specific prior option only when comparable party totals are known. It does not invent a lower budget. `get_company_package` returns actual details/schedules; `compare_company_packages` resolves exact IDs or stored 1-based ordinal options. Classifications remain company_verified/company_demo, external_listing, and estimated_itinerary; there is no supplier-live inventory integration.

## Context, privacy and recovery

With `ENABLE_TRAVEL_CONTEXT=true`, the real model loop receives bounded structured constraints and ordered catalog references. `propose_travel_constraints` stages an explicit patch backed by a quote from the current user's message. It does not write the database. Numeric evidence supports Arabic/Persian digits, common small Arabic number words, major currency units and explicitly identified minor units. This is a conservative validation boundary, not a full Arabic semantic parser. It rejects missing evidence, invented amounts, silent currency switches and excluded destinations. General phrases such as “أقل” do not establish a numeric budget; the model should ask one clarification. Only changed fields are patched; money/party size are not defaulted. An existing adult count is retained after a traveler-count change, so mixed/unknown composition has unknown party pricing pending clarification. Destination/day/exclusion changes invalidate stale ordinal choices.

Every tool retains strict Zod parsing. Invalid schema calls return bounded field paths/codes/types without values. Confirmed-constraint conflicts return field names or an allowlisted reason, never customer contents. The model gets one correction attempt per tool inside the existing round/call/time/token caps. A second rejection fails safely with a natural limitation event, no fabricated result. Provider quota events use a safe operational message. These failures do not become successful assistant messages.

Drafts commit only with a successful final response. Failure or failed durable acknowledgment leaves confirmed context/history unchanged. Local/approved hosted persistence commits constraints, messages and actual tool metadata atomically with optimistic version checks. A profile belongs only to its conversation and is erased by its deletion; it is not cross-conversation long-term memory and does not grant memory consent. With context enabled but durable-context persistence disabled, structured context is process/session-only; health reports this explicitly. Existing consent-scoped memory APIs are unchanged.

New owned run snapshots expose allowlisted provider/model/operation/status/failure timestamp and quota scope (unknown without evidence). Raw headers, bodies, prompts and credentials are not retained in failure diagnostics. Context snapshots are owner-only, process-local and absent from metadata-only durable tool traces. Actual usage on failed calls may be incomplete.

## Future live acceptance — DO NOT RUN YET

Relevant provider quota must first be confirmed available, then the user must explicitly approve one bounded run. No new provider request is a quota probe while this pause is active. Keep Gemini primary, verified Groq fallback, OpenRouter disabled, same-provider retries zero. Hosted persistence is forcibly off in this evaluation.

After those two conditions only:

```powershell
pnpm build
pnpm eval:travel --live --public-test-data --quota-ready-confirmed --approved-run
```

The three-case catalog in `tests/evals/m3.scenarios.jsonl` establishes Kyoto / two days / two travelers / total 300000 EGP minor units and researches/plans using actual sources. The second turn changes only budget to 250000 and compares user-supplied party-total estimates of 200000/300000. The third changes travelers to three while preserving currency, days, destination, budget and the explicitly reaffirmed party totals; no implicit rescaling or FX. Follow-ups must not search again. Global limits: **two basic searches** and **twelve actual model-adapter requests across both providers**, no same-provider retry. Each of the maximum three turns has five tool rounds, four tool calls, 24k tokens and a 120s deadline. Stop at the first failed run. These updated limits require a new explicit live approval after quota availability; no approval is inferred from older two-case runs.

The harness observes actual proposals/results, schema/constraint feedback and delivery to the model. It checks structured context and exact figures, records actual adapter attempts and saves `docs/reports/M3_HARDENING_LIVE_EVIDENCE.json` separately from history. Genuine correction and provider failure are **NOT_OBSERVED** when they do not occur. Natural usefulness requires reviewing actual Egyptian Arabic answers; script detection is insufficient. Offline fixtures test correction and safe quota failures separately. No fake tool result or deliberate live outage is injected. A controlled recovery challenge needs separate approval; a structural pass alone is not full M3 acceptance.

Security audit, unapplied session/index proposals and current read-only evidence are in [the audit report](reports/M3_SECURITY_AUDIT_2026-11-05.md). Authoritative company data preparation is in [the ingestion workflow](COMPANY_CATALOG_INGESTION.md); `pnpm catalog:validate` does no database/network work.
