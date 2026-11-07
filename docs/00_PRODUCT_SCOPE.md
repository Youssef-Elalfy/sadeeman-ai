# 00 · Product charter and non-negotiable scope

## Product
**سَدِيمًا | SADEEMAN AI** is an independent, bilingual, conversational AI travel concierge for a fictional agency demo. Its purpose is to give trustworthy travel guidance and convert genuinely interested visitors into permissioned inquiries, not to conceal that it is AI.

### User journeys
1. New traveler describes an idea in Egyptian Arabic, the agent naturally elicits practical constraints one at a time, compares evidence-based options, and creates an itinerary estimate.
2. Traveler asks about company-managed program; agent reads actual rows in database, explains pricing basis, conditions, departures (only if known) and adds a quote request after explicit review and consent.
3. Traveler asks about Japan/Italy/any destination outside company catalog; agent searches reliable public data/supplier results, clearly marks third-party listings as unverified, and can propose a generic itinerary when real results are absent.
4. User sends audio; agent exposes transcript for confirmation before asking the same core agent to answer. Optional voice response. Live duplex only after true capability test.
5. User goes off-topic; agent responds usefully throughout instead of forcing travel redirects; later return to context when asked.
6. Admin with correct permissions sees lead status and summarized travel needs; real customers never see one another's data.

## Non-goals
Not a flight ticket booking engine, not a payment processor, not visa issuance, not a marketing tourism website, not a covert salesperson or human impersonator, not generalized autonomous browsing without tool bounds, not a production-ready private-data processor on unreviewed free models. Business automation, outbound campaigns and scheduled agents are completely out of scope. There is no future automation milestone.

## Development priority
Correctness > privacy > trusted sourcing > customer experience > voice > visual effects. A smooth animated ornament cannot replace authentic answers.

## Separation
This project's official name, visual identity, code, database and environment are **not** shared with MASAR, RAHHAL, NAVORA or previous projects. Before any remote connector interaction, verify target project ID and permissions.

## Product outcomes to measure
- Useful answer rate, correct tool choice, source validity/freshness, user-requested clarification accuracy.
- Rate of valid consented lead submissions, not number of aggressively collected contacts.
- End-to-end completion rate, median/p95 response latency, tool outage recovery and free-tier quota behavior.
- Voice transcription word/key-entity correctness with held-out Egyptian Arabic; accessible mobile usability.

