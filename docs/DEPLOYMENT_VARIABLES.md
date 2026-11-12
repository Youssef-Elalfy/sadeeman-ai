# SADEEMAN deployment variables (Railway: API + web)

Step-by-step setup: see `RAILWAY_DEPLOYMENT_GUIDE.md` at the repository root.

Values in `<…>` are secrets or account-specific: set them only in the Railway
dashboards, never in git. The API refuses to start in production if the release guard in
`apps/api/src/config.ts` is not satisfied (marked **guard** below).

## Before the first deploy
1. Apply `supabase/migrations/20261112130000_masar_demo_catalog_public_read.sql` to the
   Sadeeman Supabase project (`ujdzysbowngtkwndgoqf`). It only replaces the catalog SELECT
   policy (adds read access to `masar-demo-*` rows) and inserts the four fictional packages
   if absent. Without it, hosted users see an empty company catalog.
2. Supabase Auth: anonymous sign-ins enabled (guest entry).

## Railway — API service (`railway.json`, Dockerfile, health `/api/v1/health`)
| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | set by Railway |
| `WEB_ORIGIN` | `https://<web-service>.up.railway.app` (**guard**: https, `*.up.railway.app`) |
| `PERSISTENCE_MODE` | `supabase` (**guard**) |
| `SUPABASE_URL` | `https://ujdzysbowngtkwndgoqf.supabase.co` |
| `SUPABASE_PROJECT_REF` | `ujdzysbowngtkwndgoqf` (must match `config/supabase-target.json`) |
| `SUPABASE_PUBLISHABLE_KEY` | `<sb_publishable_…>` |
| `ENABLE_SUPABASE_GUEST` | `true` (**guard**) |
| `ENABLE_REAL_PROVIDER` | `true` (**guard**) |
| `MODEL_PROVIDER` | `gemini` (**guard**) |
| `GEMINI_MODEL` | `gemini-3.8-flash,gemini-3.5-flash-lite` (chain: next model on 503/429) |
| `GEMINI_API_KEY` | `<secret>` |
| `FALLBACK_PROVIDERS` | `groq` (**guard**) |
| `GROQ_MODEL` | `openai/gpt-oss-120b` |
| `GROQ_API_KEY` | `<secret>` |
| `PROVIDER_RETRIES` | `0` (**guard**; the model chain + Groq replace blind retries) |
| `MODEL_TIMEOUT_MS` / `TURN_TIMEOUT_MS` | `30000` / `90000` |
| `MAX_TURN_TOKENS` | `40000` (one research turn needs ~20–30k with tool results) |
| `ENABLE_TRAVEL_RESEARCH` | `true` |
| `TAVILY_API_KEY` | `<secret>` (**guard** when research is on) |
| `ENABLE_COMPANY_CATALOG` | `true` |
| `ENABLE_TRAVEL_CONTEXT` / `ENABLE_TRAVEL_CONTEXT_PERSISTENCE` | `true` / `true` |
| `ENABLE_VOICE` | `true` (Groq STT + Gemini TTS; uses the same keys) |
| `ENABLE_STYLE_GUARD` | `true` |
| `ENABLE_OPENROUTER_RUNTIME`, `ALLOW_CATALOG_DEMO`, `ALLOW_SYNTHETIC_PROVIDER_DATA` | `false` (**guard**) |
| `RATE_LIMIT_MAX` | ≤ `120` |

## Railway — web service (`Dockerfile.web`, `railway.web.json`)
| Variable | Value |
|---|---|
| `API_ORIGIN` | `https://<api-service>.up.railway.app` (build time and runtime) |

## Local development (`.env` at the repo root)
Same provider/feature values, but `NODE_ENV=development`, `PERSISTENCE_MODE=local`
(embedded PostgreSQL in `.private/postgres`, migrations applied automatically, guest sessions
durable across restarts), `WEB_ORIGIN=http://localhost:3000`, `API_ORIGIN=http://127.0.0.1:4000`.
Never use `PERSISTENCE_MODE=ephemeral`: it has no guest-session store (`/auth/guest` → 503).
Start: `corepack pnpm dev` (or `pnpm dev`), then open http://localhost:3000.
