# Database migration status

Dedicated project only: `ujdzysbowngtkwndgoqf`.

Approved original migrations remain in the canonical root directory; do not change their bytes or replay them. The owner confirms session migration `20261105154454` is deployed and officially recorded; seven Cloud contract checks and core two-user checks passed; guest B was deleted with sessions gone. Session file SHA256 remains `770237AB233569FF25899BB4611F0A62D6C98EBB88B08E95B9D0BE6593F47AA0`.

## New local-only CRM migration

`supabase/migrations/20261106094526_crm_approval_workspace.sql` was created with the pinned official CLI and applied **only to disposable/local PostgreSQL databases**. It adds four CRM tables, indexes, FORCE RLS policies, private membership/transaction functions and a restricted public RPC wrapper. It neither replaces the session validator nor alters existing conversation/memory/catalog tables. Its scoped DELETE/UPDATE statements implement owner-directed CRM operations; no remote execution occurred.

Review this file's final hash with `Get-FileHash` before proposing Cloud execution. The root migration directory is also used locally; **do not run bulk db push**, because the historical version mappings differ:

Final local CRM SQL SHA256: `A111DFB6146132BABDF92381FA0C80C9CA38EEAA067C1C6872E311BBF23E8338`. This is source verification, not permission to execute it remotely.

- Local identity `20261104232715` → Cloud `20261105005039`.
- Local tool records `20261105001704` → Cloud `20261105005048`.
- Local catalog `20261105144113` → Cloud `20261105152213`.
- Session `20261105154454` already recorded; do not repair it again.

The unrelated performance proposal remains in `supabase/migrations/proposed/`; it was not applied. Local migrations enforce checksums and stop if an already-applied local file changes. Do not erase a user's existing database to bypass a checksum error. Use a fresh disposable directory for synthetic QA, or design a new reviewed forward migration.

The legacy read-only session verifier now scopes its original eleven-table contract explicitly; CRM's four FORCE RLS tables have separate local regression coverage. This is not new remote verification evidence.
