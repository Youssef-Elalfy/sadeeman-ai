# SADEEMAN AI — Railway deployment guide (one service)

SADEEMAN runs as **one Railway service** built from the root **`/Dockerfile`**. Inside the
single container:

- **Next.js web** listens on Railway's public `PORT` (`0.0.0.0`).
- **Fastify API** listens on `127.0.0.1:4000` only (not reachable from outside).
- The web server forwards every `/api/*` request to the internal API.
- `tools/start-production.mjs` starts the API, waits for it to be healthy, starts the web
  server, forwards shutdown signals to both, and exits (so Railway restarts) if either one stops.

Data lives in the existing **Supabase** project `ujdzysbowngtkwndgoqf`; no Railway database.

| Setting | Value |
|---|---|
| Services | **1** |
| Root directory | `/` (repository root) |
| Config-as-code | `/railway.json` (default) |
| Builder | Dockerfile → `/Dockerfile` |
| Build | inside the image: `pnpm install --frozen-lockfile`, then build contracts, API and web |
| Start | `node tools/start-production.mjs` (the Dockerfile `CMD`; do not override) |
| Public port | Railway's `PORT` (injected automatically) |
| Health check | `/api/v1/health` (passes only when the web server **and** the API answer), timeout 120 s |
| Replicas | **1** (rate and admission limits are per process) |

## 0. One-time Supabase checks
1. **Anonymous sign-ins** enabled (Authentication → Sign In / Providers): guests use them.
2. **Apply** `supabase/migrations/20261112130000_masar_demo_catalog_public_read.sql` to project
   `ujdzysbowngtkwndgoqf` (SQL editor or Supabase CLI). It only replaces the catalog SELECT policy
   (adds read access to `masar-demo-*` rows) and inserts the four FICTIONAL DEMO packages if
   absent. Without it everything works except the company catalog, which stays empty.

## 1. Create the service
1. Railway → **New Project** → **Deploy from GitHub repo** → `Youssef-Elalfy/sadeeman-ai` (branch `main`).
2. Leave the root directory empty and the build/start commands unset (the Dockerfile defines them).
3. **Settings → Networking → Generate Domain.** You get e.g.
   `https://sadeeman-ai-production.up.railway.app`. If Railway asks for a target port, use the
   port the logs show for Next.js (Railway's `PORT`, usually `8080`).
4. Add the variables below (the API refuses to start until `WEB_ORIGIN` matches this domain), then deploy.

## 2. Variables
Secrets are marked `<secret>`: paste them only into Railway's Variables tab, never into git.

| Variable | Value |
|---|---|
| `WEB_ORIGIN` | the generated domain, e.g. `https://sadeeman-ai-production.up.railway.app` (https, no trailing slash) |
| `PERSISTENCE_MODE` | `supabase` |
| `SUPABASE_URL` | `https://ujdzysbowngtkwndgoqf.supabase.co` |
| `SUPABASE_PROJECT_REF` | `ujdzysbowngtkwndgoqf` |
| `SUPABASE_PUBLISHABLE_KEY` | `<sb_publishable_…>` (Supabase → Project Settings → API keys) |
| `ENABLE_SUPABASE_GUEST` | `true` |
| `ENABLE_REAL_PROVIDER` | `true` |
| `MODEL_PROVIDER` | `gemini` |
| `GEMINI_MODEL` | `gemini-3.8-flash,gemini-3.5-flash-lite` |
| `GEMINI_API_KEY` | `<secret>` |
| `FALLBACK_PROVIDERS` | `groq` |
| `GROQ_MODEL` | `openai/gpt-oss-120b` |
| `GROQ_API_KEY` | `<secret>` |
| `PROVIDER_RETRIES` | `0` |
| `MODEL_TIMEOUT_MS` | `30000` |
| `TURN_TIMEOUT_MS` | `90000` |
| `MAX_TURN_TOKENS` | `40000` |
| `ENABLE_TRAVEL_RESEARCH` | `true` |
| `TAVILY_API_KEY` | `<secret>` |
| `ENABLE_COMPANY_CATALOG` | `true` |
| `ENABLE_TRAVEL_CONTEXT` | `true` |
| `ENABLE_TRAVEL_CONTEXT_PERSISTENCE` | `true` |
| `ENABLE_VOICE` | `true` (Groq speech-to-text + Gemini text-to-speech; same keys) |
| `ENABLE_STYLE_GUARD` | `true` |
| `RATE_LIMIT_MAX` | `120` |

Set by the image — **do not add**: `NODE_ENV=production`, `API_INTERNAL_PORT=4000`,
`API_ORIGIN=http://127.0.0.1:4000` (baked into the web build). `PORT` is injected by Railway.
Defaults that need no variable: `GROQ_STT_MODEL` (`whisper-large-v3-turbo`), `GEMINI_TTS_MODEL`
(`gemini-3.1-flash-tts-preview`); `ENABLE_OPENROUTER_RUNTIME`, `ALLOW_CATALOG_DEMO`,
`ALLOW_SYNTHETIC_PROVIDER_DATA` stay `false`. No database password, service-role key or
`DATABASE_URL` is used.

The API's release guard stops the container at startup if: `WEB_ORIGIN` is not HTTPS on
`*.up.railway.app`, persistence is not Supabase for the verified project, guest auth is off, Gemini
or the Groq fallback is not configured, `PROVIDER_RETRIES` ≠ 0, or research is on without a key.

## 3. Test the deployment
1. Logs show `SADEEMAN AI API ready on 127.0.0.1:4000` with the readiness report (persistence
   Supabase; research, catalog, voice enabled), then Next.js `Ready`.
2. `https://<domain>/api/v1/health` → `"status":"ok"`, `"persistence":"supabase"`,
   `"catalog":"database_connected_not_inventory_verified"`, `"voice":true`.
3. Open `https://<domain>/` and send messages (a guest session starts automatically):
   - General: `يعني إيه API في البرمجة؟`
   - Packages: `إيه برامج الشركة المتاحة بأسعارها؟` → Fayoum 3,200 / Hurghada 6,500 /
     Sharm El Sheikh 7,800 / Nubia 9,200 EGP per adult, FICTIONAL DEMO (needs step 0.2).
   - Research: `عايز خطة رحلة للمالديف 5 أيام` → plan with cited sources.
   - Voice: microphone button and "استمع" on a reply.
4. Reload: the conversation is still in the history (Supabase persistence).

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| Logs: `Configuration error` / `Production guard: …` | A variable above is missing or wrong (messages name fields, never values). |
| Logs: `Supabase target is not the verified Sadeeman project` | `SUPABASE_URL` / `SUPABASE_PROJECT_REF` mismatch. |
| Logs: `[start] API did not become healthy within 60 s` | Usually a configuration error printed just above it. |
| Chat fails with an origin error (403) | `WEB_ORIGIN` must equal the public domain exactly. If you add a custom domain, the guard currently accepts only `*.up.railway.app`. |
| Company catalog empty | Apply the migration in step 0.2. |
| "كل نماذج الذكاء الاصطناعي عليها ضغط دلوقتي" | Gemini overloaded and Groq per-minute limit reached; transient (logs: `[agent] run failed … attempts=`). |
