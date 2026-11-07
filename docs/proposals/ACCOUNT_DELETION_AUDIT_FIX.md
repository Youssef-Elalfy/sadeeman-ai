# Account-deletion audit boundary — approval proposal

**Deployment update:** the owner independently verified application and registration of this approved source under Cloud execution version `20261107141313`. The original interrupted guest `6ee07be3-69b5-41cd-b388-d8a382be0d50` and all listed dependent Auth/application/Storage records are confirmed absent. This is owner-supplied live verification, superseding the historical blocked/proposal status below. Preserve the approved bytes and do not replay the SQL; `supabase/migrations/deployment-status.json` records the execution-version mapping.

Target: **Sadeeman `ujdzysbowngtkwndgoqf` only**. Cloud unchanged. No replacement guest, live provider request, application deploy, trigger disablement or cleanup has been performed.

## Reproduced root cause

Isolated PostgreSQL uses the checked-in deployed migrations and a test-only Auth mirror. A synthetic anonymous owner has one Auth session, one conversation and four messages, matching the interrupted fixture's shape. A restricted `supabase_auth_admin` test role can delete Auth users but cannot directly delete application conversations.

1. `DELETE FROM auth.users WHERE id=$1` cascades into `sadeeman_conversations` and fires `conversation_audit`. `sadeeman_private.record_audit()` raises **P0001 / UNAUTHORIZED** at its `record_owner IS DISTINCT FROM auth.uid()` condition because the administrative context has no end-user UID. The entire deletion rolls back.
2. A diagnostic-only function variant, installed inside a transaction that subsequently rolls back, lets this missing-parent DELETE reach the next statement. `INSERT INTO public.sadeeman_audit_events(owner_id,tenant_id,action,resource_id) ...` then raises **23503**, constraint **`sadeeman_audit_events_owner_id_fkey`**: the referenced Auth owner has already been deleted. No trigger was disabled.

These are locally proven failures. The Cloud function could not be fetched: one targeted attempt returned `MCP tool codex_apps/supabase.execute_sql is not available to the model`. The owner's Cloud observations are retained as external evidence; they are not represented as a fresh agent Cloud verification.

## Exact minimal behavior change

Replace **only** `sadeeman_private.record_audit()` and insert this branch before its existing authorization check:

```sql
if tg_op='DELETE' and not exists(select 1 from auth.users where id=record_owner) then
  return old;
end if;
```

The function remains private, VOLATILE, SECURITY DEFINER, with empty search_path, its existing owner/OID and restricted execution ACL. The original owner comparison and audit INSERT remain unchanged for all existing owners. This also handles `memory_audit` when memory is removed by the same Auth-owner cascade.

The branch does **not authorize deletion**. Existing Auth/table privileges, foreign keys and RLS still determine whether a row can be deleted. Application roles cannot delete Auth parents. An authenticated caller cannot exploit missing/forged claims to bypass the existing session/RLS protections. `auth.uid() IS NULL` alone, role-name checks alone, exception swallowing, trigger disabling and caller-controlled flags are deliberately not used as bypasses.

Owner-scoped audit events already reference Auth users with `ON DELETE CASCADE`; removing the account intentionally removes those events. The fix avoids attempting to create another invalid owner-scoped audit row. It does not claim to add a durable administrative deletion log outside that existing retention model. All ordinary owner actions remain audited.

## Reviewed file and preconditions

- CLI-generated version: `20261107135209_account_deletion_audit_boundary`.
- Proposed file: `supabase/migrations/proposed/20261107135209_account_deletion_audit_boundary.sql`.
- **SHA256:** `4EE7C520B99595F5537D3611CD336AC3E81A0E54B8BE40C4646D7F09CB969602`.
- Original normalized function-body MD5: `923b0d8cd84a62c21b488a84a3aa4341`.
- Proposed normalized body MD5: `6877280a66f8e6e4a2b8ada7dbfb61f9`.
- MD5 is only a deployment-definition comparison; the approved file integrity hash is SHA256.
- The file is excluded from normal applied migrations until approval/application. Previous migrations remain unchanged.

The migration first aborts on an unexpected function body, owner/security/volatility/search_path, executable client/Public ACL, audit trigger configuration, or audit-owner FK. Then it executes one `CREATE OR REPLACE FUNCTION`. No table/column/trigger/policy changes, grants, Auth settings, data imports, DELETE, UPDATE, TRUNCATE or DROP statements occur. Reapplication stops rather than silently overwriting another definition.

Run `supabase/verification/account_deletion_audit_read_only.sql` only on the independently verified project connection. It outputs definitions, permissions and metadata/counts for the exact interrupted fixture, never tokens or customer content. An arbitrary project literal in a SQL result is not identity proof.

## Safe approval and cleanup sequence

1. Obtain explicit approval for this exact migration hash, only on the target project. Verify connection identity, missing migration version, original definition/preconditions and file hash immediately before execution. Stop on any difference. Use a transaction and the supported migration mechanism; do not rerun the prior session-hardening migration.
2. Verify the new function body, unchanged ACL/RLS/triggers/FKs and continued authenticated owner operations.
3. Separately authorize or have the owner perform supported Auth deletion of **only** `6ee07be3-69b5-41cd-b388-d8a382be0d50`. Verify anonymous status, empty contact identifiers, creation window, known session/conversation IDs, unchanged four-message fixture shape and zero Storage objects first. Stop if it has become a real account or any evidence differs; never directly edit Auth tables in Cloud.
4. In Sadeeman → Authentication → Users, search the full UUID, compare the metadata and delete that one verified fixture. Use normal hard deletion, not a bulk selection. Alternatively use an already authorized supported Auth admin API; do not acquire new privileged credentials just for this task.
5. Run the read-only post-deletion counts. Confirm user, sessions/refresh tokens, conversation/messages and owner audit rows are gone. If supported Auth deletion still fails, stop and inspect the exact error rather than retrying or weakening constraints.
6. Only after cleanup is verified may remaining bounded research/upload/voice acceptance resume. Any replacement identity still requires the requested explicit permission and recoverable, encrypted test-session handling.

## Local validation

`tests/admin-user-deletion.test.ts` first reproduced the desired deletion regression failing with UNAUTHORIZED. The exact proposed SQL was then applied only to the isolated database. Nine tests cover both original failure layers, administrative cascade with messages and with consent/memory, another user's preservation, normal audit creation/update/deletion, denied direct administrative conversation deletion, cross-user/missing/expired/revoked/nonexistent-session isolation, immutable metadata/permissions and failed reapplication.

| Exact command | Observed result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/admin-user-deletion.test.ts --maxWorkers=1` | 9/9 passed; 5.62 seconds |
| `node node_modules/vitest/vitest.mjs run --maxWorkers=1` | **438/438 passed**, 35 files; 70.46 seconds; includes the previous 429 tests |
| `node node_modules/typescript/bin/tsc -p tsconfig.tests.json --noEmit` | Exit 0 |
| `node node_modules/@biomejs/biome/bin/biome check .` | Exit 0; 129 files checked |

The first lint attempt found a nested Biome configuration in the ignored prior deployment archive. Only `.private/deploy-source/biome.json` was removed from that disposable archive; application configuration was unchanged. The full lint rerun then passed.

Embedded Auth mirrors exercise real PostgreSQL constraints/triggers/RLS but do not replace the pending supported Supabase Cloud Auth deletion check. The read-only Cloud verification script is prepared but **not Cloud-executed**. No application source, previous applied migration or deployed service was changed. No commit/push/redeploy was needed for this review proposal.

References: [PostgreSQL cascade-trigger behavior](https://www.postgresql.org/docs/17/trigger-definition.html), [AFTER-trigger visibility](https://www.postgresql.org/docs/17/trigger-datachanges.html), [Supabase user deletion](https://supabase.com/docs/guides/auth/managing-user-data).
