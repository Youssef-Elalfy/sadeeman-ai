# M3 security/performance change plan — historical proposal and current status

**Current status supersedes the session application instructions below:** the user reports manual execution of the approved session SQL in Sadeeman. Its unchanged canonical source is now `supabase/migrations/20261105154454_session_boundary_hardening.sql`, SHA256 `770237AB233569FF25899BB4611F0A62D6C98EBB88B08E95B9D0BE6593F47AA0`. **Do not rerun it.** Complete deployed-definition comparison, two-user Cloud verification and ledger reconciliation remain pending. Use [the read-only verification/history guide](SESSION_SECURITY_VERIFICATION_AND_HISTORY.md). No history change is requested or authorized now. The performance proposal and Auth configuration proposals remain unapplied and outside scope. The text below preserves the preparation-stage reasoning and must not be treated as an instruction to replay session SQL.

Scope: Sadeeman `ujdzysbowngtkwndgoqf` only. This review is read-only remotely. No Auth setting, policy, grant, data or migration was changed in Cloud. The original three applied SQL files retain their reviewed hashes. Proposals were generated with the installed Supabase CLI and moved into `supabase/migrations/proposed/`; only explicitly selected local tests execute them.

## 1. Session boundary — recommended first

Exact SQL: `supabase/migrations/proposed/20261105154454_session_boundary_hardening.sql`

SHA256: `770237AB233569FF25899BB4611F0A62D6C98EBB88B08E95B9D0BE6593F47AA0`

This revised, unapplied proposal supersedes the earlier format-only proposal, SHA256 `F6210EB5EC62B3DE8337AD6E1FF57AB1FAC02CBC22DB5EC77CE1B7B5199E5D64`. Its exact bytes are archived in `docs/proposals/session_boundary_format_only.sql.txt`; the exact revision is in `docs/proposals/SESSION_SECURITY_FINAL.diff`. The stronger checks implement the user's subsequent requirement to reject nonexistent and expired sessions as well as missing/revoked sessions. Earlier approval/review of the old hash does not authorize this new SQL.

Changes:

1. Add `sadeeman_private.current_session_valid()`: a zero-argument, boolean-only, STABLE SECURITY DEFINER with an empty search_path and fully qualified table references. Its explicit owner is `postgres`; the initial DO block fails if that role lacks BYPASSRLS/superuser. The last successful read-only Cloud inspection confirmed BYPASSRLS, the Auth columns used below, and no function-name collision. This deliberate privilege boundary reads protected Auth metadata without granting clients SELECT on Auth tables. It returns no Auth rows, IDs or credentials and performs no writes or dynamic SQL. Revoke PUBLIC/anon/authenticated EXECUTE, then grant only authenticated EXECUTE explicitly; existing platform administrator privileges are outside application isolation.
2. Require a valid auth.uid(), matching string JWT sub, UUID session_id and numeric integer JWT exp strictly after statement_timestamp(). Require an auth.sessions row whose id and user_id match that caller and whose not_after is null or in the future. Reject any application revocation with that session UUID, regardless of its owner, so a legacy preemption row fails closed. Malformed claim casts return false. Authentication failures/errors never produce an active session.
3. Replace `public.sadeeman_session_active()` with an invoker wrapper around that private validator. Keep its signature, object identity, existing execute grants and empty search_path. Tighten only `own_sessions` USING and WITH CHECK: owner and tenant still equal auth.uid(); both require a valid current session, and insertion additionally requires the current JWT session UUID. A valid second session of the same owner retains access to that owner's revocation history and application data. Invalid sessions see no revocation metadata. The definer reads revocations with its verified RLS bypass, preventing recursive policy evaluation. No existing revocation row is rewritten or deleted.
4. Revoke direct PUBLIC/anon/authenticated EXECUTE on `sadeeman_private.guard_consent()` and `guard_memory()`. Existing triggers remain installed and effective, proven in actual local PostgreSQL tests. Their existing PUBLIC execute ACL is low-risk because trigger functions cannot be invoked as ordinary functions and anon has no private-schema usage; this is surface reduction, not an assertion that they leaked data.

Evidence: local baseline tests reproduce (a) a principal without session_id being treated as active and (b) an authenticated owner inserting a known other session UUID under their own owner_id, causing that other session's later logout insertion to conflict and falsely report revocation while remaining active. The second requires learning the other session UUID; no JWT signature forgery or cross-owner data read was demonstrated. The proposed check blocks that preemption and restores correct revocation. Tests also retain normal anonymous-user persistence, consent/memory triggers, erasure and owner isolation.

Compatibility: Supabase Auth sessions include UUID session_id matching auth.sessions.id. Check membership for a session removed by Auth sign-out instead of trusting JWT expiry alone; see [official session documentation](https://supabase.com/docs/guides/auth/sessions). Custom/legacy tokens lacking the required sub/session_id/exp or Auth row fail closed. Standard anonymous and permanent users follow the same owner/session checks; no is_anonymous restriction is added. JWT verification remains Supabase Auth/PostgREST's responsibility. This validates the current statement's snapshot, not cancellation of an in-flight query, paid inactivity/single-session settings or a new refresh-token service. Auth schema/grant drift fails closed and requires review. No Auth settings or broad Auth SELECT privileges are proposed.

No DROP/TRUNCATE/DELETE or data UPDATE; no table rewrite, seed, index, Auth-table modification or existing data change. The new private definer and explicit authenticated EXECUTE grant are security-sensitive changes, despite returning only a caller-bound boolean. CREATE (not OR REPLACE) for that new name prevents silently overwriting a conflicting function. The public wrapper preserves its existing identity/grants; the policy is narrowed. Recheck exact project identity, columns, role properties, function-name collision, current policy/function/grants and legacy mismatched revocation count before execution. Stop on differences. Request approval for this session file/hash only; the performance proposal below is separate.

Local implementation: opaque-token authentication and each operation now independently check the local Auth-session mirror, owner, both expiry boundaries and all matching revocations. A local-only, one-time registry backfill preserves unexpired/unrevoked legacy opaque tokens and history; later startup never recreates a removed session. This bootstrap is TypeScript for embedded development databases, never Cloud SQL. Normal app startup still excludes all proposals. Exact SQL is exercised explicitly in isolated PostgreSQL tests; it is not installed in an existing developer database merely by running tests.

## 2. Catalog RLS and two targeted indexes

Exact SQL: `supabase/migrations/proposed/20261105154456_catalog_rls_and_targeted_indexes.sql`

SHA256: `AD6F105C6E3D38E4776E3EF9FD8640519D7518E607C1AF0BD83D654F3E0AAF57`

Changes:

- Alter only `readable_company_catalog` USING: wrap its JWT `current_setting()` demo check in a scalar SELECT so PostgreSQL can initialize it once per statement. Keep auth.uid(), session validation, published status and trusted app_metadata demo rules logically equivalent. No user_metadata authorization and no added role.
- Create `sadeeman_memories_source_conversation_owner_idx` on `(source_conversation_id,owner_id)`.
- Create `sadeeman_messages_turn_owner_conversation_idx` on `(turn_id,owner_id,conversation_id)`.

Read-only Cloud EXPLAIN, with sequential scans disabled **only inside rolled-back diagnostic transactions**, demonstrated that the other five advisor-listed lookups already use existing indexes with both equality conditions. The two selected paths currently filter source_conversation_id/turn_id after a less-specific index lookup. This is access-path evidence, not a measured production latency improvement. No EXPLAIN ANALYZE or live load test ran.

Do not add five redundant indexes solely to make the advisor quiet. The advisory's index-order heuristic may still flag reversed equality keys after this proposal. Keep both currently-unused indexes: audit `(owner_id,id)` and revocations `(owner_id)` support ownership/history and foreign-key access, and the new database has little representative traffic.

No index removals, FK/RLS weakening, table/data mutation, definer function or broader grant. CREATE INDEX is ordinary transactional creation on the currently small tables; schedule for a quiet window and recheck sizes/locks before execution. This is not a zero-lock or production-scale benchmark claim.

## Auth configuration proposals — approval required; no paid services

The organization is actually on **Free**, verified via the connector. Hosted leaked-password protection is **Pro+**, so it remains an acknowledged plan limitation. No upgrade, subscription, custom paid hook or equivalent claim is proposed. Basic MFA is available on Free; phone MFA, hosted session timeouts and single-session enforcement are outside Free. See [official pricing](https://supabase.com/pricing) and [password security](https://supabase.com/docs/guides/auth/password-security).

Proposed operator settings, after separate approval and prerequisite checks:

| Setting | Current evidence | Exact proposed action |
|---|---|---|
| Password minimum | Not exposed by connector/public settings | Set minimum to 12 characters before registered-password onboarding; review the existing value first |
| Required password characters | Not exposed | Require lowercase, uppercase, digits and symbols using the supported dashboard option |
| Password-change reauthentication/current password | Not exposed | Enable the supported reauthentication and current-password requirements, then test the registered-account flow separately |
| Email confirmation | Public settings: mailer_autoconfirm=false | Preserve confirmation; no change needed |
| CAPTCHA | Public settings do not expose its current state | Configure supported Turnstile Free after a real challenge client exists and secrets are entered securely; then enable the server's REQUIRE_GUEST_CAPTCHA flag. No challenge UI or provider account is created in this task |
| Anonymous rate limit | Project value not exposed; docs describe default 30/IP/hour | Verify dashboard value and keep at most 30/IP/hour for this dev workflow; backend now independently caps its own guest route at 5/IP/hour |
| Leaked-password toggle | Disabled; Free plan | Do not enable a paid feature. Keep the warning documented; no-cost controls are not an equivalent breached-password database |

These are desired dashboard changes, **not an invented Management API payload**. The current non-public settings must be read before presenting an executable configuration request. No current minimum, CAPTCHA state or reauthentication state is assumed. [CAPTCHA support](https://supabase.com/docs/guides/auth/auth-captcha), [Turnstile Free plan](https://developers.cloudflare.com/turnstile/plans/).

Offline backend code adds the guest route limit (real IP, trustProxy=false) and an optional nonempty-token guard. The guard forwards a token to Supabase; only configured Supabase CAPTCHA verification validates it. It is off by default and cannot protect direct Supabase endpoints by itself. Memory-only per-process rate limits reset on restart and do not replace upstream Auth abuse protection. No remote setting or current `.env` was edited for these changes.

## Eventual application gate

1. Review and approve exact file(s)/hash(es), separately from any live model test or Auth configuration change.
2. Reverify project identity, original ledger/hashes, current function/policy/grant definitions, private validator name collision, postgres BYPASSRLS, Auth-session columns/privileges, legacy mismatched revocations and custom tokens lacking required claims/registry rows. Inspect index collisions/sizes/locks only if the separate performance proposal is approved. Stop on differences and re-present the plan.
3. Apply only the approved proposal(s) via Supabase's migration tool. Never replay the three existing files. Local filename timestamps differ from existing MCP-generated Cloud ledger timestamps; use the documented mapping, not generic db push/repair.
4. Verify preserved data/owner access and no increased privileges; test current-session revocation, denied cross-session insert, missing/malformed claims, private triggers/consent/erasure, all catalog visibility modes, and RLS plans. Then run advisors and local checks again, recording actual results.
5. If a change causes trouble, stop dependent calls and prepare a separately reviewed correction. Do not silently restore the weaker helper/policy or drop indexes.

The proposals are **unapplied and not approved for execution** in this local-preparation phase. See `docs/reports/SESSION_SECURITY_LOCAL_VERIFICATION_2026-11-05.md` for final local results and remaining hosted checks. Keeping intentional guest access means the eleven anonymous-user warnings are expected to remain; hiding them is not a security objective.
