# Session security — bounded Cloud verification result

2026-11-05, Africa/Cairo. Project **Sadeeman `ujdzysbowngtkwndgoqf` only**. The approved migration was **not rerun**. Migration/history/configuration changes: **0**. AI/search/provider calls: **0**. No Computer Use, browser automation or unavailable connector retry occurred.

## Actual Cloud execution

1. Existing `tools/cloud-preflight.ts`, with a bounded read-only fetch guard and Node `--use-system-ca`: Auth settings **200**, configured runtime key accepted, anonymous sign-in enabled; unauthenticated PostgREST **401 / 42501**. Two requests, no writes or identities created. System certificate validation stayed enabled; no TLS bypass. This does not prove the cause of earlier unclassified network failures.
2. New `tools/verify-session-cloud.ts` uses the existing `SupabaseDatabase` and `Repository`, real Auth/PostgREST and strict Zod parsing. No model/search adapters or privileged client. Actual command:

   ```powershell
   node --use-system-ca --env-file-if-exists=.env tools/verify-session-cloud.ts --live --test-data --database-only
   ```

   Limits: **2 new test guests, 48 network requests, 120 seconds, zero network retries**; only the pinned project's allowlisted Auth and data routes. Actual run: **33 requests, 13.640 seconds, 2 guests**. No rerun followed the stop.

Raw evidence is preserved unchanged in [SESSION_CLOUD_TWO_USER_2026-11-05.json](SESSION_CLOUD_TWO_USER_2026-11-05.json); preflight evidence is [SESSION_CLOUD_SECURITY_PREFLIGHT_2026-11-05.json](SESSION_CLOUD_SECURITY_PREFLIGHT_2026-11-05.json). These contain safe stage/route/status metadata, no tokens, headers, emails or customer contents. Tokens remained only in process memory; non-secret test object IDs are in the scoped ignored `.private/session-cloud-<runId>/test-ids.json` for any later authorized cleanup review.

| Security check | Actual result |
|---|---|
| Two different authenticated guests and session IDs | **PASS**, real Auth and application identity RPC |
| Owner conversation access | **PASS**, each read its own newly created synthetic conversation |
| Cross-user conversation isolation | **PASS**, both foreign-owner direct PostgREST reads returned empty arrays |
| A attempts to revoke B's known session UUID | **PASS**, **403 / SQLSTATE 42501**; B subsequently authenticated successfully |
| Legitimate continuity | **PASS**, A refreshed successfully, retained the same owner/session UUID and restored its conversation through a newly instantiated client; B retained its own access |
| Victim can revoke its own application session | **PASS**, B's revoke RPC succeeded, wrapper returned false and authentication returned UNAUTHORIZED |
| Another user's session remains usable after B's revocation | **PASS**, A authenticated successfully |
| Removed Auth-session row with an otherwise unexpired, signed JWT | **PASS**, A's scoped Auth logout returned **204**; the wrapper then returned **false** for the same still-unexpired JWT and authentication was denied |
| Synthetic conversation cleanup | **PASS**, both newly created conversations were deleted through their owners before sign-out |
| Both Auth-session cleanups | **PARTIAL**, A sign-out confirmed; B's application session is revoked but its final Auth sign-out was not sent because the guard halted |
| Actual expired signed JWT / Auth not_after boundary | **NOT RUN**, no expired controlled fixture was supplied or exercised; the run did not wait for issued tokens to expire. Their original TTL was not recorded, so no specific TTL is claimed. No token payload, Auth row, project expiry setting or clock was altered to manufacture a result |
| Valid signed principal with missing session_id | **NOT RUN**, requires a controlled fixture/SQL claim test. No-JWT gateway rejection is a different check |

## Why the run stopped

Auth-session removal is inferred from successful scoped sign-out and Supabase's [documented session semantics](https://supabase.com/docs/guides/auth/sessions), together with rejection of the same still-unexpired JWT. No privileged SELECT of auth.sessions was performed in this run. The directly observed facts are logout 204, wrapper false and subsequent authentication denial.

The final Auth `GET /auth/v1/user` after A sign-out returned **403**. The harness allowed 400/401 for this negative test, so its HTTP guard marked the response unexpected and halted further network requests. The existing application adapter correctly mapped the Auth denial to UNAUTHORIZED, so the authentication assertion passed and the raw report's stage advanced to `cleanup_second_auth_session`; the next fetch was blocked locally, with **no B sign-out request sent**. The raw sequence locates the actual trigger at `auth_signout_removes_session_and_rejects_unexpired_jwt`.

This is a test-harness expectation issue observed at a denial boundary, not evidence of successful unauthorized access. The runner was corrected locally to accept Auth 403 **only in the post-sign-out denial stage** and to record the original unexpected HTTP stage/status in future evidence. The corrected runner was **not rerun live**. The original run remains `FAILED_OR_BLOCKED`; local correction does not retroactively mark it fully passed.

Two non-PII guest Auth accounts remain. B's application revocation record and normal test audit/operation metadata remain; privileged Auth-user or revocation deletion was not attempted. No existing customer conversation, memory, consent or catalog record was intentionally modified. This run used only its two newly authenticated owners and did not reverify all preexisting customer data or fresh advisors.

## Local verification

The original **233/233** baseline is preserved. `pnpm typecheck` and `pnpm lint` passed while preparing the runner (77 files); final offline regression results after the harness correction are recorded before handoff below. Production application code, migration SQL and dependency versions were not changed. The approved canonical migration SHA256 remains `770237AB233569FF25899BB4611F0A62D6C98EBB88B08E95B9D0BE6593F47AA0`.

After the harness correction: `pnpm typecheck` **PASS**; `pnpm lint` **PASS**, 77 files; `pnpm build` **PASS**, both workspace packages. The first full `pnpm test --maxWorkers=1` run completed with **219 passed / 14 skipped** in 230.39 seconds because the catalog suite exceeded its existing 30-second setup limit; cleanup then encountered ENOTEMPTY while initialization was still finishing. The isolated `pnpm exec vitest run tests/company-catalog.test.ts --maxWorkers=1` rerun passed **14/14** in 28.88 seconds. The final complete `pnpm test --maxWorkers=1` rerun passed **233/233 in 21/21 files**, no skips, **226.46 seconds**, started 22:59:54 Africa/Cairo. No assertion, test selection or timeout was weakened. These offline results do not change the recorded partial Cloud result.

## Acceptance and migration history

**Session security is not yet fully accepted. M3 live AI acceptance remains paused.** Remaining gates:

1. Complete the actual expired JWT/Auth-session expiry and valid-principal missing-session-claim Cloud checks using approved controlled fixtures. Earlier local PostgreSQL regressions and user-confirmed deployed logic are supporting evidence, not fresh Cloud boundary tests.
2. Review B's outstanding Auth-session cleanup and any scoped test residues. Its application session is already confirmed revoked. No cleanup retry or broader deletion ran.
3. Obtain current security-advisor/exposure results and any remaining hosted data-preservation evidence required by the existing acceptance plan. No new security warning is asserted or cleared without a current result.
4. Read the current migration ledger after the security gate is complete. The user's independent deployed-definition/permission checks are recorded as user-provided evidence; a complete source/ACL metadata export remains useful for exact reconciliation.

The existing [official CLI history-only reconciliation guide](../SESSION_SECURITY_VERIFICATION_AND_HISTORY.md) remains the safe candidate plan: inspect the exact target/ledger, stop on version conflict, and only if necessary propose **one** `migration repair 20261105154454 --status applied --remote=ujdzysbowngtkwndgoqf` operation. It does not replay schema SQL. Existing three local/Cloud version mappings stay untouched. **No history-change approval is requested now**, because full verification has not succeeded. Never run the migration again or use broad repair/db push to hide mismatches.

After the remaining security gate passes, M3 live acceptance additionally requires available provider quota and a separately approved bounded live evaluation. No AI test ran in this task.
