# SADEEMAN AI — Railway deployment guide

SADEEMAN is a pnpm monorepo: a **Fastify API** (`apps/api`) and a **Next.js web app**
(`apps/web`) that share `packages/contracts`. It needs **two Railway services** from the same
GitHub repository. Data lives in the existing **Supabase** project (`ujdzysbowngtkwndgoqf`);
no Railway database is needed.

| | API service | Web service |
|---|---|---|
| Suggested name | `sadeeman-api` | `sadeeman-web` |
| Root directory | `/` (repository root — the monorepo shares one lockfile) | `/` (repository root) |
| Config-as-code file | `/railway.json` (default) | `/railway.web.json` (set this in the service) |
| Builder | Dockerfile `Dockerfile` | Dockerfile `Dockerfile.web` |
| Build (inside the image) | `pnpm install --frozen-lockfile` → build contracts → build api | `pnpm install --frozen-lockfile` → build contracts → `next build` |
| Start | `node apps/api/dist/main.js` | `next start apps/web --hostname 0.0.0.0 --port $PORT` |
| Port | Railway's `PORT` (binds `0.0.0.0` when `NODE_ENV=production`) | Railway's `PORT` |
| Health check | `/api/v1/health` | `/privacy` |
| Replicas | **1** (rate/admission limits are per process) | 1 or more |

Do not override the build or start commands in the Railway UI: the Dockerfiles define them.

## 0. Before deploying (one-time, in Supabase)
1. **Anonymous sign-ins** must stay enabled (Authentication → Sign In / Providers). Guests use them.
2. **Apply the catalog migration** `supabase/migrations/20261112130000_masar_demo_catalog_public_read.sql`
   to project `ujdzysbowngtkwndgoqf` (SQL editor, or the Supabase CLI). It only replaces the catalog
   SELECT policy (adds read access to `masar-demo-*` rows) and inserts the four FICTIONAL DEMO
   packages if absent. Without it the app works, but the company catalog is empty in production.

## 1. Create the two services
1. Railway → **New Project** → **Deploy from GitHub repo** → `Youssef-Elalfy/sadeeman-ai`.
   Rename the created service to `sadeeman-api`.
2. In the same project → **New** → **GitHub Repo** → the same repo → rename to `sadeeman-web`.
3. `sadeeman-web` → **Settings → Config-as-code → Railway config file** → `/railway.web.json`.
   (`sadeeman-api` keeps the default `/railway.json`.)
4. Keep both services' root directory empty (`/`).

## 2. Generate the public domains first
Each service → **Settings → Networking → Generate Domain**. You get two URLs such as
`https://sadeeman-api-production.up.railway.app` and `https://sadeeman-web-production.up.railway.app`.
They are needed in the variables below (the API only accepts browser requests from the exact web
origin, and the web build bakes in the API URL). If Railway asks for a port, use the one shown in the
service's deploy logs (the app listens on Railway's `PORT`).

## 3. API service variables (`sadeeman-api`)
Secrets are marked `<secret>`: paste them only into Railway's Variables tab, never into git.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `WEB_ORIGIN` | the web URL, e.g. `https://sadeeman-web-production.up.railway.app` (no trailing slash) |
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
| `ENABLE_VOICE` | `true` (Groq speech-to-text + Gemini text-to-speech, same keys) |
| `ENABLE_STYLE_GUARD` | `true` |
| `RATE_LIMIT_MAX` | `120` |

Leave unset (safe defaults): `PORT` (Railway sets it), `GROQ_STT_MODEL` (`whisper-large-v3-turbo`),
`GEMINI_TTS_MODEL` (`gemini-3.1-flash-tts-preview`), `ENABLE_OPENROUTER_RUNTIME`, `ALLOW_CATALOG_DEMO`,
`ALLOW_SYNTHETIC_PROVIDER_DATA` (all `false`). No database password, service-role key or
`DATABASE_URL` is used by the API.

The API refuses to start in production unless these hold (release guard): HTTPS `WEB_ORIGIN` on
`*.up.railway.app`, `PERSISTENCE_MODE=supabase` for the verified project, guest auth on, Gemini with
Groq fallback configured, `PROVIDER_RETRIES=0`, research key present when research is on.

## 4. Web service variables (`sadeeman-web`)
| Variable | Value |
|---|---|
| `API_ORIGIN` | the API URL, e.g. `https://sadeeman-api-production.up.railway.app` (no trailing slash) |

`API_ORIGIN` is read **at build time** (Next.js bakes the `/api/*` proxy into the build) and at start.
The browser only talks to the web domain; the web server forwards `/api/*` to the API. If you change
the API domain later, redeploy the web service.

## 5. Deploy order
1. Deploy `sadeeman-api`. Logs should end with `SADEEMAN AI API ready on 0.0.0.0:<port>` and a
   readiness report (persistence: Supabase; research, catalog, voice enabled).
2. Deploy `sadeeman-web` (after `API_ORIGIN` is set).

## 6. Test the deployment
1. `https://<api-domain>/api/v1/health` → `"status":"ok"`, `"persistence":"supabase"`,
   `"research":"configured_not_verified"`, `"voice":true`.
2. `https://<web-domain>/api/v1/health` → the same JSON (proves web → API forwarding).
3. Open `https://<web-domain>/`, send a message (a guest session is created automatically):
   - General: `يعني إيه API في البرمجة؟`
   - Company packages: `إيه برامج الشركة المتاحة بأسعارها؟` → Fayoum 3,200 / Hurghada 6,500 /
     Sharm El Sheikh 7,800 / Nubia 9,200 EGP per adult, marked FICTIONAL DEMO (needs step 0.2).
   - Research: `عايز خطة رحلة للمالديف 5 أيام` → plan with cited sources.
   - Voice: microphone button and "استمع" (Listen) on a reply.
4. Reload the page: the conversation stays in the history (Supabase persistence).

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| API crashes with `Production guard: …` | A required variable above is missing or wrong (the message names no values). |
| API crashes with `Supabase target is not the verified Sadeeman project` | `SUPABASE_URL`/`SUPABASE_PROJECT_REF` mismatch. |
| Web build fails: `API_ORIGIN must be the API service URL` | Set `API_ORIGIN` on the web service, then redeploy. |
| Chat shows a connection/origin error (`FORBIDDEN_ORIGIN` 403) | `WEB_ORIGIN` must equal the web URL exactly (https, no slash). |
| Company catalog empty | Apply the migration in step 0.2. |
| "كل نماذج الذكاء الاصطناعي عليها ضغط دلوقتي" | Gemini overloaded and Groq's per-minute limit hit; transient (see logs: `[agent] run failed … attempts=`). |
