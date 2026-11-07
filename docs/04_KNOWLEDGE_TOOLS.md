# 04 · Travel domain, tools and RAG

## Evidence ladder
1. Authenticated supplier API reservation/availability response **if and only if authorized and live**.
2. Approved up-to-date internal company catalog records, with fictional DEMO flag for test seed.
3. Official government/tourist authority primary source for visa, entry restrictions and advisories, with retrieval timestamp.
4. Named third-party search/listing with canonical URL, source timestamp, advertised price basis and UNVERIFIED inventory.
5. Model general knowledge or generated **estimate** with assumptions and uncertainty.

## Tools
Every tool: name/description, input/output Zod schemas, authorization policy, deadline, output byte/token cap, source classification, trace record, cost budget, test cases.

**Company tools:** search/query by destination, duration, traveler mix, budget and interests; get details and compare; check departures ONLY against actual DB departure rows, never infer availability from static page text.

**Research tools:** source-based destination guide; search current external offers; official visa/advisory checks; forecast weather (not climatology unless clearly labeled); currency conversion when explicitly sourced with timestamp. Respect service ToS and robots restrictions. No CAPTCHA bypass.

**Planning tools:** deterministic budget aggregation + explicit per-person vs total prices; itinerary with travel time feasibility; recommendations personalized to user-stated interests. Do not invent flight numbers, hotel inventory or schedules. Show realistic alternatives when evidence is limited.

**Security:** sanitize tool inputs and URLs, block SSRF/private IPs/redirect abuse, treat HTML/snippets as UNTRUSTED, cite canonical publisher, never execute user-supplied code, don't let search pages trigger memory writes or CRM mutations.

**RAG architecture:** structured company costs/date fields stay in SQL. Optional document pipeline for policy/FAQ text: upload validation -> text extraction -> chunk + metadata -> embeddings -> vector+lexical hybrid retrieval -> source citations -> freshness refresh schedule later, only after approval for automated processing. RAG is not a knowledge truth oracle. Evaluate answer faithfulness and leakage.

## External research metadata
- `retrievedAt` as ISO 8601, `publishedAt` when known, canonical `sourceUrl`, display name and `status='external_listing'`.
- Prices numeric only when publisher actually states numeric + currency + unit; don't derive from snippets when ambiguous.
- Separate `flights_only`, `hotel_only`, `package`, `activity`, `information` types.
- For missing sources, return `unavailable` without fake offers and offer an estimated trip plan.
