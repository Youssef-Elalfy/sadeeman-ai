# Session hardening — local completion and read-only Cloud handoff

2026-11-05, Africa/Cairo. **Local gate PASS: 233/233 tests in 21 files; build, typecheck and lint PASS.** This task is local only. No Computer Use, browser automation, Supabase connector retry, remote SQL/write, migration replay, migration repair, Auth change or live AI/search call occurred.

## Done

- Promoted the already approved SQL unchanged from `supabase/migrations/proposed/20261105154454_session_boundary_hardening.sql` to the canonical `supabase/migrations/20261105154454_session_boundary_hardening.sql`. Only one executable copy exists. SHA256 remains **`770237AB233569FF25899BB4611F0A62D6C98EBB88B08E95B9D0BE6593F47AA0`**. The original three migration hashes and the separate, still-unapplied performance proposal hash are unchanged.
- `supabase/migrations/deployment-status.json` records user-reported manual deployment, pending full independent comparison/two-user verification and unverified/unrepaired history. It does not pretend to be the remote ledger.
- `supabase/verification/session_boundary_read_only.sql`: a concise 81-line inspection script returning one JSON metadata report in a read-only transaction. It compares approved validator/wrapper body SHA256 values, displays all four affected function definitions/ACLs, checks role privileges and Auth-table/column access, shows RLS/FORCE flags, full policies, prerequisite column metadata and the actual history. No customer rows, Auth session records, credentials or application RPC invocation. Policy expressions still require review against the approved source.
- `docs/SESSION_SECURITY_VERIFICATION_AND_HISTORY.md`: exact review instructions, limits, current pinned CLI 3.0.0 syntax and an unexecuted one-version history repair workflow. No history-change approval is requested now.
- `tests/session-verification.test.ts`: four additional local checks verify canonical hash/no duplicate, execute the report under read-only PostgreSQL, detect changed function code and an unintended EXECUTE grant, and reject historical schema fixture selection outside tests.
- Local migration loading now includes the canonical approved session file. Existing regression fixtures use real session IDs/expiry; baseline exploit/preservation tests explicitly select the old schema in automated tests only. No assertion was removed or weakened. Neither an existing developer database nor Cloud was opened by these tests.

The migration's immutable proposal-era comment remains inside the file to preserve its approved bytes. Current status overrides that comment: manually applied according to the user, **not to be replayed on Cloud**. Normal local development uses the root migration list; the unrelated performance proposal is still excluded.

## Verified — commands and actual outcomes

| Command | Result |
|---|---|
| Resumed the previously interrupted full test session | 229/229 PASS in 20 files; 114.55 seconds. This was observed rather than inferred |
| `pnpm exec vitest run tests/session-verification.test.ts tests/session-validity.test.ts tests/security-hardening.test.ts tests/database.test.ts --maxWorkers=1` | 65/65 PASS in four files, 74.50 seconds |
| `pnpm build` | PASS, both workspace packages |
| Final `pnpm typecheck` | PASS, contracts/API plus strict tests/tools compilation after the result parser correction |
| Final `pnpm lint` | PASS, 76 files, no fixes |
| Final `pnpm test --maxWorkers=1` | **233/233 PASS in 21/21 files**, no skips; 210.49 seconds, started 22:36:38 Africa/Cairo. All previous 229 tests preserved |
| `Get-FileHash supabase/migrations/*.sql,supabase/migrations/proposed/*.sql -Algorithm SHA256` | Four canonical files and one separate proposal checked; all reviewed source hashes match |
| Workspace-local `SUPABASE_HOME`; `pnpm exec supabase --version` and `migration repair --help` / `migration list --help` | 3.0.0; actual help confirms explicit `--remote=<ref>` target. Help/version only; no remote command executed |

An initial new-test type annotation used a generic on PGlite.exec, which does not accept one. It was replaced with Zod parsing of unknown result rows; no any cast or validation weakening was used. Biome excludes `supabase/` metadata from its configured file scope; SQL correctness is instead exercised in PostgreSQL. The standalone attempt to format the ignored JSON processed zero files and changed nothing.

## Cloud evidence and pending acceptance

The user's independent checks report validator/wrapper presence and rejection without a valid JWT. These are recorded as user-provided Cloud evidence. This task makes no new hosted verification claim. Unauthenticated gateway rejection alone does not prove that a valid signed principal with a missing/nonexistent/expired/revoked session is rejected or that cross-user revocation is blocked.

| Gate | Status / exact remaining work |
|---|---|
| Local correctness | **PASS:** 233/233 tests, build, typecheck and lint. Embedded PostgreSQL is not hosted Auth evidence |
| Deployed definitions and permissions | **Pending:** review the supplied Cloud metadata against the canonical file, including exact bodies, full policy predicates, ACLs, owner/search_path, overloads and Auth prerequisites |
| Two-user Cloud regressions | **Pending:** real distinct authenticated guests; legitimate owner persistence, denied foreign-session revocation, victim remains active/can revoke, failed missing/nonexistent/expired/revoked sessions, no cross-owner reads/writes; verify refresh/second-session continuity |
| Existing Cloud data preservation | **Pending:** conversations, messages, consent, memory, catalog and ownership compared to suitable previous evidence, without logging user contents or changing customer records. Local before/after tests passed, but cannot retroactively prove hosted preservation |
| Current security advisors | **Pending:** fresh advisor run and review of any new findings. Last audit had eleven intentional anonymous-Auth warnings plus the Free-plan leaked-password limitation; these are historical, not freshly cleared |
| Private schema API exposure | **Unverified:** catalog schema ACLs do not prove hosted Data API exposure settings; inspect this before production |
| Migration history | **Pending verification, not repaired:** read the actual ledger. If the session version already exists correctly, no change is needed. Only after deployed definitions are verified may a specific history-only change be proposed if needed. Existing three version mappings must remain intact |

Full session hardening acceptance is **not yet complete**. No newly observed Cloud vulnerability is alleged; the pending tests and prior separate production risks must not be marked resolved without evidence. Guest warnings and Free-plan password protection limitations are not fixed by deleting guest access or adding broad grants. Existing owner-write/trace-integrity concerns remain separate from this session patch.

## Next

The next Cloud step is the supplied **read-only** report in the Sadeeman SQL Editor, with the exact project ref independently confirmed. Review its metadata first. Then arrange the still-pending bounded two-user and data/advisor checks. This handoff does not request or execute any migration-history change. No live AI provider test or unrelated milestone is included.
