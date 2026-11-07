# M3 Cloud migration pre-application safety review

Historical pre-application checkpoint. The subsequent [application report](M3_CLOUD_APPLICATION_2026-11-05.md) records successful application, preserved original data and actual post-application verification. The pending status below reflects the moment before the tool execution request.

2026-11-05. Status: **READ-ONLY CHECKS PASSED; final execution approval pending.** No Cloud mutation or live model/search request has run in this review. Machine-readable metadata baseline: [M3_CLOUD_PREFLIGHT_2026-11-05.json](M3_CLOUD_PREFLIGHT_2026-11-05.json).

## Exact target and source

- Remote project: **Sadeeman**, ref `ujdzysbowngtkwndgoqf`, ACTIVE_HEALTHY, eu-west-1, PostgreSQL 17.11.0.011.
- Verified API: `https://ujdzysbowngtkwndgoqf.supabase.co`; matches `config/supabase-target.json`.
- Migration: `supabase/migrations/proposed/20261105144113_company_catalog_travel_context.sql`.
- SHA256: `4752202DF60641FBA0C2786A13D024F4C0BAB3E35E9E42F7057EF094976F62D4` — exact match to the reviewed [plan](../M3_CATALOG_MIGRATION_PLAN.md). The SQL was read and hashed from the same bytes immediately before the execution request; no SQL edits or promotion have occurred.
- Both M2 source hashes still match the plan: identity/memory `B7A9A3566CBFB27DE42C371AE6ACBF48CA39245E9FDA86DBCA0AA6810A85EE3A`, tool records `6DBD694C3D5CC9FDF935BCEF2BF5ABAC768268006A0B140A8F49DF13C49443CF`.
- Remote ledger has exactly `20261105005039 identity_memory_foundation` and `20261105005048 tool_execution_records`. Neither will be replayed.

## SQL summary and impact

Adds only `public.sadeeman_company_packages`, `public.sadeeman_travel_profiles`, their indexes/constraints, policies `readable_company_catalog` and `own_travel_profile`, and three SECURITY INVOKER RPCs with empty search_path: `sadeeman_catalog(text,jsonb)`, `sadeeman_travel_profile(text,jsonb)`, `sadeeman_commit_travel_turn(jsonb)`.

Both new tables enable and force RLS. Company programs are shared published catalog reads for authenticated active sessions, not customer-private tenant records. Customer profiles require matching owner/tenant/session and an owned conversation. Authenticated catalog writes are denied. Profile SELECT/INSERT/UPDATE are permitted only within owner RLS; no DELETE grant. PUBLIC/anon table access and RPC execution are revoked on the new objects only. Existing grants/default privileges/roles are not changed; no new definer function or privileged bypass is added.

No DROP, TRUNCATE, DELETE statement or UPDATE without WHERE. The only UPDATE is inside a newly defined function:

```sql
on conflict(conversation_id) do update
set version=excluded.version,state=excluded.state,updated_at=now()
where public.sadeeman_travel_profiles.owner_id=(select auth.uid());
```

It can replace the caller's conflicting profile after expected-version/ownership checks when that RPC is later invoked. Migration application defines the function without invoking it. The new FK's ON DELETE CASCADE erases only the owned profile when its parent conversation is later explicitly deleted. There is no table/data replacement, backfill, seed or standalone data mutation in this migration; only the expected migration-ledger entry is added by application.

## Existing objects and data

All nine existing public application tables have RLS **and FORCE RLS**; all nine existing policies and six existing application functions were captured with grants, definitions or definition fingerprints. The required `UNIQUE(id,owner_id)` conversation key and existing commit/session RPC dependencies are present. No proposed relation, index, function-name or composite-type collisions exist. The two proposed policy names do not exist.

No existing table/function/policy is altered or replaced by the reviewed SQL. Baseline row counts and content fingerprints were captured without returning customer contents: conversations 0, turns 0, messages 0, memories 0, tool executions 0; consents 4, requests 12, audit events 24, session revocations 2. Immediately after approval/application, these fingerprints and existing policy/function/grant metadata must be rechecked **before test writes** to verify preservation. These are current counts, not a claim that customer data could be discarded if present.

## Fictional data and write safety

No fixtures or commercial programs are imported. Demo records require trusted `app_metadata.catalog_demo=true` and cannot be enabled by user-editable metadata. Normal authenticated users cannot insert, relabel or overwrite catalog records. Runtime rejects demo opt-in outside explicit automated test mode; package results retain their per-record demo classification and FICTIONAL DEMO label, with `bookable=false` and `liveInventory=false` for every package. Missing prices/dates remain unknown. No authoritative business package data has been supplied. Positive catalog verification must use explicitly identified test data or approved actual records, never fictional data labeled as a verified commercial offer.

## Current advisor findings — before application

- **Security:** 10 WARN findings, no ERROR findings: nine `auth_allow_anonymous_sign_ins` warnings, one on each existing RLS table, because approved anonymous guest identities use the authenticated role; plus `auth_leaked_password_protection` disabled. Owner/session/consent predicates are present. These warnings are not proof of cross-user leakage, but guest access remains intentional development scope and password protection needs review before registered-account/production rollout. No policies or Auth settings were silently changed. [Anonymous-access warning guidance](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0012_auth_allow_anonymous_sign_ins), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- **Performance:** six pre-existing unindexed foreign keys (memories ×2, messages ×2, tool executions ×1, turns ×1); two unused-index INFO findings (audit owner/id and session-revocation owner). No index additions/removals beyond the exact approved proposal are included. [Foreign-key indexing guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [unused-index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
- **Health:** zero findings. Current results supersede the older historical zero-security-findings report.

## Verification and next gate

`pnpm build`, `pnpm typecheck`, and `pnpm lint` passed; lint checked 68 files without changes. `pnpm test` passed **170/170 in 16 files** (24.00 seconds), including local PostgreSQL catalog, RLS, two-user ownership, restart, context atomicity and hosted-wire tests with explicit test transports. These tests do not establish new hosted-schema acceptance before application.

Next: request final execution approval through the Supabase migration tool for this exact SQL, project and hash. Only after approval/application: verify eleven tables, all new RPCs/RLS/grants, original fingerprints/metadata, two-user ownership and unauthorized-write protection, persisted catalog search/comparison, then re-run advisors and record actual findings. No live model/search test, unrelated project access, business data import, CRM, voice, frontend or automation is authorized by this migration gate.
