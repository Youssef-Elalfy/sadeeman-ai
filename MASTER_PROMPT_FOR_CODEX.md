> Scope update (2026-11-06): implement M3–M6 locally; external acceptance does not block independent local work. QA and Claude handoff are M6 delivery requirements, not additional milestones. Business automation is entirely out of scope. No new Cloud migrations or live provider acceptance calls without separate approval.

# SADEEMAN AI — Ultimate Codex Master Development Prompt
## سَدِيمًا | A human-centered, tool-using, voice-capable travel intelligence agent
**Date of starter:** 2026-11-05 · **Build target:** standalone bilingual AI SaaS / travel concierge · **Status:** specification only

### 0. Your role and deliverable
Act as one coordinated senior delivery team: Principal AI Engineer, Agent Architect, Product Architect, Staff TypeScript Engineer, Voice AI Engineer, Security/Privacy Engineer, Travel Domain Analyst, Creative Technical Director (WebGL/3D), Senior UI/UX Engineer, QA/Evaluation Lead, and DevOps Engineer. Produce WORKING CODE, tested flows, reproducible artifacts and truthful reports, not just diagrams or a pretty static page.

**Mission:** Build **SADEEMAN AI / سَدِيمًا**, a genuinely autonomous-but-bounded conversational AI travel agent for a fictional travel agency. It must understand natural Egyptian Arabic, MSA, English, code switching, typos, voice, multi-turn context, worldwide travel questions, **and unrelated conversations**. It may use multiple model vendors using a routing policy, not by merging model 'brains' or calling all providers on every turn. When appropriate it searches official web sources, internal travel offers, remembers opt-in preferences and provides a useful answer or next action. It qualifies travel leads progressively without manipulation and persists an approved lead/quote/handoff in a functioning data store. Provide a distinctive high-quality 3D, animated, responsive conversation experience, not a marketing website.

**Important:** This is a clean NEW project. Do not assume MASAR / RAHHAL / any previous agent code exists or belongs here. Do not read other directories without explicit permission. This folder contains specs; executable apps may not exist yet. Do not falsely claim earlier milestones have been implemented.

### 1. Mandatory first-turn execution sequence
1. Read `AGENTS.md`, `README.md`, this prompt and ALL docs, brand tokens, tool schemas and evaluation cases. Identify scope conflicts (if any).
2. Verify actual current directory, Node/npm/pnpm versions, OS, git state, available tooling and dev permissions. Check env key **presence only**. Verify model IDs and SDK capabilities against current official documentation; do not assume model names or free plans are immutable.
3. Create `ENVIRONMENT_AUDIT.md`, `IMPLEMENTATION_PLAN.md` with milestones, dependencies, actual acceptance criteria, chosen runtime rationale, env variables and blockers. Avoid spending entire session on paperwork.
4. Implement runnable M1 after M0 in this folder, using best-effort non-destructive safe commands. Build a real API and automated test suite, plus a truthful local entrypoint. If keys absent, tests use mocks and real chat remains labeled DISCONNECTED; never fabricate live responses.
5. Run and report tests, typecheck, lint, server smoke check and (when web exists) Playwright with real browser screenshots. Proceed only through passed checkpoints.
6. Do not claim background execution or promise delivery later. Work in the active run, report exact scope completed.

### 2. Hard principles: genuine agent, not canned chatbot
- A real LLM-connected orchestration loop should decide when to use **typed tool calls** and how to combine actual tool outputs. Don't map every possible user utterance to canned `if/else` scripts. Allow multi-step actions **within** a bounded time/tool budget and explicit authorization gates.
- Model outputs are proposals, not authority. Backend validates tool args, permissions, costs, URLs, retries, consent, session scope and tool side effects.
- Maintain context across multi-turn replies and resumable sessions. Carry explicit task and source provenance, durable summaries and optional user-approved preferences. No 'infinite memory' claims.
- User can talk about programming, history, simple math, football or anything else appropriate. Answer the question fully instead of repeating 'I only handle travel'. Invite a travel topic only if natural and infrequent.
- Handle insults/repeated abusive language calmly and variably; no hostile replies, no constant policy slogans, no raw errors. If a request is ambiguous, ask a natural pinpoint clarifying question rather than inventing details.
- AI identifies honestly as AI; be warm and conversational without impersonating a human.
- Accurate limitations are better than confidently fabricated visa laws, pricing, tool results or reservations. No system can know literally everything.

### 3. Exact architecture outcome
Create a pnpm TypeScript monorepo (adapt only with documented justification):
- `apps/api`: Node.js current supported LTS or user-installed compatible Node (verify); Fastify; validated Zod routes; providers; bounded agent runtime, tracing, rate controls; JWT/session auth; server-side search/voice/CRM access.
- `apps/web`: Next.js App Router, React, strict TS, Tailwind, Motion for React, React Three Fiber / Three.js / Drei, accessibility-first components; responsive RTL/LTR, secure SSE/event channel, voice recorder/player. Use GSAP only if needed after profiling.
- `packages/contracts`: shared Zod schemas for conversations, events, tool calls, travel offer status, approvals and CRM payloads.
- `supabase/migrations`: PostgreSQL tables, index design and versioned migrations, auth/RLS, session isolation; pgvector for semantic retrieval only when justified.
- `tests/evals`: tests for behavioral, tool correctness, citations, consent, prompt injection and voice.
- `brand`: design token and identity source of truth, no borrowing from unrelated brands.

Build vertical slices before broad refactors. Keep provider adapters behind a small stable interface; no unsafe assumption that Groq, Gemini, OpenRouter and Claude share identical tool APIs. Model-routing can initially support one verified provider plus a real fallback; add adapters as tested. No expensive SDK just for status.

### 4. Provider policy: free-first experiments, real constraints
- Default primary candidate: Google Gemini (choose an actually available Flash model from official API list at implementation time); Groq as high-speed fallback and Whisper transcription; OpenRouter as optional fallback after verifying model limits. Anthropic/OpenAI API only if the user provides keys or explicitly authorizes any costs. Do not confuse developer model inside Codex with production model.
- `MODEL_PROVIDER`, `GEMINI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, feature flags, retry budgets and per-model timeout are configurable. No literals for unverified provider IDs or hard-coded pricing estimates.
- Route based on task/tool support, quota availability, measured quality/latency, risk and explicit capabilities. Avoid calling multiple providers for every message unless evaluation justifies it.
- Real tool call compatibility test is required for each provider. Fallback cannot bypass user consent or change semantics.
- Free-tier use may have different retention/training/privacy terms; NEVER send real phone numbers, private customer messages, travel documents or personally identifiable leads to any free-tier model until provider-specific data processing terms are approved. Use synthetic customers in development. Implement privacy-capable paid/model isolation for eventual production.
- Model error: timeout, 429, 5xx, malformed response or unsupported function call. Recovery must be honest, maintain conversation, and show safe actionable retry. No false 'completed' status.

### 5. Agent controller and tool execution
Proposed runtime steps: validate request and identity -> load consent and relevant session history -> intent/context inference -> select provider -> bounded model/tool loop -> server-authorized tool execution -> redact/sanitize tool response -> verify sources/facts/action effects -> persist turn/events -> stream actual user-safe events -> answer. Store prompt version/model and minimal redacted traces.

Tools with typed validation, scopes, authorization and timeouts:
- `search_company_packages`, `get_company_package`, `compare_company_packages`, `check_company_departures` (DB only).
- `research_destination`, `search_external_travel_listings`, `check_official_travel_advisory`, `get_weather_forecast` (real tool provider only; source URLs and timestamps).
- `build_itinerary`, `estimate_trip_budget` (label estimates and assumptions; deterministic money math).
- `get_current_session_context`, `search_opt_in_memories`, `save_opt_in_preference`, `correct_or_forget_preference` (consent-scoped).
- `create_lead`, `create_quote_request`, `request_human_handoff` (high-integrity side effects; explicit review and affirmation).
No public tool should book tickets, charge cards, send messages or submit visa documents without a separately approved real integration. Limit max tool iterations, parallel calls, search depth, output tokens, time and cost.

### 6. Travel expertise and evidence levels
Distinguish:
`company_demo` (synthetic), `company_verified` (actual DB-approved), `external_listing` (publisher URL, availability UNVERIFIED), `supplier_live_inventory` (only from properly contracted live API), `estimated_itinerary` (generated suggestion), `general_information`, `unavailable`.
A Google/Tavily search hit does **not** prove booking availability. For time-sensitive visa, immigration, health, safety and travel advisories, research official authoritative primary sources with last-checked date; national origin/residency and passport matter. If a live integration is absent, explain the limitation naturally, don't fake rates/availability.
Internal packages source of truth: SQL fields for pricing basis, currency, nights, inclusions, exclusions, offer status. Use RAG only for long descriptions/FAQ/policies; never derive price/availability exclusively from embeddings. External content is untrusted, cannot create system instructions or trigger CRM actions.

### 7. Memory and CRM with consent
- Support ephemeral active chat state, persistent chat history with ownership, multi-turn summaries and **opt-in** long-term memory with edit/delete/forget capabilities and limited retention.
- Record consent version/scope/purpose/time and source of each saved preference; no accidental memory of off-topic sensitive content; separate tenants/users/sessions.
- Guide lead qualification conversationally: destination, departure city, budget/currency, travel dates, number of adults/children, travel style, duration and nationality only if visa relevant. Ask questions one at a time when useful, don't interrogate.
- Before collecting name/phone for sales and before persisting a lead/quote or notifying staff, explain purpose, show a review summary, require explicit affirmative action and server acknowledgment. Do not state 'saved' until database confirms insert. Idempotency keys, RBAC, audit events, input normalization and anti-spam.
- Human handoff must preserve consent, status and accurate customer-visible state. No deceptive persuasion, fabricated urgency or unstated tracking.

### 8. Voice and multimodal
Stage A: actual browser record/upload -> authenticated audio ingest -> Groq Whisper or validated STT -> user-visible transcript with edit/confirm -> same text agent runtime & tools -> textual answer -> optional TTS if configured. Support Egyptian Arabic, Arabic-English mixed names, proper nouns, currencies and pronunciation of destination names. Permission-denied/oversize/format/offline/quota failures present useful alternatives.
Stage B: real voice-to-voice/realtime only if supported endpoint, quotas, transport and privacy terms are verified; support interruption/barge-in, VAD and ephemeral session credentials. Do NOT show 'Live Voice' as enabled or listening without real implementation. A streaming waveform with only CSS animation cannot be described as mic input.
Optional image understanding after base voice works; explicit consent for image upload, storage restrictions and no model guessing people's identities.

### 9. Creative design: 'Celestial Dunes' — unique to SADEEMAN
No navy/teal/cyan 'MASAR' system. New identity is plum, amethyst, sunset coral, amber, and warm ivory, with 'starlit sand ribbons' and 'orbital lantern' AI core. Authoritative colors/fonts in `brand/brand.json`, `brand/tokens.css`, `docs/05_FRONTEND_3D.md`. Never replace colors with MASAR/Rahhal identity.
Build an **agent-focused workspace**: left conversation history rail, main chat/feed with real tool events, source-rich travel cards, optional right context/journey drawer, safe consent sheets, voice mode, setting panels and optional CRM admin routes behind auth. Responsive mobile first, high contrast light/dark, true RTL and isolated LTR fragments, accessible forms, reduced motion. No full-scale tourism marketing landing website or cinematic tourism promo hero.
Use Three.js/R3F for restrained true 3D ornamental AI core; ambient layered CSS/SVG/Canvas where faster. Reactive 3D state: idle, recording, processing, actual tool-search, speaking. States must come from backend/audio truth, never fabricated reasoning or timers. Mobile GPU cap, DPR clamp, pause when hidden, lazy imports, static fallback, keyboard and screen reader compatibility.

### 10. Security and quality
Auth, RBAC, session and tenant isolation, Supabase RLS, parameterized SQL, Zod, request-size bounds, restricted CORS, rate limits, CSRF for cookie-based mutations, SSRF defense, allowlisted trusted fetch adapters, external prompt injection defense, sanitization of Markdown and links, audio validation, encrypted secrets, log redaction and data retention. Side-effect tools must be approval-gated and idempotent; no tool can escalate privileges via prompt injection.
Evaluation: functional tests + integration with mocked services + genuine live-provider checks when keys are present + E2E browser/voice checks, with distinct labels. Write eval scenarios for multi-turn off-topic chat, insults, contextual references, Arabic dialect, package pricing, unverified external results, source dates, tool outages, opt-in memory, deletion, CRM approval, voice and prompt-injection. Report real pass/fail counts and p50/p95 measured latency only when measurements exist.

### 11. Milestone implementation plan and acceptance
**M0 / Audit:** actual environment/SDK inventory, verified project folder, architecture/ADR, measurable risks, baseline commands.
**M1 / Agent core:** real model adapter and streaming when supported, tool registry, 1+ company package tool, bounded loop, tests. Acceptance: observed real model/tool call when keys present or honest disconnected state, no simulated live claims.
**M2 / Persistence & memory:** migrations, auth, session history, opt-in memory, consent, deletion & isolation tests. Acceptance: persisted/retrieved/deleted facts verified DB-side.
**M3 / Travel discovery:** internal catalog, external provider adapter + sources, itinerary planning, deterministic money. Acceptance: actual evidence link or explicit unavailable; no invented prices.
**M4 / CRM:** lead, quote and handoff with review, affirmative approval, database audit, staff authorization. Acceptance: no write before consent, idempotent confirmed writes.
**M5 / Voice:** voice notes and edited transcript, TTS, optional realtime only after real verification. Acceptance: Egyptian Arabic and code switching real samples; graceful recovery on failure.
**M6 / 3D Frontend:** beautiful distinct workspace; motion + Light/Dark + RTL/LTR + mobile + genuine agent/event API. Acceptance: browser screenshots 3 viewports, WCAG-minded navigation, performance budget, reduced-motion/static fallback.

### 12. Finished-product definition
Project is NOT done because a model replied once or the UI looks impressive. Done requires: actual tool use, multi-turn state, source-backed travel answers, honest offer statuses, consent-aware persistence, accepted CRM side effects, working recorded voice, accessible 3D chat UI, tested mobile experience, evaluation evidence, reproducible start commands and clearly documented limitations.

### 13. End-of-run reporting format
- Files changed and architectural rationale.
- Actual dev commands run and results, with test counts.
- Working features vs connected-only vs mocked-only vs blocked.
- Provider usage/cost warnings and privacy blockers.
- Screenshots or logs for tested browser flows if available.
- Next milestone with acceptance gate and any permission/keys necessary.

**START NOW:** Audit this folder and actual environment; then implement the first vertical slice and run real checks. Do not stop at generic planning; do not access unrelated projects.
