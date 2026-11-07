# M3 security audit and final-acceptance preparation

Historical audit at the 191-test checkpoint. The format-only session proposal and its old read-policy/recursion recommendation below are superseded by the locally prepared Auth-session validator in [the current change plan](../M3_SECURITY_CHANGE_PLAN.md) and [local verification report](SESSION_SECURITY_LOCAL_VERIFICATION_2026-11-05.md). The new private definer avoids that recursion without granting client access to Auth tables. Historical observations remain evidence of the unchanged Cloud baseline; this note does not mean any proposed SQL has been applied.

2026-11-05, Africa/Cairo. **Remote inspection only; no Cloud data/schema/policy/grant/Auth-setting changes. Zero live model/search requests.** Project identity reverified: Sadeeman `ujdzysbowngtkwndgoqf`, ACTIVE_HEALTHY, PostgreSQL 17.11, eu-west-1. Organization plan is actually **Free**. Three applied migration sources and their hashes are unchanged. Evidence: [read-only audit snapshot](M3_SECURITY_AUDIT_EVIDENCE_2026-11-05.json).

## 1. All twelve security warnings, individually classified

Current advisors: **12 WARN, 0 ERROR**. Eleven are `auth_allow_anonymous_sign_ins`; the twelfth is `auth_leaked_password_protection`. Warning severity is Supabase's classification, not a blanket assertion that access is either safe or exploitable.

An unauthenticated request uses Postgres **anon**; an anonymous **Auth account** has a signed JWT, user UUID and the **authenticated** role. Both ordinary registered users and Auth guests are subject to RLS. Actual roles anon/authenticated have no superuser or BYPASSRLS; service_role does bypass RLS and is not used by this backend. All eleven application tables enable and force RLS. Public/anon have no application-table grants or public application-RPC execution.

For the table below, “no cross-owner path found” means current SQL/ACL inspection plus prior actual two-user Cloud tests support isolation. This read-only audit did not mint tokens, write records or perform a new Cloud exploit test. It is not proof that every possible attack is impossible. The two additional session findings below qualify every policy using session_active().

| # | Exact warning code | Affected object/policy | Severity, intent and impact | Unauthorized-access assessment | Recommended remediation / change type |
|---|---|---|---|---|---|
| 1 | `auth_allow_anonymous_sign_ins` | `public.sadeeman_audit_events` / `own_rows` | WARN; intentional guest access to own metadata-only history | SELECT only, owner/tenant/session predicates; caller cannot insert/update/delete audit rows; no cross-owner path found | Retain owner isolation and read-only grant. Review guest access before public launch; no mandatory migration to suppress warning |
| 2 | `auth_allow_anonymous_sign_ins` | `public.sadeeman_company_packages` / `readable_company_catalog` | WARN; intentional shared published company-program reads for authenticated guests | Published non-demo programs are deliberately shared, not customer-private. Draft/demo hiding uses trusted app_metadata; customer catalog writes denied | Keep shared visibility and no customer writes. Do not publish confidential material. Equivalent RLS performance change proposed; no broader access |
| 3 | `auth_allow_anonymous_sign_ins` | `public.sadeeman_consents` / `own_rows` | WARN; intentional owner-managed consent for guest development accounts | Owner/tenant/session + immutable-consent trigger; no cross-owner path found. Owners can grant their own consent, not another user's | Preserve ownership/immutability. Registered-only persistent preferences would require a separately chosen product policy/migration |
| 4 | `auth_allow_anonymous_sign_ins` | `public.sadeeman_conversations` / `own_rows` | WARN; intentional private guest conversations | Owner/tenant/session and personal-tenant constraints; no cross-owner path found | Keep RLS; address direct-API storage abuse and guest signup controls before public exposure, not by adding broad grants |
| 5 | `auth_allow_anonymous_sign_ins` | `public.sadeeman_memories` / `own_memories` | WARN; intentional consent-scoped guest preferences | Owner/tenant/session + unexpired record + active accepted owner consent; guard_memory and owner-scoped forget helper; no cross-owner path found | Keep all predicates, expiry and revocation. Do not exempt guests from consent or grant a bypass role |
| 6 | `auth_allow_anonymous_sign_ins` | `public.sadeeman_messages` / `own_rows` | WARN; intentional own guest message history | Owner/tenant/session and composite conversation/turn ownership FKs; no cross-owner path found | Retain composite ownership. Direct owner CRUD is not server-attested message integrity; review that separate trust boundary before production |
| 7 | `auth_allow_anonymous_sign_ins` | `public.sadeeman_requests` / `own_rows` | WARN; intentional own idempotency metadata | Owner/tenant/session; no cross-owner read found. Owner CRUD means these records cannot alone establish untamperable billing/exactly-once provider usage | Keep isolation; future server-only metering/write design needs a separate reviewed migration, not a cosmetic warning fix |
| 8 | `auth_allow_anonymous_sign_ins` | `public.sadeeman_session_revocations` / `own_sessions` | WARN; own SELECT/INSERT is needed for logout; conditional logout-integrity weakness found | Owner isolation prevents reading others' revocations. Existing INSERT does not bind UUID to current session; see reproduced finding S2 | Proposed migration narrows INSERT to current session UUID. Keep own SELECT visible after revocation; adding session_active here would recurse/hide revocations |
| 9 | `auth_allow_anonymous_sign_ins` | `public.sadeeman_tool_executions` / `own_tool_records` | WARN; intentional own execution metadata, SELECT/INSERT only | Owner/tenant/session; no cross-owner path found. A bearer-token holder can insert their own metadata directly; it is not a tamper-proof server audit ledger | Preserve isolation. Do not use caller-writable traces as authoritative billing/compliance evidence; future attested server writes need separate design |
| 10 | `auth_allow_anonymous_sign_ins` | `public.sadeeman_travel_profiles` / `own_travel_profile` | WARN; intentional private per-conversation guest constraints | Owner/tenant/session and composite conversation FK; SELECT/INSERT/UPDATE only. Own direct updates can bypass RPC version semantics, not owner isolation | Retain RLS/versioned RPC path and treat context as untrusted user data. Stronger server-only write semantics are a separate production change |
| 11 | `auth_allow_anonymous_sign_ins` | `public.sadeeman_turns` / `own_rows` | WARN; intentional own guest turns | Owner/tenant/session + owned conversation; no cross-owner path found. Own direct writes are not trusted usage accounting | Keep isolation; production metering/capacity must not rely solely on caller-owned data or backend-only rate limits |
| 12 | `auth_leaked_password_protection` | Supabase Auth password configuration, not a table policy | WARN; disabled and unavailable on the project's Free plan, not a selected paid protection | Current aggregate: six anonymous users, **zero password-bearing accounts**. Immediate existing-password exposure is low; future reused-password/credential-stuffing risk remains | No paid upgrade. Prepare Free password-strength/confirmation/reauthentication/CAPTCHA controls; Auth configuration requires approval. Free controls are not equivalent to breached-password detection |

Remediation references: [anonymous-access advisor](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0012_auth_allow_anonymous_sign_ins), [anonymous identities and RLS](https://supabase.com/docs/guides/auth/auth-anonymous), [password security](https://supabase.com/docs/guides/auth/password-security).

## 2. Function audit and additional findings

All **nine public application functions** are SECURITY INVOKER, have empty search_path, allow authenticated execution and deny anon execution: catalog, commit_travel_turn, commit_turn, list_tool_executions, memory_json, operation, save_tool_executions, session_active and travel_profile. Invoker execution retains caller RLS; function ownership by postgres is not a privilege escalation when invoker mode is used.

Private helpers were also inspected:

- `record_audit()` is SECURITY DEFINER, owner-checks auth.uid(), accepts no ordinary caller parameters and writes metadata only. PUBLIC/anon/authenticated EXECUTE is denied. Trigger-only use remains narrow.
- `forget_memory(uuid,uuid,boolean)` is SECURITY DEFINER and authenticated-executable in the private schema. It requires uid and active session, serializes owner operations and restricts deletion to that uid/tenant; caller IDs/p_all cannot erase another user's memory. This is an intentional privacy-erasure bypass of expired/revoked-row SELECT hiding, not a general data-read bypass. Private-schema non-exposure is intended, but was not independently confirmed in this audit: the database settings did not expose a pgrst.db_schemas value, and one read-only REST exposure probe failed without a usable classification. It was not retried. Verify the dashboard's exposed-schema list before public rollout; owner checks must remain effective even if a schema is exposed accidentally.
- `guard_consent()` and `guard_memory()` are trigger functions with inherited PUBLIC EXECUTE. Anon lacks private-schema USAGE and trigger-returning functions cannot be called as ordinary functions. No direct data leak was found, but revoking unneeded execute grants is sensible defense in depth. Offline tests prove installed consent/memory triggers still work after that revocation.

**S1 — fail-closed session gap (defense in depth):** with a non-null principal and missing session_id, current session_active returns true. Normal modern Supabase JWTs include a session UUID and the backend identity RPC already rejects a missing one, so this does not demonstrate unsigned-JWT forgery or arbitrary-user access. Direct Data API policies still rely on the weaker helper. Local PostgreSQL reproduced it; proposed SQL returns false for missing/empty/malformed session claims. Existing app revocation is not a universal instantaneous Auth-session/JWT revocation service; no Auth-table privileges are widened.

**S2 — conditional session-UUID preemption (medium logout integrity):** an authenticated owner who learns another session UUID can currently insert that UUID into their own revocation row. Its global PK then makes the other session's later `ON CONFLICT DO NOTHING` revocation silently skip. Because RLS hides the attacker's row from the other owner, the other session can remain active. This was reproduced **only in local test data**, then blocked by the proposed WITH CHECK binding insert to the caller's current session UUID. No cross-owner customer data read was demonstrated. Session UUID secrecy must not be the primary fix.

**Other production limits:** direct authenticated REST access can bypass backend route quotas/RPC-only capacity checks for owned mutable rows. Owner-readable/writable state and execution metadata are not tamper-proof metering. Private localhost/public-nonsensitive development remains the approved scope; before public launch, design database-enforced capacity and any trusted server-write boundary without simply granting service-role access. Do not claim that twelve classified warnings establish production readiness.

## 3. Free-plan password/abuse controls

The actual organization plan is Free. Hosted leaked-password detection requires Pro+. Basic MFA is included on Free; phone MFA, single-session enforcement and hosted session timeouts are not. No plan was upgraded or paid feature enabled. [Official plan matrix](https://supabase.com/pricing), [password protection availability](https://supabase.com/docs/guides/auth/password-security).

One read-only public Auth-settings GET returned HTTP 200: email provider enabled, signup not globally disabled, email autoconfirm false and phone autoconfirm false. Non-public minimum password/CAPTCHA/reauthentication settings were **not exposed**, so their current values remain unknown. The connector has no detailed Auth-config tool. The advisor establishes leaked-password protection disabled; no password hash/token/email/customer contents were returned.

Prepared, not applied remotely: minimum 12-character password policy, supported required character classes, reauthentication/current-password checks, retained email confirmation, reviewed anonymous signup limits and real Turnstile protection before public guest access. Turnstile has a documented Free plan; no provider account/widget/key was created. [CAPTCHA integration](https://supabase.com/docs/guides/auth/auth-captcha), [Turnstile Free](https://developers.cloudflare.com/turnstile/plans/). Exact desired settings and approval prerequisites are in the [change plan](../M3_SECURITY_CHANGE_PLAN.md).

Implemented offline now: `/api/v1/auth/guest` is capped at **5 requests/IP/hour** by default (configurable 1–30). Spoofed forwarding headers do not reset the bucket because trustProxy remains false. Optional REQUIRE_GUEST_CAPTCHA rejects absent/blank tokens and forwards supplied tokens to Supabase; it remains off and does not pretend to validate a CAPTCHA itself. These controls are tested, but per-process buckets and token presence cannot secure direct Supabase Auth endpoints or replace configured CAPTCHA. No current `.env` or Auth setting was edited.

## 4. Performance investigation — measured scope and recommendations

The current scan still reports one WARN `auth_rls_initplan`, seven INFO unindexed FKs and two INFO unused indexes. Read-only Cloud EXPLAIN diagnostics used no real customer literals, no ANALYZE and rolled back `enable_seqscan=off`. This intentionally tests whether a path **can** use an index; costs are estimates, not production timings or a claim the optimizer normally chooses that plan on empty tables.

| Flagged foreign key | Actual diagnostic evidence | Recommendation |
|---|---|---|
| memories `(consent_id,owner_id)` | Index Only Scan on existing `(owner_id,consent_id,expires_at)`; both equality keys in Index Cond | Keep; no duplicate FK-order index |
| memories `(source_conversation_id,owner_id)` | Existing index narrows owner only; source_conversation_id remains a filter | Propose source/owner index for targeted source erasure/cascade |
| messages `(conversation_id,owner_id)` | Index Only Scan on existing owner/conversation/id; both equality keys in Index Cond | Keep; no duplicate |
| messages `(turn_id,owner_id,conversation_id)` | Existing index narrows owner/conversation; turn_id remains a filter | Propose turn/owner/conversation index |
| tool executions `(conversation_id,owner_id)` | Index Only Scan on owner/conversation/time; both keys in Index Cond | Keep; no duplicate |
| travel profiles `(conversation_id,owner_id)` | Index Only Scan on owner/conversation; conversation PK also limits to one row | Keep; no duplicate |
| turns `(conversation_id,owner_id)` | Index Only Scan on owner/conversation; both equality keys in Index Cond | Keep; no duplicate |

The FK linter's strict key-order heuristic does not capture all useful equality-key permutations. Five notices may legitimately remain after targeted tuning. [FK guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

The catalog warning is its per-row JWT `current_setting()` expression. Proposed policy wraps only that expression in a scalar SELECT, preserving all visibility rules. Local baseline/optimized tests compare ordinary claims, spoofed user_metadata and trusted demo app_metadata with identical row visibility. [RLS initialization-plan guidance](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan).

Both unused indexes have zero recorded scans and are only 16 KB each; the project has little representative traffic. Retain audit `(owner_id,id)` for owner/history ordering and revocations `(owner_id)` for owner/FK access. Zero scans in a new database is not evidence to drop an index. [Unused-index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). Health advisors: no findings.

## 5. Catalog readiness and exact proposals

Cloud catalog currently contains **0 records, 0 demo records and 0 published real programs**. Structure, RLS and prior real persistence/comparison gate remain intact. Readiness does not imply approved commercial data exists.

New [ingestion workflow](../COMPANY_CATALOG_INGESTION.md), `templates/company-program.template.json` and `pnpm catalog:validate` provide strict, no-network/no-database validation. Unfilled templates, demos, duplicate IDs/codes and placeholder prefixes are rejected. Unknown prices/dates remain null/empty. Publication and known prices require provenance metadata; a human must independently verify the facts. Local import stays insertion-only and no longer loads unapproved migration proposals. No Cloud import/write command or actual company offer was added.

Two exact SQL files are prepared and **not remotely applied**:

| Proposal | SHA256 |
|---|---|
| `supabase/migrations/proposed/20261105154454_session_boundary_hardening.sql` | `F6210EB5EC62B3DE8337AD6E1FF57AB1FAC02CBC22DB5EC77CE1B7B5199E5D64` |
| `supabase/migrations/proposed/20261105154456_catalog_rls_and_targeted_indexes.sql` | `AD6F105C6E3D38E4776E3EF9FD8640519D7518E607C1AF0BD83D654F3E0AAF57` |

Review [exact changes, compatibility and application procedure](../M3_SECURITY_CHANGE_PLAN.md). Neither drops data/indexes nor adds grants/definer functions. The first deliberately changes the existing helper and narrows a check/ACL; the second preserves catalog policy meaning and adds only two indexes. Remote policy/Auth changes require your approval, which is not assumed from permission to audit.

## 6. Verified offline checks

- `pnpm build`: PASS, both packages.
- `pnpm typecheck`: PASS, strict packages/tests/tools. Optional feedback fields remain explicitly omitted when absent; type safety was not loosened.
- `pnpm lint`: PASS, 74 files, no warnings/fixes on final check.
- `pnpm test`: **191/191 PASS in 19 files**, final suite 44.56 seconds. All original 170 retained; 21 added: ten security/proposal/guest-route, seven ingestion/CLI and four bounded-acceptance checks. Real PGlite tests reproduce/fix S1/S2 and preserve RLS/consent/memory behavior. No deterministic test attempted a global network fetch.
- `pnpm eval:travel` without approval/quota flags: correctly refused before any provider request (child exit 2). No live acceptance evidence was overwritten.
- `pnpm catalog:validate --file templates/company-program.template.json`: correctly rejected the intentionally unfilled template. Automated CLI tests also accept a test-only draft and reject invalid input without echoing supplied contents.
- `Get-FileHash -Algorithm SHA256`: all three applied sources unchanged; proposal hashes above recorded. No Cloud migration/Auth/data test was rerun because this phase is read-only.
- A final read-only comparison confirmed remote policies, function definitions/execute ACLs, table grants and Auth user count unchanged; catalog still empty and ledger still exactly three applied migrations. [Confirmation](M3_SECURITY_READ_ONLY_CONFIRMATION_2026-11-05.json). The attempted private-schema REST exposure probe returned `SCHEMA_EXPOSURE_READ_FAILED`; exposure is unverified rather than assumed safe.
- Normal local app startup and catalog import now use only the approved root migrations; pending proposal SQL is reserved for explicitly selected local verification. New company feature flags can no longer implicitly opt an ordinary local startup into the unapproved proposals. Hosted startup still never applies SQL.

## 7. Prepared bounded live evaluation — NOT RUN

The future suite now has **three turns**: actual destination research/itinerary; a budget-only reduction; then traveler count 2→3 with currency, destination, duration, party-total budget and explicit user-supplied totals unchanged. Strict expected constraints and real arithmetic outcomes are checked per case. Source URLs must come from actual fetched evidence. The third turn does not secretly multiply party totals or invent FX/child pricing.

Hard limits: **two basic Tavily searches total**, **twelve actual provider-adapter requests total across Gemini/Groq**, no same-provider retries, no OpenRouter, no Supabase access, maximum three turns with existing per-turn caps (four tool calls, five tool rounds, 24k tokens, 120s). Preparation tests verify request-cap enforcement and financial drift rejection; prior correction/source/failure tests remain passing. New helper `apps/api/src/evals/travel.ts` is evaluation support, not a simulated runtime response.

Both INVALID_TOOL_ARGUMENTS and CONSTRAINT_CONFLICT feedback are recorded without argument values. Genuine recovery and provider-failure observations are marked NOT_OBSERVED when no such event occurs; a clean live run does not prove recovery was exercised. Do not inject fake tool results, deliberately burn quota to force an outage, or count Arabic script alone as natural-language quality. A controlled recovery challenge would require separate approval. Result status explicitly requires human answer review; no live pass is claimed now.

## 8. Blocked, next and approval needed

Highest-priority next step: review/approve the **session-boundary proposal** after a current hash/definition/custom-token check, then apply and verify through the Supabase tool. Performance tuning can be reviewed independently. Auth changes also require explicit approval and current private-setting inspection; the paid password toggle stays disabled on Free.

Remaining M3 blockers: relevant model quota availability unconfirmed, separate approval for the updated bounded live suite, actual recovery/failure and useful Egyptian Arabic evidence where observed, and authoritative company programs/prices/schedules. Remote S1/S2 mitigation remains pending approval. Non-public Auth controls and the actual Data API exposed-schema list still need dashboard confirmation before a configuration change/public rollout. Intentional guest-policy and Free-plan warnings are not silently erased. Public production readiness, trusted write/metering and direct-Auth abuse protection are not established by this dev milestone.

No CRM, Voice AI, premium 3D frontend, business automation, paid service, booking, message or deployment was begun. Next remains security hardening and completing M3 acceptance.
