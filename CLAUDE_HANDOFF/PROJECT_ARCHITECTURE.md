# Existing architecture

- `apps/api`: Fastify 5, strict TypeScript, server-only provider credentials. Bounded Gemini-primary/Groq-fallback routing, typed tools, durable repository, authorization, CRM and voice routes. OpenRouter remains disabled in the intended runtime configuration.
- `packages/contracts`: Zod 4 schemas shared with the frontend. Unknown optional travel facts stay absent; tool boundaries remain strict.
- `apps/web`: Next.js 16.4.5/React 19.3.1, Three.js 0.187.0. Arabic-first Celestial Dunes workspace, actual API/history/CRM/memory/voice flows, themes, keyboard access, reduced motion and static orbital fallback. English conversation/transcription/speech are supported; do not claim a fully translated English UI.
- `supabase/migrations`: authoritative immutable approved migrations plus one **local-only, unapplied-to-Cloud** CRM migration. Embedded PGlite runs the same SQL/RLS locally. Supabase transports call authenticated RPCs; no service key is required in the browser.

## Conversational turn

Current user text + bounded history + confirmed structured context → model chooses ASK/ACT/ANSWER → typed tool arguments → exact-source grounding and all-field validation feedback → at most one correction → optional final **text-only** clarification generation → citation check → durable commit → truthful completion events. Rejected proposals never become facts. An ignored text-only restriction cannot execute another tool. Optional age/flight fields do not block basic research or itinerary planning.

`assess_travel_request` checks action-specific requirements and avoids repeating its last suggested question. Shared-budget intent is distinguished from confirmed total/per-person scope before financial comparisons. A clarification can recover a still-unknown fact from the immediately previous actual user message, never overwrite a confirmed fact using old evidence. Off-topic conversation preserves the travel context.

## CRM boundary

`prepare_customer_request` only prepares an unsaved quote/handoff review draft on explicit user intent. It performs no CRM write or outbound action. The human reviews the actual snapshot, consents to a ten-minute review draft, then approves its exact hash. SQL locks the review, checks owner/session/expiry, creates or revises one record, preserves note history and writes metadata-only audit records. Repeated approval is idempotent. Profiles, inquiries, leads, quotes, notes and handoffs share a strict typed record model. Staff are manually authorized by a workspace owner and can access only assigned records; membership alone does not grant all-tenant reads.

## Voice boundary

Browser MediaRecorder → bounded, consented audio → authenticated Groq Whisper multipart transcription → editable transcript → same text-agent/SSE pipeline. Optional incremental mode restarts MediaRecorder for complete, independently decodable ten-second containers, then serializes up to six transcription requests per sixty-second turn. It never uploads invalid continuation fragments as separate files. A two-item pending queue, total 5 MB/audio and 16,000-character/text limits stop overload; provider failure stops the turn without retries and marks partial text for review. Silence without detected speech consumes no transcription request. Gemini TTS returns real audio bytes converted to WAV when needed. New recording/output interrupts current speech; abort signals, upload/rate limits, silence/max-duration recording stops, object URL disposal and microphone/AudioContext cleanup are implemented. SADEEMAN does not store audio; the provider receives it for transcription. Each Groq request returns a complete transcript; incremental updates are application-level segmentation, not native provider streaming. Continuous full-duplex Live API/WebRTC is **not implemented or advertised**.

Next proxies only a configured loopback API origin. The frontend has no provider/service credentials. A production API guard intentionally remains closed until release/security/privacy acceptance is approved.
