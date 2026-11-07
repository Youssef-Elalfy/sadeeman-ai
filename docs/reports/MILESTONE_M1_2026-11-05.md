# M0 / M1 checkpoint — 2026-11-05 (Africa/Cairo)

## Done

M0 audit and **local/disconnected M1** implemented. The overall product is incomplete. No Git commit/hash exists: the opened starter is not a Git repository.

- `ENVIRONMENT_AUDIT.md`, `IMPLEMENTATION_PLAN.md`: starter inventory, official sources, tool versions, architecture, risks and gate order.
- Root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, strict TS configs, Biome/Vitest configuration: pinned pnpm monorepo with no hosting dependency.
- `packages/contracts/src/index.ts`: strict Zod request/event/evidence/model/tool/budget schemas.
- `apps/api/src/config.ts`, `main.ts`, `server.ts`, `state.ts`: real Fastify localhost API, synthetic-only opaque sessions, ownership checks, request validation, rate limits, ephemeral history, run cancellation and actual replayable SSE. No fake token streaming.
- `apps/api/src/providers/*`: Gemini official SDK plus opt-in Groq/OpenRouter compatible REST adapters; schema validation, deadlines, retry limits, circuit breakers, capability/context filtering and sequential fallback. SDK continuation/automatic function execution disabled. Gemini opaque signatures retained internally; private thought text excluded from answers/events.
- `apps/api/src/agent/*`, `tools/registry.ts`: model-directed bounded tool loop, real integer budget arithmetic and strict company-catalog repository boundary. Missing catalog explicitly unavailable. Mutation registration fails closed; model-supplied consent grants nothing.
- `tools/chat.ts`, `tools/smoke.ts`, `tests/*.test.ts`, `tests/evals/inventory.ts`: truthful CLI, real HTTP smoke, deterministic tests and specification inventory.
- README, API/contracts documentation, `.env.example`, directory map updated; brand identity and source specifications preserved. Starter validator now excludes installed/generated directories.

## Verified

| Exact command | Observed result |
|---|---|
| `node --version`, `npm --version`, `pnpm --version` | 24.14.1 / 11.11.0 / 11.25.0 |
| `git status --short` | Not a Git repository; no push or initialization |
| `python tools/validate_starter.py` (before edits) | Starter integrity PASS, original 43 files; not an app test |
| `$env:NODE_USE_SYSTEM_CA='1'; pnpm install` | Dependencies installed; TLS verification preserved; supply-chain lockfile checks passed |
| `$env:NODE_USE_SYSTEM_CA='1'; pnpm install --frozen-lockfile` | Reproducible installation passed without manifest/lockfile changes |
| `pnpm build` | Shared contracts and API compiled successfully |
| `pnpm typecheck` | API, contracts, tests and tools passed strict checks |
| `pnpm lint` | Biome recommended preset passed, 27 checked files, no fixes needed |
| `pnpm test` | **47 / 47 passed**, 4 test files; deterministic provider/SDK doubles only within tests; network fetch blocked in harness |
| `pnpm dev` | Built and started actual API on `127.0.0.1:4000` |
| `pnpm smoke` against running server | Real HTTP: health **200**, session **201**, conversation **201**, missing auth **401**, disconnected chat **503**. No provider invoked |
| `pnpm chat --synthetic` against running server | Explicit DISCONNECTED message, no fabricated AI answer |
| `pnpm chat --synthetic` after stopping development server | Safe API-unavailable recovery message, exit 1, no stack trace |
| `pnpm eval:inventory` | 61 valid unique specification records, **0 behavioral scenarios executed**; dependency inventory printed |
| `pnpm list -r --depth 0` | Confirmed exact installed versions in 3 workspace projects |
| `python tools/validate_starter.py` (after implementation) | Source integrity PASS; excludes dependencies and build output; not counted as agent behavior evidence |

Tests cover actual budget-tool execution, multi-turn context plumbing, tool traces, invalid/forged arguments, denied mutations, unavailable catalog, round/call ID/token limits, deadlines including non-cooperative adapters, cancellation, fallback/retry/circuit behavior, malformed/oversized provider responses, SDK signature handling, private-thought exclusion, strict request validation, owner isolation, replayed SSE, concurrency, Origin/Host checks, request size/rate, session expiry and production-mode rejection. These verify orchestration and boundaries, **not** live conversation quality.

Initial verification found a strict type error, deprecated Fastify option, unsuccessful SDK module mocking (3 failed cases), and tsx account-lookup failure. Corrected the types/options, switched SDK tests to explicit dependency injection with a network-blocking harness, and removed tsx. Final results above replace the earlier failures; no live provider success was established.

The development server was stopped after smoke testing. Run `pnpm dev` to start it again. No background delivery or scheduled process is promised.

## Real / test-only / blocked

- **Real local:** compiled API, ephemeral sessions, authorization, integer budget calculation, tool authorization/validation, event transport, CLI and HTTP recovery path.
- **Implemented, live untested:** Gemini/Groq/OpenRouter adapter wire contracts. No valid key/model/quota access observed; never label them connected from configuration alone.
- **Test-only:** scripted model responses and injected SDK/fetch implementations. No model doubles or fixture search results are served through normal runtime configuration.
- **Disconnected:** company catalog database. A query returns unavailable, not empty offers or fictional inventory.
- **Not implemented:** production identity, durable conversation/memory/consent and RLS, research/citations, CRM, real voice, Next.js/R3F frontend, browser E2E, deployment and automation. No browser screenshots or latency/voice accuracy claims.

## Blocked

Provider credentials and account-specific verified model IDs are absent. Database/Docker setup and an explicitly identified authorized Supabase project are absent. No real customer information may be sent to unreviewed model tiers. Usage counts after failed requests/retries can be incomplete; request/output budgets are not a guaranteed monetary spending cap.

## Next / approval

M2: establish an isolated local PostgreSQL/Supabase development environment, author versioned migrations, implement real auth/tenant RLS, persisted history and consent-scoped preferences with edit/delete/revocation and cross-user DB tests; then connect the company repository. Live model acceptance separately requires locally configured keys/model and synthetic-only smoke evidence.

No approval is needed for the completed local work. No remote schema changes, real leads, bookings, payments, paid upgrades, messages, deployment, repository pushes or scheduled jobs were performed. Those actions retain the project's explicit approval requirements.
