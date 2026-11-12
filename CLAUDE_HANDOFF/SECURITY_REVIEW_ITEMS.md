# Security review boundary

Preserve strict Zod parsing, source-span grounding, owner checks, session validation, RLS/FORCE RLS, restricted function ACLs and consent. Never grant broad access to remove an advisor warning. Do not request or log production secrets, headers, contact contents or audio.

CRM uses four FORCE RLS tables. Clients have SELECT policies but no table mutation grants; restricted RPCs enforce session ownership, exact reviewed consent, expiry, idempotency, optimistic concurrency, staff membership and assignment. Workspace owners may authorize staff only in their own workspace. Audit contains metadata, not contacts or summaries. Rejected or cancelled reviews cannot save records. Contact uniqueness is owner-scoped, so another owner cannot probe a global address index.

Review before production:

- New CRM migration definitions and all SQL/RLS/ACL paths against a real hosted staging environment, only after owner approval.
- Private-schema Data API exposure and current hosted advisors if authorized; historical warnings are not newly cleared. Prior audit: eleven guest-policy notices and a Free-plan leaked-password feature limitation, not twelve demonstrated access vulnerabilities.
- Controlled signed/SQL session claim and expiry acceptance with guaranteed fixture cleanup.
- SessionStorage tokens versus an HttpOnly BFF design, CSP and any production multi-origin deployment. Current loopback-only development posture and production startup block remain deliberate.
- Physical erasure of expired CRM snapshots/records and disk encryption before private customer data is approved. There is no retention scheduler or business automation.
- Audio magic/size checks are a bounded upload boundary, not full media-decoder validation; actual duration is enforced in the recorder, not inferred securely from every uploaded container. Test malformed containers and provider cancellation on real infrastructure before release.

No Cloud schema/Auth/history changes were performed in this delivery. Do not rerun the approved session migration.
