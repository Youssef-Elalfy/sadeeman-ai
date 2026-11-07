# Unapplied migration proposals

Only explicitly selected local development/tests read SQL from this directory. Unapproved proposals must stay out of the root migration list.

The M3 company catalog/context migration was applied to Sadeeman on 2026-11-05 and promoted unchanged to `../20261105144113_company_catalog_travel_context.sql`. Its immutable original comment refers to its former proposal state; the Cloud ledger and application report record actual status. No SQL contents or approved hashes changed.

The approved session hardening file was also promoted unchanged to `../20261105154454_session_boundary_hardening.sql` after user-reported manual Cloud execution. Do not rerun it remotely. Full Cloud definition comparison, two-user tests and migration-history reconciliation remain pending; see `docs/SESSION_SECURITY_VERIFICATION_AND_HISTORY.md`. Only the unapplied catalog/index performance proposal remains here.
