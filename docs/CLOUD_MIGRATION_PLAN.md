# Sadeeman Cloud migration approval plan — 2026-11-05

## Verified target (pre-application read-only evidence)

- Project: **Sadeeman** — `ujdzysbowngtkwndgoqf`.
- API URL: `https://ujdzysbowngtkwndgoqf.supabase.co`.
- Region: `eu-west-1`; status: `ACTIVE_HEALTHY`.
- Actual database: PostgreSQL **17.11**, server connection verified through the Supabase MCP.
- Target schemas `public` and `sadeeman_private`: **no tables** reported. Migration history: **empty**.
- Security and performance advisors: **no current lints**. This describes the empty pre-migration state, not a passed customer-data isolation test.
- Required `auth.users`, `auth.uid()`, non-bypass `authenticated` role, SHA-256 and transaction advisory-lock permissions are present.
- The first connector connection exposed the wrong project list; after re-linking, Sadeeman became accessible. No unrelated project's schema, data or migrations were inspected or changed.

MCP access is administrative connector access. It does **not** configure the app's publishable key, customer JWTs, or Gemini key. An enabled modern publishable key exists; its value has not been displayed or copied into logs. The application remains unconnected until its local private configuration is supplied.

## Exact proposed SQL

The two files below are the complete reviewed payloads. Both were subsequently approved and applied unchanged, in order. See [application and verification evidence](reports/CLOUD_APPLY_AND_PROVIDERS_2026-11-05.md) for remote ledger versions and observed outcomes. The empty-schema evidence above describes the pre-application snapshot.

| Order | File | SHA-256 |
|---|---|---|
| 1 | [20261104232715_identity_memory_foundation.sql](../supabase/migrations/20261104232715_identity_memory_foundation.sql) | `B7A9A3566CBFB27DE42C371AE6ACBF48CA39245E9FDA86DBCA0AA6810A85EE3A` |
| 2 | [20261105001704_tool_execution_records.sql](../supabase/migrations/20261105001704_tool_execution_records.sql) | `6DBD694C3D5CC9FDF935BCEF2BF5ABAC768268006A0B140A8F49DF13C49443CF` |

Migration 1 creates eight personal customer tables:

1. `sadeeman_conversations`: ownership, creation time and bounded extractive summary.
2. `sadeeman_turns`: confirmed answer, usage counts, request idempotency and conversation reference.
3. `sadeeman_messages`: actual successful user/assistant messages.
4. `sadeeman_consents`: scoped/versioned acceptance and immutable revocation history.
5. `sadeeman_memories`: explicit opt-in preferences, source conversation, expiry and correction version.
6. `sadeeman_requests`: request fingerprints/resource references for durable mutation deduplication.
7. `sadeeman_audit_events`: action/resource/time metadata, without message or preference contents.
8. `sadeeman_session_revocations`: durable application logout by verified session ID.

It adds owner/provenance foreign keys, indexes, RLS + FORCE RLS, SECURITY INVOKER application RPCs, consent guards, and two narrowly scoped private SECURITY DEFINER helpers: owner-checked audit insertion and owner-checked memory erasure (including expired/revoked rows hidden by SELECT policies). These helpers use empty search paths; no generic elevated SQL executor is exposed.

Migration 2 adds `sadeeman_tool_executions`, with RLS + FORCE RLS and three SECURITY INVOKER RPCs. It records only actual tool name, call/run/conversation IDs, result status/code, measured duration and time. It stores **no arguments, tool payload, prompt, secret, contact information or hidden model reasoning**. Completed turns and tool metadata commit atomically. Failed turns can retain their actual tool-attempt metadata without claiming a successful answer.

Tenancy is personal (`tenant_id=owner_id=auth.uid()`), not organization/team membership. Unauthenticated roles receive no access. A customer's JWT cannot read or alter another customer's rows. No service-role key is used by normal application requests.

## What execution will do

After your explicit approval of these files **for this project only**:

1. Re-read Sadeeman's tables/migration history and verify the two approved file hashes have not changed.
2. Apply migration 1, then migration 2, using the Supabase migration tool with project `ujdzysbowngtkwndgoqf`.
3. Inspect actual tables, policies, function permissions and migration history; re-run security/performance advisors.
4. Verify two distinct non-PII Auth test users through the real Auth API and verify direct PostgREST RLS as well as application ownership checks.
5. Verify history after a server restart, consent, memory correction/deletion, actual tool traces, refresh and application logout.
6. With Gemini configured locally, verify real model catalog access, actual multi-turn answers, model-directed tool execution and streaming. No scripted model responses are used in live verification.

These are additive schema changes against the currently empty target. They do not drop/recreate tables, overwrite existing data, modify other projects, create another Supabase project, or enable paid services. DELETE statements inside the reviewed functions implement user-authorized erasure later; migration execution itself does not invoke them. If one migration fails, stop and inspect; do not issue destructive cleanup SQL.

No CRM tables/actions, booking/payment integration, outbound message, voice endpoint, public deployment, background schedule or 3D frontend is included. The owned conversation and tool-run identifiers form a future CRM integration boundary without activating CRM now.

## Separate runtime configuration

No database password, `DATABASE_URL`, service-role key or custom JWT signing secret is required for the application's current path. It needs:

```dotenv
NODE_ENV=development
PERSISTENCE_MODE=supabase
SUPABASE_PROJECT_REF=ujdzysbowngtkwndgoqf
SUPABASE_URL=https://ujdzysbowngtkwndgoqf.supabase.co
SUPABASE_PUBLISHABLE_KEY=<enter locally, never in chat>
MODEL_PROVIDER=gemini
GEMINI_API_KEY=<enter locally, never in chat>
GEMINI_MODEL=<choose from the authenticated model catalog>
ENABLE_REAL_PROVIDER=true
ENABLE_PROVIDER_STREAMING=true
ALLOW_SYNTHETIC_PROVIDER_DATA=false
FALLBACK_PROVIDERS=
```

The old synthetic-input opt-in is now rejected outside explicit `NODE_ENV=test`. This setting never supplied fake model responses; live verification always calls real providers. `providers:check --live --synthetic` selects a separate test-input process explicitly; ordinary chat uses public nonsensitive input and a real provider.

Enter secrets through the masked Windows helper:

```powershell
pwsh -NoProfile -File .\tools\configure-cloud.ps1 -Service Gemini
pnpm gemini:models
pwsh -NoProfile -File .\tools\configure-cloud.ps1 -Service Gemini -Model THE_EXACT_SELECTED_MODEL
pwsh -NoProfile -File .\tools\configure-cloud.ps1 -Service Supabase
```

The Supabase helper is locked to the verified ref above. `.env` is ignored and receives a protected ACL for the executing account, workspace owner and LocalSystem; no key value is printed. Leave a hidden key prompt blank to preserve an existing value. `-UseExistingKey` skips the hidden prompt when only public settings need updating. A model-list response proves only catalog authentication, not successful generation or tool compatibility.

For the two-user verification, anonymous sign-ins must be enabled in this dedicated project's Auth settings and `ENABLE_SUPABASE_GUEST=true` set locally. That Auth setting is separate from the SQL migrations; no Auth setting has been changed. Test verification may create two guest Auth identities without email/phone and exercise consented test rows; no privileged deletion of Auth accounts is included.

## Approval boundary

**Approved and applied unchanged.** The first request was declined; the user then reviewed the [read-only safety report](MIGRATION_SAFETY_REVIEW.md), renewed approval and both migrations succeeded. [Current verification results](reports/CLOUD_APPLY_AND_PROVIDERS_2026-11-05.md) record the actual Cloud/Gemini pass and remaining provider blockers. No additional schema mutation, paid upgrade, deployment, CRM/outreach or unrelated-project change is authorized by that approval.
