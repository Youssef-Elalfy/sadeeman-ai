# 06 · Consent-first memory and CRM

## Separate lifetimes
- Short conversation context: only session's recent messages and bounded summaries; no opt-in needed beyond application terms for necessary operation.
- Long-term customer preferences: **explicit opt-in** by purpose; store only helpful nonsensitive travel preferences, with correction/delete, TTL and provenance.
- Lead/quote: separate explicit, specific review and approval before saving and sharing name or phone with staff.
- No hidden cross-conversation tracking from cookies, and no cross-user retrieval.

## Minimal schema requirements
`consents(id, user_id, purpose, accepted, version, recorded_at, revoked_at)`
`memories(id, owner_id, category, content, provenance, ttl, consent_id, created_at, updated_at)`
`leads(id, organization_id, owner_id, status, name, contact, travel_summary, consent_id, created_at)`
`quote_requests(id, lead_id, approved_snapshot, status, idempotency_key, created_at)`
`handoffs(id, lead_id, staff_id, consent_id, status, summary, created_at)`
Apply migrations, field minimization, encryption where appropriate, RLS, server-side RBAC, idempotency unique constraints and audit events. Hash/sanitize logs.

## Lead funnel example
Casual travel chat -> understand destination and date -> clarify party/budget -> offer useful comparison -> ask if user wants quote -> show pre-filled review summary -> explain why contact needed -> user explicitly confirms -> server runs `create_lead` and `create_quote_request` within transaction -> returns IDs -> UI acknowledges exactly what was stored. Denial means no write and conversation continues.

## No hard-coded manipulative sales scoring
Lead readiness can be classified via observable intent (requested quote, selected destination, travel date), not perceived personality, protected characteristics, ethnicity or inferred purchasing vulnerabilities. Never invent 'last spot' urgency or shame a customer into sharing a phone number.

## Test matrix
- Opt-in memory stores and appears on new session to correct user, with correct tenant.
- Opt-out memory does not store; revocation prevents further retrieval; delete fully makes it inaccessible.
- Different user cannot fetch preference via guessed ID.
- Lead action without approval yields no insert; two retries with same idempotency key produce one record.
- Invalid phone does not persist; customer contact never appears in tool logs or public analytics.
- Handoff indicates pending/assigned only after server confirms record and staff state.
