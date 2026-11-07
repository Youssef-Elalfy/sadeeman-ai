# Read-only migration safety review — Sadeeman

Historical pre-application review. The user later renewed approval and both unchanged migrations were applied; see [the application report](reports/CLOUD_APPLY_AND_PROVIDERS_2026-11-05.md). Findings below describe the reviewed payloads and the remote state before application.

Reviewed on 2026-11-05. **No remote mutation was executed during this review.** The previous application request returned `{"status":"declined","message":"Migration was declined."}`. It did not report the warning's matching rule or statement. Remote metadata below confirms neither migration was applied. The earlier approval is not being reused after the user's request to stop and review; renewed approval is required.

## Exact target and unchanged payloads

Only project **Sadeeman**, ref **`ujdzysbowngtkwndgoqf`**, API `https://ujdzysbowngtkwndgoqf.supabase.co`, region **eu-west-1**, status **ACTIVE_HEALTHY**, PostgreSQL **17.11**.

| File | SHA-256 |
|---|---|
| `supabase/migrations/20261104232715_identity_memory_foundation.sql` | `B7A9A3566CBFB27DE42C371AE6ACBF48CA39245E9FDA86DBCA0AA6810A85EE3A` |
| `supabase/migrations/20261105001704_tool_execution_records.sql` | `6DBD694C3D5CC9FDF935BCEF2BF5ABAC768268006A0B140A8F49DF13C49443CF` |

Both hashes still match the reviewed approval plan and the SQL supplied to the declined migration call. Neither SQL file was edited for this review. The tool call explicitly selected this project ID; the SQL contains local schema references, no database switching, remote connection, external SQL execution or other-project target.

## Dangerous-statement inventory

Across **both complete files**, including function bodies and the dynamic SQL block:

| Statement | Count | Executed against existing rows during migration? |
|---|---:|---|
| `DROP` | 0 | No |
| `TRUNCATE` | 0 | No |
| `UPDATE` without `WHERE` | 0 | No |
| `DELETE FROM` | 2 | No; both are stored inside newly defined functions |
| `UPDATE` with `WHERE` | 4 | No; all are stored inside the new operation function |

The second migration has **no DELETE or UPDATE DML statements**. `ON CONFLICT ... DO NOTHING` never overwrites an existing row. Neither file contains `CREATE OR REPLACE` or `ON CONFLICT ... DO UPDATE`.

### Every DELETE statement, verbatim

**Foundation migration, line 149, inside `sadeeman_private.forget_memory`:**

```sql
delete from public.sadeeman_memories where owner_id=uid and tenant_id=uid and (p_all or id=p_memory or consent_id=p_consent);
```

Future effect when explicitly called: physically erase the authenticated owner's matching memories, including expired/revoked rows. `p_all=true` can erase **all that owner's memories**, never all customers' memories because both owner predicates remain. This is a SECURITY DEFINER helper, so its explicit owner/session checks matter; it uses an empty search path and a per-owner lock. This is real erasure capability, not a harmless read. Defining the helper does not invoke it.

**Foundation migration, line 183, inside `public.sadeeman_operation`:**

```sql
if p_action='delete_conversation' then delete from public.sadeeman_conversations where id=cid; return '{"deleted":true}'; end if;
```

Future effect when a customer invokes `delete_conversation`: delete that specific owned conversation. The SECURITY INVOKER function uses RLS and first checks the conversation is visible. Foreign keys then erase its dependent turns, messages, provenance-linked memories and (after migration 2) tool metadata. It cannot delete a different customer's conversation through the normal authenticated role. Creating the function does not run this branch.

### Every UPDATE statement

All are inside `public.sadeeman_operation`, which runs as the authenticated caller with RLS:

| Foundation line | Target / WHERE clause | Future effect |
|---|---|---|
| 195 | `sadeeman_conversations` / `where id=cid` | Recompute the owned conversation's bounded extractive summary after a successful turn |
| 212 | `sadeeman_consents` / `where revoked_at is null` | Mark **all currently unrevoked consents visible to this owner** revoked after a declined consent action; broad within that owner, limited by RLS |
| 224 | `sadeeman_memories` / `where id=(p_payload->>'id')::uuid and version=(p_payload->>'expectedVersion')::int` | Correct one owned preference using version checking; overwrite its content/category/consent/expiry and increment version |
| 235 | `sadeeman_consents` / `where id=rid and revoked_at is null` | Revoke one visible consent |

These operations do change future application data when called. They are **not called by migration execution**. The branches at lines 211, 234 and 237 call the owner-scoped erasure helper only during later consent/forget actions. `FOR UPDATE` at lines 187 and 217 is row locking, not a separate data update.

### Other destructive-looking text

- **14 `ON DELETE CASCADE` clauses** define future referential cleanup. Foundation lines **8, 19, 27, 35, 39, 40, 45, 57, 66, 70, 77, 84**; tool-record migration lines **4, 14**. They delete no rows on creation. Later deletion of an Auth user can cascade into that user's application records; these files do not delete or update Auth users.
- Foundation line **156**, `grant select,insert,update,delete ... to authenticated`, gives rights on the **new application tables**, still constrained by FORCE RLS. Granting DELETE is not executing a DELETE.
- Trigger definitions at foundation lines **139–140** mention DELETE to record metadata **after a later deletion**, not to initiate one. `tg_op='DELETE'` at lines **133/136** examines the triggering event.
- `REVOKE` changes privileges, not stored data. These statements address the new objects and `sadeeman_private`. If that private schema already existed, its schema privileges could be changed; the remote review confirms it **does not exist** on this target.

These are the precise potentially warning-relevant clauses. The warning system exposed **no exact match diagnostics**, so identifying one of them as its confirmed internal trigger would be speculation.

## Fresh remote evidence — read-only

Executed only `get_project`, `list_tables`, `list_migrations` and PostgreSQL catalog **SELECT** queries for this same ref:

- Schemas present: `auth`, `extensions`, `graphql`, `graphql_public`, `public`, `realtime`, `storage`, `vault`. This is a Supabase database with managed schemas, not an entirely object-free PostgreSQL cluster.
- `sadeeman_private` is **absent**.
- Relations in `public` / `sadeeman_private`: **[]**, including tables, indexes, sequences and views checked through `pg_class`.
- Conflicts with all ten proposed function names in their target schemas: **[]**.
- Public `sadeeman%` type-name conflicts: **[]**.
- `list_migrations`: **[]**; `supabase_migrations.schema_migrations` is **absent**.

No proposed application object exists to overwrite. `CREATE TABLE` and `CREATE FUNCTION` use ordinary CREATE, so matching existing objects would fail rather than be silently replaced. The existing `public` schema is used; Supabase-managed Auth/Storage tables, functions and data are not altered. Foreign keys reference `auth.users` but do not mutate its rows.

## What application actually creates / changes

This is **more than tables and RLS**: nine new application tables, a private schema, indexes/constraints/foreign keys, FORCE RLS policies, ten new functions, five triggers, and scoped grants/revokes. The top-level `DO` block only enables/forces RLS and creates policies on a fixed list of six newly created application tables. It does not execute a stored erasure or update routine.

There is no top-level data deletion, truncation, update, overwrite, fixture seed or invocation of those deletion functions. No application change touches another Supabase project, Auth configuration, paid plan, booking, messaging or deployment.

## Assessment / renewed approval

**Reasonably safe as an additive initial application schema on this verified new target:** no existing application objects/data are present, no object replacement is used, and no row-destructive operation runs during application. The warning-worthy deletion capability is intentional future customer erasure, constrained as described above. This assessment does not replace the pending hosted two-user/RLS acceptance test after installation.

**Blocked:** renewed approval; no remote SQL mutation is authorized during this review.

**Next:** after renewed approval, recheck these exact hashes and remote absence of conflicting objects, apply foundation then tool metadata **only** to `ujdzysbowngtkwndgoqf`, and inspect policies/grants/history. Stop on any mismatch/failure; do not issue destructive cleanup or bypass the warning through another execution method.

Local verification used `Get-FileHash -Algorithm SHA256`, complete numbered file reads, and `rg -n -i '\b(drop|truncate|delete|update|create or replace|on conflict|execute|revoke)\b'` on these two files, followed by manual inspection of function/DO-block boundaries and WHERE clauses. No SQL or application code was modified by the review.
