# M0 environment audit — 2026-11-05

This is the historical M0/M2 local snapshot. Subsequent approved Cloud migrations and authenticated provider outcomes are recorded in [the Cloud application checkpoint](docs/reports/CLOUD_APPLY_AND_PROVIDERS_2026-11-05.md). Earlier absence-of-credential statements below describe their historical checkpoint, not the latest configuration.

Root: `C:\Users\youss\Desktop\Sadeeman`. All 43 original files inspected: master/rules, 15 numbered documents, brand JSON/tokens/preview/SVG, contracts, fixture, 61 evaluation scenarios, templates and target-directory READMEs. No executable application, package manifest, lockfile, or Git repository existed. Starter integrity check passed before changes; this is not application evidence.

Observed tools: Windows PowerShell; Node **24.14.1**, npm **11.11.0**, pnpm **11.25.0**, Git, Python 3.10. Docker was not found. No `.env` exists. Presence-only checks: Gemini, Groq, OpenRouter, Tavily, database URL, Supabase URL and JWT secret all **absent**. No secrets or unrelated projects were inspected.

Registry access initially failed certificate validation. `NODE_USE_SYSTEM_CA=1` successfully used the Windows trust store without disabling TLS verification. Registry queried for current package versions; exact installed versions are recorded in manifests and pnpm lockfile. pnpm is the only installation manager.

Installed: Fastify 5.12.8, `@google/genai` 2.32.0, Zod 4.6.7, TypeScript 7.0.2, Vitest 5.1.0, Biome 2.6.5, `@fastify/rate-limit` 11.2.2. pnpm lockfile supply-chain verification passed. esbuild's required binary setup was inspected/allowed; unnecessary Google preinstall and protobuf postinstall scripts are disabled. A tsx Windows account-lookup failure (`uv_os_get_passwd ENOMEM`) was avoided by removing that dependency: tools use Node 24 native type stripping and API uses compiled JavaScript. No global tool settings were changed.

## Official sources checked

- [Google SDK recommendation](https://aistudio.google.com/docs/libraries): `@google/genai`, not the deprecated SDK.
- [Google SDK model methods](https://googleapis.github.io/js-genai/release_docs/classes/models.Models.html): explicit `generateContent` with controller-owned continuation; SDK types will be checked after installation.
- [Google function calling](https://aistudio.google.com/docs/function-calling) and [models](https://aistudio.google.com/docs/models): model catalog changes. No model ID or free quota is assumed to be enabled for this account. Select model explicitly in local environment.
- [Groq tool use](https://console.groq.com/docs/tool-use/overview) and [REST reference](https://console.groq.com/docs/api-reference): server-side compatible Chat Completions adapter with validated responses.
- [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling): optional compatible adapter, explicit opt-in; routing cannot confer consent.

## Architecture decisions

Explicit project Fastify / small provider-adapter architecture takes precedence over the agent skill's default eve framework. No extra agent framework or hosting dependency is needed. `packages/contracts` holds strict shared Zod contracts. M1 runs locally with short-lived anonymous development sessions, RAM-only context and bounded events. This is not production auth or durable memory.

No runtime fixture import: company catalog tool reports `unavailable` until a database repository is connected at M2. Fixture-backed repositories exist only inside tests. Real deterministic budget calculation is available without external data; inputs and totals are estimates, never live pricing. No mutation tools are registered at M1, so a model cannot assert its own consent.

No product-spec conflict found. Original illustrative contracts are retained; implemented endpoint scope is documented separately. Anonymous dev sessions are a deliberate M1-only boundary; production sessions and database RLS remain M2.

## Blockers and limits

- No provider keys: live model replies, account-specific model access, quotas, tool compatibility and billing are **untested**. Configured means ready to attempt a request, never proof of connectivity.
- No local PostgreSQL/Docker or identified Supabase target: M2 persistence/RLS cannot be accepted yet. No remote database inspected or modified.
- Browser tooling is available through computer use / Playwright when the web app exists; no application frontend exists at M1. Static brand preview is not a functioning UI.
- Full product, real voice, CRM, deployment and business automation are not completed by M1.

## M2 update — 2026-11-05 (Africa/Cairo)

Implemented embedded PostgreSQL development persistence with **PGlite 0.5.15** (observed engine **PostgreSQL 18.6**), Supabase JS **2.119.0**, and Supabase CLI **3.0.0**. Docker/native psql/Postgres remain absent; no hosted project was queried. Supabase's current changelog revealed a v3 CLI breaking change to local-default targeting and explicit hosted confirmation; help output was checked before generating the migration. `SUPABASE_HOME` is confined to `.private/supabase-cli` to preserve workspace isolation. The source migration filename was generated by the CLI in UTC, not invented manually.

Gemini/Groq/OpenRouter key presence remains false. Supabase URL/ref/publishable key and Tavily key are also absent; no `.env` exists. The setup guide contains current official setup, pricing/terms and streaming references without assuming model IDs or numerical quotas. The Supabase docs connector was unavailable; official web documentation was used. The changelog markdown endpoint was unsupported by the web reader, so the official HTML changelog and v3 migration guide were read instead.

Local/database acceptance now includes real RLS execution as `authenticated` with `rolbypassrls=false`, disk close/re-open, consent, erasure, ownership, atomic turn persistence, idempotency, extractive summary, expiry visibility, session revocation and privacy cancellation. Auth/PostgREST/provider transports in offline tests are clearly mocked; they are not hosted/live evidence. The shared migration is applied to PGlite with a separate minimal local identity bootstrap, not a fake Supabase Auth implementation.

Dependency verification initially hit restricted-network metadata access and a missing offline security metadata cache. A verified registry check then passed with the existing explicit workspace store, and `.npmrc` now pins that same local store to prevent permission-context directory mismatch. Final `pnpm install --frozen-lockfile` passed without rebuilding/removing installed modules or disabling security checks. All credentials remained server-only; no unrelated project folders, remote schema, real customer records, outbound messages or paid upgrades were accessed.

Current acceptance status and exact command results: `docs/reports/MILESTONE_M2_2026-11-05.md`. Full M2 hosted acceptance, real model compatibility and production approval are still pending. Original ephemeral M1 mode remains available, while local persistence is selected explicitly with `PERSISTENCE_MODE=local`.
