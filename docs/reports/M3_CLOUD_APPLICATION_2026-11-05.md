# M3 company catalog Cloud migration — applied and database-verified

2026-11-05, Africa/Cairo. **Cloud migration/database verification passed. Full M3 live model acceptance remains OPEN.** Dedicated Sadeeman project only: `ujdzysbowngtkwndgoqf`, eu-west-1, API `https://ujdzysbowngtkwndgoqf.supabase.co`.

## Done — exact source and application

The [read-only safety review](M3_CLOUD_SAFETY_REVIEW_2026-11-05.md) verified project identity, hashes, object conflicts, dependencies, grants, RLS, existing data fingerprints and advisors. The exact reviewed SQL was then submitted through Supabase `apply_migration`, which returned `success:true`. No substitute SQL or extra schema migration ran.

- Applied source, promoted unchanged after success: `supabase/migrations/20261105144113_company_catalog_travel_context.sql`.
- SHA256: **`4752202DF60641FBA0C2786A13D024F4C0BAB3E35E9E42F7057EF094976F62D4`**.
- Supabase-generated ledger: **`20261105152213 company_catalog_travel_context`**.
- The two original M2 files and ledger entries remain intact. Their recorded hashes still match. Local source timestamps and remote MCP-generated ledger timestamps differ, as they already did for M2; the mapping is explicit. Do not replay these files with a generic Cloud db push or repair the ledger as part of this task.
- The immutable SQL header retains its original proposal wording. Current application status is recorded here and in the Cloud ledger; the file's bytes were not changed to rewrite that comment.

Added two tables, their indexes/constraints, two policies and three invoker RPCs. All **eleven** public application tables now have RLS and FORCE RLS. All new functions have an empty search_path, authenticated execution and no anon execution. Catalog SELECT is allowed for active authenticated sessions; authenticated catalog INSERT/UPDATE/DELETE are denied. Profile writes require matching owner/tenant/session and an owned conversation.

Immediately after application, **before test writes**, the original nine tables' counts/content fingerprints, all nine original policies, six original functions, original grants and conversation keys matched the preflight exactly. No existing conversations, memories, consents or other records were overwritten or removed by the migration. The new catalog was empty.

## Verified — real Cloud database test

`tools/verify-m3-catalog-cloud.ts` is an explicit automated database-only harness. It uses actual Supabase Auth/PostgREST, the existing `SupabaseDatabase`, `Repository`, strict contracts, `PersistentCompanyCatalog` and tool registry. It has no model/search execution path and restricts outbound test requests to the pinned project's Auth/REST endpoints, with deadlines and an 80-request hard cap. Tokens/refresh tokens remain in process memory; keys/headers are never logged.

Executed:

```powershell
node --env-file-if-exists=.env tools/verify-m3-catalog-cloud.ts --live --test-data --database-only
```

Observed **PASS** at `2026-11-05T15:27:54.024Z`, **42 Auth/REST requests**, two distinct authenticated anonymous test identities, **zero model, Tavily or OpenRouter calls**. This is real Cloud database evidence; it is not live model-quality evidence.

The test inserted two NEW UUID/code records derived only from this project's existing fictional fixtures, with `isDemo=true`, explicit FICTIONAL DEMO titles and no commercial approval claim. No unrelated data or existing catalog record was imported/overwritten. One freshly created test identity temporarily received trusted demo-view metadata, solely for the automated positive-read test. Ordinary users, including the second test identity, could not see those records; setting user-editable metadata did not elevate access.

Actual tool sequence: **`search_company_packages` → `compare_company_packages` → `get_company_package`**. The tools read committed Cloud records through PostgREST. Search returned both test rows. Comparison preserved EGP/per-adult basis and the explicit two-adult party, computing totals **1,380,000 / 1,780,000 minor units**, respectively inside/outside the **1,600,000** test budget. Both rows remained `company_demo`, `bookable=false`, `liveInventory=false`; empty departure/activity arrays remained unknown. Ordinal details resolved the stored second option. A new client instance re-read the persisted record successfully.

Other observed passes:

- Authenticated catalog INSERT and UPDATE returned **403**, including the demo-authorized identity's attempted update. Schema ACL checks independently confirmed no authenticated DELETE permission. No booking or inventory capability was added.
- Both users independently created and persisted their own conversation/profile. Fresh clients restored each exact state; cross-user profile RPC reads returned NOT_FOUND. A direct other-user profile PATCH affected **zero rows**, leaving the owner's state unchanged.
- A stale expected version caused VERSION_CONFLICT and rolled back attempted messages/profile changes atomically.
- Deleting each test conversation removed its profile. Both test sessions were explicitly revoked; subsequent catalog access for the revoked session returned UNAUTHORIZED.

Cleanup removed **only the two newly inserted demo UUID/code rows** and the two temporary test metadata keys. Final counts: catalog **0**, travel profiles **0**, temporary demo claims **0**. Test conversations/messages are gone. The two anonymous test identities remain as revoked development test accounts; their metadata-only audit/revocation records are retained. Original pre-existing records match the original fingerprints after excluding these two new test owners. No earlier owner's data was altered.

Evidence: [integration results](M3_CLOUD_INTEGRATION_2026-11-05.json), [schema/preservation/advisors](M3_CLOUD_APPLICATION_2026-11-05.json), [preflight baseline](M3_CLOUD_PREFLIGHT_2026-11-05.json).

## Verified — local checks and configuration

| Command | Actual post-application outcome |
|---|---|
| `pnpm build` | PASS, both packages |
| `pnpm typecheck` | PASS, strict packages/tests/tools |
| `pnpm lint` | PASS, 69 files, no fixes/warnings |
| `pnpm test` | **170/170 PASS in 16 files**, 20.82 seconds |

No test was removed or disabled. The existing database ledger assertion now checks the exact three migration filenames, and its RLS check covers eleven tables instead of nine. This reflects the newly applied source while preserving the original assertions' coverage. Local migration checksum tracking uses the unchanged basename/content when the approved file is promoted out of `proposed/`.

After successful Cloud checks, the plan's three feature flags were enabled: `ENABLE_COMPANY_CATALOG=true`, `ENABLE_TRAVEL_CONTEXT=true`, `ENABLE_TRAVEL_CONTEXT_PERSISTENCE=true`; `ALLOW_CATALOG_DEMO=false`. Other environment settings and protected file ACL were preserved. A non-secret config inspection confirms Gemini primary, Groq fallback, retries **0**, OpenRouter **false**, Supabase persistence. The business catalog is empty until authoritative operator data is supplied. This task did not send any live model/search request.

## Advisor findings — actual post-application scan

**Security:** **12 WARN, 0 ERROR**. Eleven `auth_allow_anonymous_sign_ins` warnings, one per existing/new table, reflect the explicitly enabled guest identity workflow using the authenticated role. Private profiles/history still enforce owner/session/tenant predicates; company programs are intentionally shared published catalog data. Two new table warnings are added to the nine pre-existing guest-policy warnings. One pre-existing `auth_leaked_password_protection` warning remains. [Anonymous-access guidance](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0012_auth_allow_anonymous_sign_ins), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Registered-account/production hardening must review these; no Auth setting or old policy was silently changed.

**Performance:** one **WARN** `auth_rls_initplan` on `readable_company_catalog` because its JWT `current_setting()` expression is evaluated per row. [Remediation guidance](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan). Seven unindexed-FK **INFO** findings: six prior findings plus the new travel-profile `(conversation_id,owner_id)` FK; the existing profile PK and owner/conversation index are present, but the advisor does not count them as a covering composite index in the FK order. [FK indexing guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys). Two pre-existing unused-index **INFO** findings remain (audit owner/id, revocation owner). [Unused-index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

**Health:** zero findings. These results supersede the earlier historical zero-security-findings report. No claim of zero vulnerabilities or production readiness is made. The approved SQL was preserved; performance tuning or Auth/policy changes require a separately reviewed change. No index was dropped, no broad privilege was granted, and no additional DDL was applied to silence advisors.

## Blocked, next and approval needed

- **Cloud migration/database gate: passed.** No migration approval remains pending for this exact applied file.
- Real approved company programs/prices/schedules are still absent. The catalog remains empty rather than presenting test programs as commercial inventory.
- **M3 live acceptance remains OPEN:** first confirm relevant provider quota availability, then obtain separate explicit approval for the prepared bounded research/itinerary/budget-follow-up/correction evaluation (at most two basic Tavily searches). No automatic quota probes or retries are scheduled.
- Optional performance/production hardening findings above remain reported, not silently fixed; any further schema/Auth change needs review and approval.
- No CRM, Voice AI, premium 3D frontend, business automation, paid service, booking, outreach or deployment was started. Next remains completing M3 acceptance, not starting a later milestone.
