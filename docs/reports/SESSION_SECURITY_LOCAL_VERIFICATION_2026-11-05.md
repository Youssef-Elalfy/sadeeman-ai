# Session security hardening — local preparation

Historical preparation checkpoint. The user subsequently reported manual Cloud application. The unchanged canonical file is now `supabase/migrations/20261105154454_session_boundary_hardening.sql`; do not replay it on Cloud. See [the current local handoff](SESSION_SECURITY_OFFLINE_HANDOFF_2026-11-05.md) and [verification/history guide](../SESSION_SECURITY_VERIFICATION_AND_HISTORY.md) for pending Cloud acceptance and history checks. The preparation-stage paths/status below are retained as historical evidence.

2026-11-05, Africa/Cairo. **Local gate PASS: 229/229 tests in 20 files, build/typecheck/lint PASS. All previous 191 tests preserved; 38 added.** Scope: **Sadeeman `ujdzysbowngtkwndgoqf` only**. Remote migrations, database writes and Auth configuration changes: **0**. Live model/search calls: **0**. OpenRouter remains disabled. No new milestone was started.

## Done — exact files

- `apps/api/src/persistence/local.ts`: recheck the local opaque token against the Auth-session mirror, matching owner, private-token expiry, Auth `not_after` and all matching revocation UUIDs at authentication and again at each operation. Resolve identity from the token hash, never a caller-supplied owner. Local guest creation creates its registry row transactionally. A one-time local upgrade preserves valid legacy tokens; subsequent startup does not resurrect removed sessions. This local Auth bootstrap never runs against Supabase.
- `supabase/migrations/proposed/20261105154454_session_boundary_hardening.sql`: stronger, **unapplied** SQL described below. Normal startup/import still exclude proposed migrations. Tests apply exact SQL only in isolated embedded PostgreSQL instances.
- `tests/session-validity.test.ts`: 38 additional real PostgreSQL regression cases; no database mocks or network access. Existing security/catalog fixtures now use real local session IDs and expiry claims. The old SQL preemption exploit is exercised directly so the newly protected transport cannot conceal the baseline vulnerability.
- `docs/M3_SECURITY_CHANGE_PLAN.md`: supersedes the inadequate format-only check explicitly. The old bytes are preserved in `docs/proposals/session_boundary_format_only.sql.txt`; exact old-to-final diff: `docs/proposals/SESSION_SECURITY_FINAL.diff`.

## Exact proposed remote changes

Approval is requested for **one session file only**, SHA256:

`770237AB233569FF25899BB4611F0A62D6C98EBB88B08E95B9D0BE6593F47AA0`

This differs intentionally from the previous reviewed format-only hash `F6210EB5EC62B3DE8337AD6E1FF57AB1FAC02CBC22DB5EC77CE1B7B5199E5D64`. The prior version could not reject nonexistent Auth sessions or enforce their expiry, so it did not satisfy the latest approved local-preparation scope. No differing version was applied remotely.

| Statement | Exact affected object and behavior | Risk / preservation |
|---|---|---|
| `DO $owner_check$` | Require postgres BYPASSRLS/superuser | Read-only prerequisite; raise and abort if unsupported |
| `CREATE FUNCTION` | `sadeeman_private.current_session_valid()` | New private, zero-argument, boolean-only STABLE SECURITY DEFINER; empty search_path, qualified tables, no writes/dynamic SQL. CREATE fails on a collision rather than replacing it |
| `ALTER FUNCTION ... OWNER TO postgres` | Only the new private validator | Deliberate privileged Auth metadata read; no client Auth table grants |
| `REVOKE ALL` then `GRANT EXECUTE` | New validator: revoke PUBLIC/anon/authenticated; explicitly allow authenticated EXECUTE | Narrow, caller-bound validation capability; no raw Auth rows/IDs/credentials returned. Existing platform-admin privileges are outside client isolation |
| `CREATE OR REPLACE FUNCTION` | `public.sadeeman_session_active()` | Existing invoker signature/OID/execute grants preserved; delegates to new validator |
| `ALTER POLICY ... USING ... WITH CHECK` | `own_sessions` on `public.sadeeman_session_revocations` | Preserve owner/tenant checks; require active session on reads/inserts; insert only caller's current session UUID. Same owner's other valid session can still read old revocations. Private bypass avoids recursive RLS evaluation |
| Two `REVOKE EXECUTE` statements | `sadeeman_private.guard_consent()` and `guard_memory()` | Remove direct PUBLIC/anon/authenticated execution; installed triggers stay effective |

The validator requires matching non-null `auth.uid()`/JWT string `sub`, a UUID `session_id`, numeric integer unexpired JWT `exp`, an existing same-owner `auth.sessions` row, nullable/future `not_after`, and no matching application revocation. A legacy mismatched-owner revocation UUID fails closed without rewriting/deleting that record. Neither user_metadata nor is_anonymous grants privilege.

There are **no DROP, DELETE, TRUNCATE or data UPDATE statements**, no seeds/imports, table rewrites, Auth-table writes, index changes, purchases or Auth settings. Function replacement, policy narrowing, ownership and function ACL changes are security-sensitive despite not deleting rows. Invalid/custom legacy tokens will lose access as intended; valid owners' stored data is retained. The separate catalog/index proposal is unchanged and **not included** in this approval request.

## Verified — evidence and commands

The dedicated session suite verifies missing/malformed/nonexistent/foreign-owner sessions, mismatched subjects, missing/invalid/expired JWT expiry, Auth session expiry/deletion, opaque token expiry, revocation, legacy preemption, cross-user and expired-session inserts, unauthorised Auth CRUD, denied revocation UPDATE/DELETE, anonymous/permanent claim parity, legitimate logout, second-session continuity, private/public function execution ACLs and no policy recursion. Its before/after snapshot compares **all eleven application tables' rows**, unaffected policies, RLS/FORCE flags, table grants, public function identities/ACLs/security settings, triggers and the original applied local migration ledger. Existing history, consent-backed memory and isolation remain accessible correctly. The local legacy-upgrade test verifies preserved tokens/history and no registry resurrection on a later migration pass.

| Command | Observed result |
|---|---|
| `pnpm build` | PASS, both workspace packages |
| `pnpm typecheck` | PASS, packages plus strict test/tools compilation; an initial fixture narrowing error was corrected with a checked local SID constant |
| `pnpm lint` | PASS, 75 files, no fixes |
| `pnpm exec vitest run tests/security-hardening.test.ts tests/company-catalog.test.ts tests/session-validity.test.ts` | New 38 cases passed; two existing suites timed out in 30-second setup during concurrent execution, with a catalog cleanup error after the timeout |
| First `pnpm test --maxWorkers=1` | 226/229 passed, 19/20 files; three persistence tests timed out at their unchanged 30-second limits; 400.02 seconds |
| `pnpm exec vitest run tests/persistence-api.test.ts --maxWorkers=1` | 6/6 passed, 27.86 seconds, including all three previous timeouts; no assertion or timeout changes |
| Final `pnpm test --maxWorkers=1` | **229/229 PASS in 20/20 files**, 172.10 seconds, started 21:42:25 Africa/Cairo; no skipped tests |

No timeout or assertion was weakened. A serial rerun without concurrent build checks resolved the prior timeouts; resource contention is consistent with the observations, not a measured root-cause proof. Automated tests globally block real fetch; mocked providers are limited to explicitly labeled wire/agent tests. Embedded PostgreSQL integration tests are real database execution, not hosted Auth evidence. A bounded local environment check printed only `openRouterRuntimeEnabled:false`; no credential value was displayed or changed.

### Identity, baseline and hashes

The last successful read-only in-session inspection confirmed Sadeeman `ujdzysbowngtkwndgoqf`, eu-west-1, PostgreSQL 17.11, ACTIVE_HEALTHY. It confirmed Auth `sessions.id/user_id/not_after`, RLS enabled on that table, no PUBLIC/anon/authenticated column grants, postgres BYPASSRLS, private schema ownership, no new validator name collision, zero legacy mismatched revocations joined to current Auth sessions, and the unchanged three-entry ledger. A final attempted connector identity recheck returned **tool unavailable**; it did not run SQL or change Cloud. Restored connector access and fresh read-only checks are prerequisites to execution, even after approval.

Local target configuration remains `config/supabase-target.json`. The SQL contains no remote connection or project-switching command; eventual migration tool invocation must explicitly use only that project ref. Recheck this file's bytes and all prerequisites immediately before an approved application.

| Unchanged source | SHA256 | Existing Cloud ledger |
|---|---|---|
| `20261104232715_identity_memory_foundation.sql` | `B7A9A3566CBFB27DE42C371AE6ACBF48CA39245E9FDA86DBCA0AA6810A85EE3A` | `20261105005039 identity_memory_foundation` |
| `20261105001704_tool_execution_records.sql` | `6DBD694C3D5CC9FDF935BCEF2BF5ABAC768268006A0B140A8F49DF13C49443CF` | `20261105005048 tool_execution_records` |
| `20261105144113_company_catalog_travel_context.sql` | `4752202DF60641FBA0C2786A13D024F4C0BAB3E35E9E42F7057EF094976F62D4` | `20261105152213 company_catalog_travel_context` |
| Separate proposed catalog/index file | `AD6F105C6E3D38E4776E3EF9FD8640519D7518E607C1AF0BD83D654F3E0AAF57` | Unapplied; outside this request |

Verified with `Get-FileHash ... -Algorithm SHA256`; the archived old proposal also still has its old F621 hash. The final diff was generated by `git diff --no-index --no-ext-diff` between the archive and revised proposal; exit 1 means a diff exists, not a failed SQL command. Git's line-ending warning did not alter the migration bytes.

## Blocked / remaining risks

- **Cloud still has both session weaknesses until approval and successful application.** Hosted Auth sign-out/deleted-session behavior, real registered-user login, two-user direct PostgREST denial, refresh-token continuity and advisor findings for this new function are **untested this phase**. Existing Cloud persistence evidence predates this proposal.
- This privileged validator depends on the inspected Auth schema and trusted JWT context supplied by Supabase. It fails closed if that dependency breaks. Statement-snapshot validation cannot cancel an already-running operation or substitute for paid inactivity/single-session settings. Supabase documents checking auth.sessions for removed sessions in [its session guide](https://supabase.com/docs/guides/auth/sessions).
- PostgREST private-schema exposure remains unverified; no claim that it is confirmed hidden. The helper remains self-only even if schema exposure is misconfigured, but exposure should be checked before production.
- The eleven intentional Auth-guest advisor warnings and Free-plan leaked-password protection limitation remain; no setting/grant was broadened to suppress them. Owner-accessible REST writes and server-only trace/metering integrity are separate production risks in the prior audit.
- M3 live acceptance still needs quota availability, separate bounded-run approval and authoritative company packages. Live Gemini/Groq/Tavily calls stay paused; OpenRouter stays disabled. No CRM/voice/frontend/automation work is authorized here.

## Next / approval needed

The local gate passed. Request explicit approval for **only** the revised session migration/hash above on **`ujdzysbowngtkwndgoqf`**. No remote action is authorized by this preparation. After approval, first restore connector availability and repeat project/ledger/hash/schema/function/policy/ACL checks; stop on differences. Then use the migration tool for that one approved file, preserve a safe metadata/count baseline without logging user contents, verify the hosted session/isolation/consent/memory regressions and security advisors, and report actual results. Any unexpected remote error requires stopping and obtaining approval for a concrete correction; do not silently restore a weaker check.
