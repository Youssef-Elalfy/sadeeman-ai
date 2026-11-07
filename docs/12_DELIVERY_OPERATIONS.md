# 12 · Local development and deployment readiness

## Target CLI (Codex must implement and document)
`corepack enable` (if available), `pnpm install`, `pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm build`. If environment lacks pnpm/permissions, document alternatives. Never claim these run before apps exist.

## Environment (examples only)
`GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `JWT_SECRET`, `WEB_ORIGIN`. Use secure secret management for production and do not print values.

## Operational features
Health/readiness endpoints with no secret payload; alerting and redacted trace ids; privacy-safe telemetry; provider quota dashboard; migration/backup runbooks; no silent external dispatch. Deploy only after explicit approval, legal/privacy review, secrets set, domain verification and quality gate pass.

## Documentation required from build
Working README, architecture and ADR updates, env reference, real commands/tests, runbooks for low quota and backend downtime, migration and cleanup instructions, access-control matrix, seed data policy, license and image attribution if external images are used. Keep upgrade path from free experiment to contractual production provider.
