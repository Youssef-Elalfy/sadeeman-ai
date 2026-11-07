# Session security — single remaining Cloud procedure

**Final acceptance update, 2026-11-06:** the owner confirms migration `20261105154454` is now officially recorded and guest B and its sessions are deleted. The history-repair and B-cleanup steps below are historical: **do not run them again**. Auth settings returned HTTP 200 during final execution. Controlled claim/expiry testing is still blocked by the absence of a supported privileged probe and safe administrative Auth cleanup path; no new identity was created. See the current [final acceptance report](reports/M3_FINAL_STABILIZATION_AND_ACCEPTANCE.md). Do not repeat the seven completed contract checks or the completed audit.

Scope: Sadeeman project `ujdzysbowngtkwndgoqf` only. The session migration is already manually deployed. **Never replay it.** Current acceptance decisions are in [the consolidated report](reports/M3_FINAL_STABILIZATION_AND_ACCEPTANCE.md).

**2026-11-06 update:** the owner confirms all seven deployed security contract checks passed. Reuse that evidence; the definition-audit instructions below are historical and must not be repeated. The next Cloud work is scoped B identity/ownership verification and cleanup, followed by controlled temporary-fixture claim/expiry checks and cleanup. A minimal supported CLI identity/history query failed DNS resolution both inside and outside the sandbox; do not retry that channel without a material access change. No Cloud fixture or cleanup write was attempted. Only after a current ledger check may the single-version history repair below run, with explicit approval. Current advisors/private-schema exposure and the separately approved, quota-confirmed live budget-follow-up remain pending.

**Approval recorded 2026-11-06:** the owner explicitly approved the conditional history-only repair of version `20261105154454` on `ujdzysbowngtkwndgoqf`. This approval persists; do not ask again for the same operation. Execution remains blocked until working Cloud access and a read-only ledger check confirm the entry is missing. Skip a correct existing entry; stop on conflict. Preserve all other entries and never replay the migration SQL. This does not authorize live provider calls. No remote action was attempted when recording this approval.

1. In the existing Sadeeman SQL Editor, confirm the project ref in the dashboard URL. Run the entire [single read-only script](../supabase/verification/session_boundary_read_only.sql). No credential setup, connection repair, new schema or permission change is required.
2. Return the final `session_security_verification` JSON. Inspect the deployed bodies/ACLs and every full RLS predicate against the canonical migration. All structural checks must be true, but those flags do not replace review of policy expressions, extra policies/signatures and grants. The approved file SHA256 remains `770237AB233569FF25899BB4611F0A62D6C98EBB88B08E95B9D0BE6593F47AA0`.
3. The script reuses only four allowlisted temporary owners from prior local test manifests. It creates no user/session and changes no Auth row. If a valid, empty, unrevoked temporary session exists, controlled SQL claims test missing session_id, expired exp, nonexistent session and restored continuity. It returns BLOCKED when no valid baseline exists. This is SQL-validator evidence, not a minted/expired signed JWT request. Auth not_after expiry is not mutated or falsely marked tested. If blocked, obtain one approved active temporary fixture through the existing test infrastructure before a later test; do not use production identities or weaken RLS.
4. Review `test_b_cleanup`. If the user/session is absent, record that evidence. If still present, use existing authorized administrative access to clean up only the known temporary B identity after matching its recorded creation window and anonymous status, and reviewing all remaining resources. Stop if ownership, upgraded identity or data is uncertain. The script itself performs no deletion. Existing public runtime credentials cannot perform administrative user cleanup.
5. Read current Security Advisors in the same project's dashboard and record codes/counts. No Auth toggle, paid feature, policy change or index removal is part of this procedure. Previously recorded eleven intentional guest warnings and the Free-plan leaked-password limitation are historical until rechecked.
6. Reuse the verified deployed definitions and inspect current migration history after access becomes available. If version `20261105154454` already exists correctly, no repair is needed. If absent, the owner's recorded conditional approval covers only the single history-only operation below. A conflict requires review, not overwrite.

## History-only repair — conditionally approved, not executed

Official [repair reference](https://supabase.com/docs/reference/cli/supabase-migration-repair) and [implementation](https://github.com/supabase/cli/blob/main/apps/cli-go/internal/migration/repair/repair.go) distinguish recording an applied version from executing its schema SQL. The pinned CLI is 3.0.0; its inspected help and [v3 notice](https://supabase.com/changelog) require an explicit hosted target.

~~~powershell
# Future read-only comparison, after secure authorized CLI access is established:
pnpm exec supabase migration list --remote=ujdzysbowngtkwndgoqf --workdir C:\Users\youss\Desktop\Sadeeman
# Approved history write ONLY after access works and the current ledger proves absence:
pnpm exec supabase migration repair 20261105154454 --status applied --remote=ujdzysbowngtkwndgoqf --workdir C:\Users\youss\Desktop\Sadeeman
~~~

Re-list afterward and verify that only this one history entry changed. Do not omit the version, use reverted/bulk repair, add --yes, run db push/reset/up or replay SQL. Do not put passwords or keys in chat/logs.

Preserve the existing mappings: local 20261104232715 → Cloud 20261105005039 (identity); 20261105001704 → 20261105005048 (tool records); 20261105144113 → 20261105152213 (catalog). A session history repair does not resolve those historical mappings and must not rewrite them.

The SQL report's record counts are current observations, not retroactive proof of preservation without a prior baseline. Schema ACLs alone do not prove Data API non-exposure; the latest unauthenticated profile probe was inconclusive. The recorded history-only approval followed the owner's confirmation of all seven deployed contract checks; it does not establish current ledger contents or successful execution.
