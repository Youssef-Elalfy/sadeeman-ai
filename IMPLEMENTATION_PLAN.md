# Implementation roadmap — current owner scope

The 2026-11-06 instruction authorizes independent local M3–M6 work even while external acceptance is pending. It supersedes older milestone locks. Business automation is completely out of scope; there are no later business-automation milestones. QA and independent Claude review are part of delivery.

| Gate | Current implementation | Acceptance boundary |
|---|---|---|
| M0–M2 | Existing typed agent, auth/RLS, durable conversation/consent/memory and genuine historical provider evidence retained | Reuse recorded results; no repeated Cloud audit |
| M3 | ASK/ACT/ANSWER, aggregate feedback, one correction then no-tools clarification, optional unknowns, Arabic grounding, context, worldwide research, catalog and estimated plan/comparison tools | Deterministic verification; new recovery still needs separately approved live dialogue. Controlled Cloud claims/expiry pending |
| M4 | Local-only reviewed CRM SQL, secure APIs, profiles/leads/inquiries/notes/quotes/handoffs, manual status/assignment, deduplication, retention and audit, real UI | Local workflow and isolation tests; Cloud migration requires separate review/approval |
| M5 | Genuine note STT and TTS adapters, recording/upload, bounded incremental transcript segments, transcript review, text-agent continuity, interruption/timeout/silence/cancel/cleanup and language selection | Mocked provider and synthetic browser verification only; live audio/device quality pending. Native audio streaming and continuous full duplex not implemented |
| M6 | Executable Next/React/Three Celestial Dunes workspace; functional chat/history/travel/CRM/privacy/settings; themes, keyboard/dialog focus and responsive/motion fallback; Claude handoff | Production build and real local browser screenshots/tests. Arabic-first UI; no blanket production or fully translated-interface claim |

The tool correction budget remains one per tool. Exhaustion permits at most one final text-only model generation, never another tool execution; refusal to respect that boundary fails closed. External provider retries remain bounded, and no false tool results are substituted.

Commands and exact results: [Claude handoff](CLAUDE_HANDOFF/START_HERE.md), [QA results](CLAUDE_HANDOFF/QA_RESULTS.md). No new Cloud migration, Auth setting, provider acceptance request, paid upgrade, outreach, booking, deployment or repository push is authorized by local test success.
