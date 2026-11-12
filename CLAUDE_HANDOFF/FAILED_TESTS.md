# Failed-test record

Final verification is recorded in QA_RESULTS.md. Do not treat this file as proof of passes before that report is populated.

During development, targeted tests caught and fixed:

- The previous two tests expected a dead-end after the correction bound. They now assert two tool attempts followed by at most one text-only clarification; an ignored no-tools restriction still fails closed.
- CRM explicit-review consent, normalized contact deduplication, profile revision concurrency and shared-fixture cleanup issues.
- Frontend DELETE requests carrying JSON content type with no body, which caused Fastify 400 responses on CRM/memory deletion and logout; removed that header for empty requests and handled HTTP 204 explicitly.
- Browser accessible-name selectors that omitted spacing around icons; corrected selectors rather than weakening product behavior.
- Windows child-tree cleanup was denied. The QA runner now serves production Next in a single owned process and terminates only its directly spawned test services; no process enumeration or unrelated task termination.
- The existing migration-ledger test expected four root migrations. It now explicitly verifies five migrations and all fifteen FORCE RLS tables, preserving its original eleven-table security contract plus the four new CRM tables.
- The closed mobile navigation could receive keyboard focus. It is now hidden from focus/accessibility while closed, with a browser regression check.
- Light-theme button contrast and screenshot timing were corrected. The test waits for the 200 ms theme transition to settle and still requires a minimum 4.5:1 text contrast ratio for every settings action.

Live failure remains a distinct non-pass even when deterministic tests pass; see LIVE_PROVIDER_VERIFICATION.md.
