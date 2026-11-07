# سَدِيمًا | SADEEMAN AI

**رحلتك أبعد من الخيال.** · **Beyond Destinations. Beyond Expectations.**

An independent, Arabic-first conversational travel workspace. Celestial Dunes identity: plum, violet, coral, amber and ivory. This is an agent application, not a tourism landing page.

Start with [CLAUDE_HANDOFF/START_HERE.md](CLAUDE_HANDOFF/START_HERE.md) for the complete independent review package and [QA_RESULTS.md](CLAUDE_HANDOFF/QA_RESULTS.md) for actual verification outcomes.

## What is implemented

- **Travel intelligence:** genuine Gemini-primary/Groq-fallback tool loop, Tavily research, grounded itinerary and comparison tools, Arabic magnitudes/duals, precise constraint evidence and multi-turn context. ASK / ACT / ANSWER uses action-specific requirements, aggregate validation feedback, one correction and a final text-only clarification. Optional ages and flight inclusions stay unknown until needed. Shared-budget intent requires stronger confirmation before financial conclusions.
- **No CRM by design:** the 2026-11-06 owner scope correction removed customer/lead/staff management. SADEEMAN is a standalone conversational assistant; it cannot create customer records, contact anyone, hand off to a human, book or pay.
- **Voice:** real Groq STT/Gemini TTS adapters, browser recording/upload, measured microphone amplitude, silence/deadline/error/cancellation handling, editable transcript and the same chat pipeline. Voice is opt-in and disabled by default. Optional incremental text uses independently decodable ten-second recording segments (six requests and 5 MB per turn, bounded queue, no retry). These are complete Groq transcription requests, not native provider audio streaming. Whole-audio speech playback supports interruption; continuous full duplex is not advertised.
- **Frontend:** executable Next/React chat-first workspace over a licensed cinematic landmark video (credits: `apps/web/public/media/CREDITS.md`), actual guest/account services, chat/events/history, source/itinerary/comparison cards, memory/consent, account/settings, themes, responsive navigation and reduced-motion/low-power fallback. Arabic-first UI with English conversational/voice language support.

No business automation, scheduled outreach, campaigns, autonomous bookings or payment execution exists or is planned. OpenRouter remains disabled.

## Run locally (Windows PowerShell)

Verified toolchain: Node 24.14.1, pnpm 11.25.0. No Git push or public deployment is performed.

```powershell
cd C:\Users\youss\Desktop\Sadeeman
node -v                          # must be v24.x
pnpm -v                          # 11.25.0 — if "not recognized", open a NEW terminal, or: npm i -g pnpm@11.25.0
pnpm install --frozen-lockfile   # first time only
node tools/dev.ts                # builds what is stale, starts API + web, waits, prints the URL
```

Open the URL it prints (`http://127.0.0.1:3000/`). `localhost:3000` also works — the API accepts the loopback twin of `WEB_ORIGIN`. Press **Ctrl+C** once to stop both services. `pnpm dev` runs the same launcher; `node tools/dev.ts --rebuild` forces a rebuild. The launcher spawns only `node` (no pnpm on PATH needed at run time) and refuses to start if port 3000/4000 is already taken instead of killing anything.

The API prints a readiness summary on start (persistence, guest entry, chat model, research, voice). `public_only` is the **data policy** for this development workspace (public, non-sensitive data only) — not an error.

Use a root `.env` based on `.env.example`; never overwrite existing secrets.

| Mode | `.env` | What works |
|---|---|---|
| Local (no Cloud) | `PERSISTENCE_MODE=local` | Guest, history, memory/consent on disk-backed PostgreSQL under `.private/` |
| Supabase Cloud | `PERSISTENCE_MODE=supabase`, `ENABLE_SUPABASE_GUEST=true` | Guest needs **Anonymous sign-ins enabled** in Supabase Auth; email login for existing accounts |
| Chat | `ENABLE_REAL_PROVIDER=true` + `GEMINI_API_KEY`/`GEMINI_MODEL` (Groq optional fallback) | Real model replies (consumes provider quota). Without it, chat says plainly that it is not enabled — no fake replies |

`ENABLE_TRAVEL_CONTEXT=true` and `ENABLE_TRAVEL_CONTEXT_PERSISTENCE=true` enable durable trip constraints.

```powershell
pnpm typecheck
pnpm lint
pnpm test --maxWorkers=1
pnpm test:e2e
```

`test:e2e` requires a production web build and Microsoft Edge, starts isolated loopback QA services on 3100/4100, uses real disposable SQL/auth, disables providers, and cleans up only its own processes. Two test-only cases mock model/failure transport; they are not live provider evidence. On machines requiring an enterprise CA, use `$env:NODE_OPTIONS='--use-system-ca'`; do not disable TLS verification.

## Acceptance boundaries

M1/M2 historical live generation/persistence evidence is retained. The session migration is already deployed and recorded, seven Cloud contract checks passed, and guest B was deleted according to owner confirmation. **Never replay the approved session SQL or repair it again.**

M3 still needs a separately approved bounded live dialogue and controlled Cloud claim/expiry acceptance. The former CRM migration is **retired** (`supabase/retired/`) and must never be applied. Genuine voice model access, Egyptian Arabic quality and device behavior are not live-verified. Production API startup remains deliberately gated; do not process private customer data before privacy/security acceptance. See the handoff for physical-retention, full-duplex, interface-translation and persistent-artifact limits.

This delivery did not call live model/search/audio providers, retry unavailable connectors, change Cloud/Auth/history, purchase anything or deploy publicly. Existing raw live evidence is preserved rather than relabeled as a pass.
