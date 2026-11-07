# Verified company-program ingestion — operator workflow

The actual Cloud catalog structure is ready and currently empty. It stores company programs separately from web listings and estimates. There is no supplier inventory/booking integration. No business program, price, departure or source is inferred from fictional fixtures. This task performs **no Cloud import**.

## Prepare and validate locally

Copy `templates/company-program.template.json` into a private project path such as `.private/catalog-intake/programs.json`. The template is intentionally **not importable**: UUID/day placeholders and reserved text must be replaced with actual data. Keep it draft until a human source review is complete. Do not put credentials, traveler details or customer documents in catalog fields.

Required basic fields: fresh UUID, stable unique program code, approved title/destination, integer duration. Description and nights may stay null. Unknown price/currency/verification time remain null, basis unknown; unknown departures/activities remain empty arrays. Do not substitute zero, guessed dates, destination currency, fixture text or apparent seat availability.

- Known prices use integer minor units and an explicit currency/basis (`per_adult`, `per_person`, `party_total`). A party-total amount needs the exact priced traveler count. Non-demo prices require a dated verification. Never automatically convert currencies, price children as adults, or multiply a party total by travelers.
- Dates use YYYY-MM-DD; end cannot precede start. Departure availability is always `unverified`. An activity day must fall within the program duration. Inclusion/exclusion text must come from approved company material.
- Real company records use `isDemo=false`. Published records require nonempty `approval.sourceRef` and ISO `verifiedAt`. This metadata is a provenance declaration, not cryptographic proof: an authorized operator must verify the company/source, price basis, currency, dates, exclusions and permission to publish.
- Fixtures remain under `fixtures/` and automated tests only. Authoritative ingestion rejects demo records, duplicate IDs/codes and unresolved placeholder prefixes. Source/model outputs cannot grant operator approval or write the catalog.

Run:

```powershell
pnpm build
pnpm catalog:validate --file .private/catalog-intake/programs.json
```

This validates structure only: no `.env`, database, API, network or writes. Success explicitly says `VALID_STRUCTURE_REQUIRES_OPERATOR_SOURCE_REVIEW`; output contains counts, not program/customer contents. Errors contain bounded field paths/codes without supplied values. The template correctly fails validation until filled. Project-path containment follows the real path, rejecting symlinks outside the project. Batch cap: 100 records / 256 KB.

## Review and import gate

1. Independently compare every field against authoritative company documents. Preserve missing facts; do not manufacture an approval reference. Record the source revision/date and confirm publication status. Decide the business freshness policy; a past verifiedAt is dated catalog information, not a live quote.
2. Keep a final approved JSON artifact and SHA256, list expected NEW IDs/codes, exact target project and intended draft/published status. Obtain explicit approval for a Cloud data import; this security audit and previous schema approval do not approve arbitrary future program records.
3. For **local** staging only, `pnpm catalog:import --local --file .private/catalog-intake/programs.json` uses the same strict batch boundary and insertion-only transaction. It reads only the three applied root migrations; it no longer opts into unapproved proposals. No Supabase client or hosted writer exists in this command.
4. A later approved Cloud operator operation must revalidate the artifact, reverify `ujdzysbowngtkwndgoqf`, check ID/code conflicts, and use a bounded transaction with parameterized INSERTs. No upsert, overwrite or conflict-ignoring behavior. Conflict/error must abort the batch and be reported. Never use a service-role key in a browser or give catalog write permission to customer/model roles.
5. Re-read the inserted records through the normal authenticated catalog tools. Verify values, source dates, explicit basis, unknown fields and `bookable=false`/`liveInventory=false`. Check demo/draft hiding and unauthorized writes. Inspect the source-grounded answer separately when live model acceptance is approved.
6. Any later update, publication, archival or deletion is a separately reviewed operator action on exact IDs and an expected current-document hash. Do not silently mutate existing programs to fix a failed import. Prefer reviewed archival for a stale offer; no automatic cleanup/outreach/scheduled refresh is introduced.

The database enforces core shape/publication/demo/ownership constraints; the full CompanyPackage/AuthoritativeCatalogBatch validation is stricter. An administrator can bypass application schemas, so data ingestion must run the validator and human review before administrative SQL. Normal authenticated users have catalog SELECT only. Shared published programs are intentionally readable by authenticated guests; confidential business material must not be published into this shared catalog.

## Readiness and remaining input

Ready: structured persistent records, strict ingestion validation, insertion-only local staging, search/filter/detail/comparison, dated price basis, classifications, owner-private conversation state, and verified Cloud RLS. Not supplied: authoritative company programs/prices/schedules and an approved business-data artifact. Therefore the real catalog remains empty. A valid template or passing structure check is not proof of a commercial offer, availability or a booking.
