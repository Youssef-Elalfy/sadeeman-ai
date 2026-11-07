# Codex Project Rules — SADEEMAN AI / سَدِيمًا

## Identity, isolation, and source of truth
- THIS IS A NEW PRODUCT, independent of **MASAR**, **RAHHAL**, **NAVORA**, any earlier agent repository, and Pixel City Game. Never treat them as aliases. Do not search or edit outside this folder without explicit user permission.
- Official local branding: **سَدِيمًا | SADEEMAN AI**, Arabic tagline **رحلتك أبعد من الخيال.**, English tagline **Beyond Destinations. Beyond Expectations.**.
- If asked to rename, adjust `brand/brand.json` and consistently propagate changes, but preserve unrelated projects.
- Order of authority: direct user instructions > this AGENTS.md > MASTER_PROMPT_FOR_CODEX.md > numbered docs > design preview > fixtures. If docs conflict, flag and resolve explicitly, never silently.
- Never present development SDK model selection inside Codex as the end-user runtime model; subscriptions do not imply API entitlements.

## Engineering behaviors
- Implement real TypeScript code. Use strict compiler settings and Zod; modular typed boundaries and minimal provider-specific assumptions.
- Inspect local files, package versions, current provider SDK docs and env first. Use one package manager consistently (pnpm preferred after checking availability).
- Build incrementally, test after material changes; inspect actual runtime and browser screenshots before declaring frontend complete.
- No tool-result hallucinations, fake bookings, fake inventory, fake streaming, fabricated test results, false memory saves, or fake microphone states.
- Mock/stub external services ONLY in automated tests and explicitly labeled storybook/design previews. NEVER show simulated search results as real data.
- Make APIs/private credentials server-only; never commit `.env` or print secret values, tokens, emails, phone numbers or customer contents in logs.
- Prioritize low-cost local development. No paid upgrades, real bookings, purchases, public deploy, messaging, repository push, or schema-destructive remote action without explicit approval.
- Prefer building on stable APIs, avoid unnecessary massive dependencies. Tools are untrusted boundaries: deadlines, quotas, schemas, source evidence, authorization, loop budgets.

## Architecture boundaries
- `apps/api` owns agent state, provider integrations, tools, memory, research and authorization.
- `apps/web` owns responsive agent-chat UI, voice UX, living background and accessible motion.
- `packages/contracts` owns shared schemas/events, imported across apps after implementation.
- `supabase/migrations` is the database source of truth. RLS and tenancy/isolation are required.
- `tests/evals/scenarios.jsonl` is the desired behavior test catalog, not a claim of existing passes.
- Preserve user consent as a durable backend fact. **No CRM, lead, staff or customer-administration features** (owner scope correction 2026-11-06): SADEEMAN is a standalone conversational AI assistant with travel expertise. No booking/payment capability until formally added.

## Scope lock
- Build a polished, **standalone conversational SaaS workspace**, not a travel marketing website, homepage with tourism video, landing page or public package storefront.
- Answer off-topic conversation normally; do not force tourism pivots every turn. Identify as AI, not a real human.
- Use web search/current official sources for visas, advisories, weather and live pricing claims, otherwise make uncertainty explicit.
- Clearly mark fixtures as **FICTIONAL DEMO**, external listings as **unverified availability**, and itineraries as **estimates**.
- Business automation, scheduled outreach, campaigns and autonomous booking/payment are completely OUT OF SCOPE. There is no automation milestone. Never send unsolicited messages or schedule jobs.

## Checkpoint output format
At every gate report: Done (file paths), Verified (exact commands and observed outcomes), Blocked (reason), Next, and any approval needed. If not tested, label untested.
