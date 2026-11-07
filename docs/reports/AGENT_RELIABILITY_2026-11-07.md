# Multi-turn agent reliability — 2026-11-07

Implemented locally and verified offline. No live Gemini/Groq/Tavily requests, Supabase operations, migrations, Auth changes, credential edits, browser speech synthesis or UI redesign occurred. Gemini remains primary, Groq fallback, OpenRouter disabled. The configured routing was checked without printing configuration values or secrets.

## Confirmed causes

1. **Context admission measured the wrong thing.** Runtime checks covered messages, but excluded the system prompt/tool schemas; saved context was inserted after initial trimming. A successful tool could push the next request past the context check. The router separately counted provider-native Gemini signatures against Groq even though Groq never receives them. It also rejected text-only providers even when tools were disabled. These paths explain tools completing before context/fallback failure.
2. **Token admission happened too late and reserved no final response.** Repeated input-token charges, tool results and output consumed the balance before the next generation. The prior partial patch kept complete final text but could pass zero/negative output limits to a later request. Model/turn/context/token/round/call exhaustion were collapsed into TURN_BUDGET with little useful diagnosis.
3. **The loop boundaries and correction protocol were inconsistent.** The patched loop allowed extra iterations while its guard depended on answerOnly already being set. Breaking out of a parallel tool batch after clarification or the second rejection left assistant tool calls without matching results, which compatible providers can reject. Repeated equivalent calls with new IDs were not bounded by semantic deduplication.
4. **Internal errors masqueraded as upstream 503.** SafeError.status defaults to the application's HTTP 503. providerError treated that local status as a real upstream status, so a truncated/invalid model result could become INVALID_MODEL_RESPONSE(503). The router then incorrectly treated that diagnostic combination as a temporary service failure. Genuine SDK 503s are mapped to PROVIDER_UNAVAILABLE; internal invalid responses now retain upstreamStatus:null. The installed @google/genai 2.32.0 source confirms SDK ApiError.status is the actual HTTP status. [Google error reference](https://ai.google.dev/gemini-api/docs/api-errors), [Groq error reference](https://console.groq.com/docs/errors).
5. **Successful research was run-scoped only.** A following provider failure left the sources on the failed run but discarded their reusable search cache. Retrying the conversation could repeat a paid search. The old runtime also supplied no streaming callback, so the streaming flag did not activate the adapter's streaming transport.
6. **Temporary diagnostics exposed generated text.** Development logging printed an answer excerpt. Removed it and the scattered debug logs; operational failures now contain categories, budget reasons and counters only.

Live historical incident frequency, current provider health/quota and the exact upstream response that triggered the user's incident were not reproduced with real APIs. In particular, the old log INVALID_MODEL_RESPONSE(503) alone cannot prove a genuine upstream outage.

## Changes

- Explicit maximum N tool-producing rounds, one final response and one safety rewrite. No execution of a tool proposed in final-answer mode. An over-limit or deferred parallel call receives a truthful NOT-executed result, keeping the provider protocol complete.
- Shared input admission includes portable system text, schemas, protocol overhead and UTF-8 content. Provider-native metadata remains intact but is measured only in the relevant provider's projection; it cannot block Groq before routing removes foreign Gemini signatures. Each actual provider projection still has a context-size guard. Only known message metadata is projected: tool-data fields named native or attachments still count fully. Current user input, most recent exchange, structured confirmed facts, exact numeric/currency fields and URLs/source IDs remain intact. Older verbose answers/source excerpts are compacted on copies; omitted history is identified. Stored history is not pruned by model-context preparation.
- Reserve final-response time, estimated input capacity and output capacity before planning another tool step. Output limits are strictly positive. Preserve a completed, grounded, validated answer even when its reported usage consumes the balance. Incomplete/truncated provider output still fails validation.
- Keep strict Zod/evidence/financial checks. One complete correction is allowed; after the second rejection, use a tools-off natural clarification or general answer. If the model ignores that restriction, fail safely, release the conversation and allow the next unrelated turn.
- Reuse equivalent completed read results; stop repeated tool loops. Short-lived public research caches are scoped to the same authenticated owner/conversation, capped at 24 retained sources/eight successful search entries, expire after ten minutes and retain original retrieval dates. Failed turns do not commit proposed travel changes. Cross-owner/conversation reuse is denied. Logout and memory/consent privacy changes clear the cache; canceled in-flight turns cannot recreate it or claim that their research will be reused. This cache is process-local, not long-term memory.
- Provider retries are limited to configured transient-error attempts and stage deadlines. Quota/auth errors are not retried; circuit cooldowns remain bounded. Timeout fallback starts immediately when an eligible alternative exists. Provider skips expose only safe reasons: context capacity, attachment/tool capability or cooldown.
- Provider-specific context projection strips foreign native signatures. A single tools-off recovery may use an eligible provider skipped earlier for tools/context limits, while excluding every provider already attempted. It does not rerun research. Actual transport chunks are buffered privately; failed/late partial streams are discarded before fallback, validation and commit. Public partial-output callers still cannot mix providers.
- Distinguish turn_timeout, context_capacity, token_capacity, tool_rounds and tool_calls in the authenticated run snapshot. Individual model deadlines remain PROVIDER_TIMEOUT; user cancellation remains CANCELED. The evaluation-only request cap still intentionally throws TURN_BUDGET and cannot be bypassed by fallback.
- Restore the 64 KB default JSON body limit caught by the full-suite security regression. Existing attachment and voice routes retain their explicit bounded larger allowances.
- Add defensive proxy headroom above the API's maximum allowed turn and SSE close grace. Agent/model/token/tool limits and environment values were not increased or edited. Next's timeout is an inactivity timeout and SSE heartbeats already help; this alignment is not claimed as the proven cause of the reported incident.

## TURN_BUDGET inventory

The original runtime contained throws/checks for: overall abort/deadline; oversized messages; cumulative tokens after tool output; tool rounds/calls; and loop fallthrough after the last repair. The initial loop guard was partly redundant once answerOnly was set. These now use named admission/boundary reasons and a final-response phase. The separate explicit live-evaluation request guard in `apps/api/src/evals/travel.ts` remains unchanged. No other application TURN_BUDGET creation path was found.

## Files modified

Production:

- `apps/api/src/agent/runtime.ts`
- `apps/api/src/agent/context.ts` (new)
- `apps/api/src/agent/budget.ts` (new)
- `apps/api/src/agent/prompt.ts`
- `apps/api/src/providers/router.ts`
- `apps/api/src/providers/compatible.ts`
- `apps/api/src/errors.ts`
- `apps/api/src/research/scope.ts`
- `apps/api/src/research/travel.ts`
- `apps/api/src/research/grounding.ts`
- `apps/api/src/state.ts`
- `apps/api/src/server.ts`
- `apps/web/next.config.ts` (transport only)

Tests:

- `tests/agent-reliability.test.ts` (new, 28 cases)
- `tests/persistence-api.test.ts` (one new fifteen-turn authenticated SQL/SSE integration case)
- `tests/runtime.test.ts` (retry test now exercises transient unavailability; separate regression forbids quota retries; impossible-budget test explicitly checks preflight rejection)

This report is the only added documentation. No changes to config.ts, travel/decision.ts, credentials, dependencies, SQL or visual components were needed.

## Actual verification

The pnpm launcher stalled even for its version command. Its two stalled invocations were stopped; no installation or alternate package manager was used. Verification ran the already installed, pinned CLI binaries directly with Node 24.14.1.

From project root:

```powershell
node node_modules/vitest/vitest.mjs run --maxWorkers=1
node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.tests.json --noEmit
```

- **Final full suite: 410/410 passed, 33/33 files, 74.48 seconds**, started 03:18:07 Africa/Cairo on 2026-11-07. All current existing cases retained, 29 new cases added. Network is blocked by the deterministic test setup. This final run includes the privacy-cancellation and runtime-native-metadata regressions.
- **Contracts/API compilation and all strict typechecks passed.**
- **Next production build passed**, using `node node_modules/next/dist/bin/next build` from `apps/web`; four static pages generated. The initial attempt used a root-relative Next executable that is not hoisted; the corrected workspace-local command succeeded.
- **Changed-file Biome check passed: 16 source/test files, no fixes needed in the final check.**
- **Repository-wide Biome check failed** only on pre-existing formatting in untouched `apps/web/app/shell.css`, `apps/web/components/voice-panel.tsx`, `apps/web/components/workspace.tsx`. They were not reformatted as part of this backend task. The edited Next transport config is formatted.
- The first full run found the pre-existing default-body-limit regression (404 passed, one failed); it was fixed without weakening the request-security test. A transiently misplaced error-message edit was caught by targeted tests, corrected, and included in the passing final run. No failing regression was deleted to obtain that result.

Coverage includes fifteen-turn state and authenticated PostgreSQL/SSE/persistence flows; hotel/general follow-ups; confirmed budgets/traveller counts; large context; research success then provider failure; genuine-shaped SDK 503; Groq fallback; context-ineligible fallback final recovery; opaque native metadata at runtime admission; retries/circuits; two rejected proposals and complete parallel protocols; manual cancellation/turn/provider deadlines; near-limit final answers; oversized request privacy; source/currency integrity; cache expiry/isolation and privacy invalidation; and no sensitive development logging.

## Remaining boundaries and readiness

**Ready for a separately approved bounded live acceptance check; not declared deployment-ready.** No live provider/model-language quality, current quota or production deployment was verified. The existing production startup guard and previously unresolved Cloud/privacy acceptance gates remain unchanged; this task does not clear them.

Input-token admission is a conservative byte-based estimate, not an exact provider tokenizer or billing measurement. Actual returned usage is kept separately. Failed upstream attempts may not report usage; retry counts and elapsed-time/output limits still bound them. Multimodal token costs depend on the provider. A genuinely impossible input, exhausted deadline, unsafe answer or unavailable providers can still yield a clear failure rather than a fabricated response.

Research reuse survives subsequent turns and local state restoration within the same process, not process restarts. Model context is bounded and can omit old text with an explicit note; persistent SQL remains the history source, with its existing recent-message/extractive-summary window unchanged. Do not claim unlimited model memory or newly verified live prices/availability.

No approval is needed for these completed local fixes. New live calls or deployment require their own explicit authorization; none was requested or executed here.
