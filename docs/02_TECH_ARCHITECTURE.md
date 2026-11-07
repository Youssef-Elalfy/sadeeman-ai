# 02 · Technical architecture and runtime topology

## Application layout
- `apps/web` (Next.js React TypeScript) uses UI-only server actions when safe, but **never** holds supplier/model keys. Main application fetches `/api/v1/...` through authenticated backend and uses SSE for real tool events.
- `apps/api` (Fastify TypeScript) controls provider adapters, validation, agent tool loop, traveler session, memory, CRM, research, voice and authorization.
- `packages/contracts` (TypeScript + Zod) prevents web/backend event shape drift; export JSON Schema/OpenAPI for external contracts as needed.
- `supabase/migrations` Postgres schema, RLS, durable tables, idempotency constraints, careful row ownership.
- `tests` unit, contract, integration, eval suites, Playwright end-to-end.

## Actual turn flow
User (text or confirmed voice transcript) -> validate authenticated session and rate limit -> load selected conversation + opt-in memory -> invoke configured primary model -> if it proposes tool, validate Zod and authorize -> execute with timeout and source typing -> continue model with sanitized outputs and MAX 5 tool rounds -> validate returned evidence -> save answer+events -> stream factual activity and answer to user.

## Model adapter contract (design, implement later)
```ts
interface ModelAdapter {
  id: string;
  capabilities: { tools: boolean; streaming: boolean; vision?: boolean; audio?: boolean };
  generate(input: AgentModelInput, options: { signal: AbortSignal }): Promise<AgentModelOutput>;
  stream?(input: AgentModelInput, options: { signal: AbortSignal }): AsyncIterable<AgentEvent>;
}
```
The main runtime may use a proven SDK if actually compatible. Do not couple customer context persistence to model vendor. Provider failover must preserve safety and approved tool scopes. Implement at most 2 retry attempts per provider operation for safe requests with jitter/backoff; do not blindly repeat mutated CRM writes.

## Budgets, limits and visibility
- Default <=5 model/tool rounds per user turn, configurable server-side.
- Short timeout and circuit breaker per external supplier; exponential backoff only on retry-safe operations.
- Per-user rate limit and session quotas; global dev budget switch and graceful 429 feedback.
- SSE event types defined in `contracts/agent-events.schema.json`; only send actual state. Do not expose hidden model reasoning/chain of thought.
- Use request IDs + redacted execution summaries; provider token totals may be stored as counts only, not secret tokens.

## Database implementation guidance
`organizations`, `profiles`, `conversations`, `messages`, `agent_runs`, `tool_executions`, `packages`, `package_departures`, `research_sources`, `customer_consents`, `customer_memories`, `leads`, `quote_requests`, `handoffs`, `audit_events`; optional `document_chunks` for RAG. Every customer-owned record needs tenant and owner check; not merely UI filtering. Verify RLS with cross-user tests.

## API versioning
Implement `/api/v1/health`, `/api/v1/agent/messages`, `/api/v1/agent/events/:runId`, `/api/v1/conversations`, `/api/v1/voice/transcribe`, `/api/v1/voice/synthesize` (if supported), `/api/v1/memory`, `/api/v1/leads`, `/api/v1/quote-requests` and admin-only lead review. See `contracts/openapi-outline.yaml` for intended shapes; do not claim they exist before implementation.

## Deployment boundaries
App can run locally via one documented `pnpm dev` from repo root (web/api). Use separate deploy targets if needed for long-lived streaming/audio. A serverless timeout must not cut voice requests; verify before choosing hosting. No paid hosting authorized by this starter.
