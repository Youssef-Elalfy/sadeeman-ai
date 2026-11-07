# M3 catalog and travel-context migration plan — APPLIED AND DATABASE-VERIFIED

Prepared/reviewed/applied 2026-11-05. Scope: dedicated **Sadeeman** project `ujdzysbowngtkwndgoqf` only, API `https://ujdzysbowngtkwndgoqf.supabase.co`. Following conditional workflow approval, read-only safety checks passed and the exact SQL was submitted through Supabase's migration tool, which returned success. Remote ledger: `20261105152213 company_catalog_travel_context`. See the [application and verification report](reports/M3_CLOUD_APPLICATION_2026-11-05.md) for current evidence and advisor findings. Live model/search requests remain paused.

## Exact artifact

`supabase/migrations/20261105144113_company_catalog_travel_context.sql`

SHA256: `4752202DF60641FBA0C2786A13D024F4C0BAB3E35E9E42F7057EF094976F62D4`

Generated using installed Supabase CLI `migration new company_catalog_travel_context`. Before approval, kept under `proposed/` to exclude it from the root migration list. Following successful Cloud application it was promoted to the root with the same basename and exact bytes/hash. The immutable SQL comment retains its original proposal wording; the ledger/report record application status. Hosted startup never runs DDL.

Dependencies: both previously approved M2 migrations, unchanged:

| File | SHA256 |
|---|---|
| `20261104232715_identity_memory_foundation.sql` | `B7A9A3566CBFB27DE42C371AE6ACBF48CA39245E9FDA86DBCA0AA6810A85EE3A` |
| `20261105001704_tool_execution_records.sql` | `6DBD694C3D5CC9FDF935BCEF2BF5ABAC768268006A0B140A8F49DF13C49443CF` |

## Objects and permissions

1. **New** `public.sadeeman_company_packages`: UUID + bounded structured JSON document; generated searchable code/title/destination/days/demo/publication fields, unique code and a publication/demo/duration index. Structured fields cover description, amount in minor units, currency, per-adult/per-person/party-total basis, priced party size, verification provenance, nights, dates, inclusions/exclusions and dated activities. Application reads and operator imports validate the full strict Zod contract; database structural checks are intentionally a subset. Malformed administrator inserts fail closed on application reads.
2. Catalog RLS + FORCE RLS. Authenticated active sessions read published records only. No authenticated INSERT/UPDATE/DELETE permission. Demo records require trusted `app_metadata.catalog_demo=true`; user-editable metadata cannot grant it. Runtime demo configuration is rejected outside automated test mode. No fixture seeds or real company offers are inserted by this migration.
3. **New** `public.sadeeman_travel_profiles`: conversation-owned state/version, owner/tenant checks, composite foreign key to the existing owned conversation with **ON DELETE CASCADE**, bounded state, optimistic versions, owner/conversation index. Active-owner RLS + FORCE RLS; authenticated SELECT/INSERT/UPDATE only. No standalone DELETE grant. Deleting an owned conversation removes its own structured context along with existing history.
4. **New** `sadeeman_catalog(text,jsonb)`: bounded published catalog search/detail reads; literal string filters, no dynamic SQL.
5. **New** `sadeeman_travel_profile(text,jsonb)`: get/save owned conversation context; locks visible owned conversation, checks expected version, supports idempotent identical-state retry.
6. **New** `sadeeman_commit_travel_turn(jsonb)`: calls the existing M2 turn commit and saves context in the **same transaction**. A version error rolls back messages/tool metadata too.

All three functions use SECURITY INVOKER and empty search_path. PUBLIC/anon execution is revoked; authenticated execution is explicit. Existing tables, functions and policies are not replaced. No SECURITY DEFINER additions. See [Supabase function guidance](https://supabase.com/docs/guides/database/functions) and [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Destructive-statement review

- No DROP, TRUNCATE, DELETE statement, or UPDATE without WHERE.
- The one UPDATE is inside the new profile save function: `ON CONFLICT(conversation_id) DO UPDATE SET version=excluded.version,state=excluded.state,updated_at=now() WHERE public.sadeeman_travel_profiles.owner_id=(select auth.uid())`. It updates only the conflicting owned profile; RLS, conversation ownership and version checks also apply. Defining the function does not execute it.
- The foreign-key cascade can delete the **new profile** when its owned conversation is later explicitly deleted. It does not delete existing conversations or company records.
- GRANT/REVOKE/ALTER TABLE affect only the two new tables and three new functions. No blanket schema permission changes, CREATE OR REPLACE, ALTER of existing tables, backfill, seed or table rewrite.

## Local evidence and limits

Real embedded PostgreSQL tests execute the proposed SQL alongside the original migrations. They test disk restart, insertion-only package additions, search/filter/detail/comparison, unknown prices, party arithmetic, demo/draft hiding, user-metadata privilege spoofing, denied catalog writes, two distinct authenticated owners, context ownership, atomic version rollback, idempotency, session revocation, restart restore and conversation-delete cascade. API tests exercise the same repository and SQL boundary with deterministic model fixtures. These are not claims of hosted PostgREST or live model acceptance for the proposed schema.

## Approved application procedure (completed; do not reapply)

The following procedure was followed for this exact proposal only. It is retained for audit, not as instructions to replay the migration. Any additional change requires a new reviewed plan/approval.

1. Reverify project identity/ref/API against `config/supabase-target.json`; read remote tables, schemas, function signatures, policy names and migration history. Check all two table names, three RPC signatures and two policy names for collisions. Use CREATE (not replacement), so unexpected collisions fail closed.
2. Rehash all three local files, verify the two M2 ledger entries, require this proposal to match the hash above. Stop for approval again if bytes differ, unexpected objects exist or any unexpected error occurs.
3. Apply this single approved additive migration transactionally to `ujdzysbowngtkwndgoqf`, recording its history. Never replay the two M2 migrations.
4. Verify all eleven application tables, new RPC signatures/permissions/RLS policies, indexes and unchanged M2 behavior. Run hosted security advisors and report actual findings. Verify catalog positive access and denied writes, two-user profile isolation, restart/atomic commit and conversation erasure using approved test data; do not seed fictional offers as real inventory.
5. Enable `ENABLE_COMPANY_CATALOG=true`, `ENABLE_TRAVEL_CONTEXT=true`, `ENABLE_TRAVEL_CONTEXT_PERSISTENCE=true` only after those checks. Keep `ALLOW_CATALOG_DEMO=false`. Real catalog remains empty until authoritative operator data is supplied. Gemini/Groq and memory/consent settings stay intact.

Rollback without destructive SQL: disable the three feature flags. Existing M2 RPCs and workflows remain the default. Physical removal of these objects would require separate approval; no destructive rollback is provided or authorized.
