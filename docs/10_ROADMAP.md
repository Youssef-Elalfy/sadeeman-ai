# 10 · Milestones and explicit gates

| Gate | Scope | Proof of acceptance |
|---|---|---|
| M0 | Audit & architecture | current toolchain evidence, plan, env boundaries, ADR |
| M1 | Actual agent/tool loop | server starts, real or transparently disconnected provider, tool traces, unit tests |
| M2 | Auth, persistence, memory | real DB migration, multi-turn history and consent/forget tests |
| M3 | Travel sources | database catalog + external research w/canonical citations + honest offer type |
| M4 | CRM and quote approvals | server-confirmed consented insert, idempotency, staff RBAC |
| M5 | Recorded voice and optional live | STT and TTS verified, transcript editing, mic failure fallback, measured Arabic test |
| M6 | Distinct 3D frontend | real chat/API, RTL/LTR, both themes, mobile screenshots, reduced motion |

Guidance: M1 vertical slice first before full design. Continue independent local M4–M6 implementation while honestly documenting external acceptance blockers. Comprehensive QA and Claude handoff belong to the M6 delivery gate. Business automation is entirely out of scope. If one integration is blocked by missing credentials, implement independent safe subfeatures while explicitly labeling incomplete. No promises of exact completion time.
