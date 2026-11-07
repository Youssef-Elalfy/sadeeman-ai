# Retired migrations — never apply

`20261106094526_crm_approval_workspace.sql` was retired on 2026-11-06 by the owner's product-scope correction: SADEEMAN AI is a conversational AI assistant, **not a CRM**. The customer, lead and staff feature was removed from the API, contracts, UI and tests.

- **Cloud:** it was **never applied** to project `ujdzysbowngtkwndgoqf`. Do not apply it.
- **Local:** the runner (`apps/api/src/persistence/local.ts`) applies only files directly inside `supabase/migrations/`. New local databases no longer receive these tables. An existing local database under `.private/` that already applied it keeps its CRM tables and ledger row untouched. Nothing was dropped, to avoid destroying local data. Dropping them later is optional and must be a deliberate, separately approved local step.

The file is kept unchanged (SHA256 `A111DFB6…8338`) as an audit record only.
