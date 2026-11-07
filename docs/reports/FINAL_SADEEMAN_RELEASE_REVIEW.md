# SADEEMAN AI — Final Release Review (Claude takeover)

Date: 2026-11-06 · Machine: Windows 10, Node 24.14.1, pnpm 11.25.0 · Not a git repository; nothing was pushed or deployed.

## 00. UI/UX rebuild and Listen fix (2026-11-06 evening)

| Defect | Root cause (measured) | Fix | Evidence |
|---|---|---|---|
| Multiple scrollbars | At 1366×768: `aside.sidebar` scrolled (1445/768) **and** `.history-list` scrolled inside it (933/93); `main` scrolled (804/685) because `.chat-scroll` had `flex:1` without `min-height:0` | New `app/shell.css`: grid/flex shell with `minmax(0,1fr)` and `min-height:0`. The only scrollers are the message list and the history list; the settings dialog body and `main` (sign-in card) scroll only when the content genuinely exceeds them. Nested gate scroller removed. | `tests/e2e/layout.spec.ts`: 13 viewports (320×568 … 1920×1080, plus zoom 125/150/200%). Sign-in, empty and 40-message states each assert: no document scroll in either axis, zero unexpected scroll containers, no scrolling history cards, composer visible, toolbar above the messages, first message reachable |
| Cluttered navigation | Account and privacy were primary pages; raw UUID shown | Sidebar: new chat, previous chats, settings. A native-dialog settings panel holds General / Privacy & data (consent, saved preferences, deletion) / Account (sign in/out). Old `#/profile`, `#/memory` and `#/settings` links open the matching tab. UUID removed from all screens. | E2E: no navigation landmark, no "حسابي", no UUID in page text; privacy controls reachable |
| Responsiveness | Desktop layout squeezed | Drawer below 1024px (focus moves in, Escape returns focus, background inert); collapsible sidebar on desktop; compact welcome with suggestion chips; auto-growing composer | Screenshots in `CLAUDE_HANDOFF/screenshots/layout/` (16 files) |
| Listen silent / vague | `ENABLE_VOICE` absent from the owner `.env` (only the legacy `ENABLE_REALTIME_VOICE`), so `/voice/speak` returned 503; the button discarded the error code and never checked capability | Capability check before any request; exact prerequisite shown; real error codes mapped; play/pause/stop; no duplicate requests; autoplay-block message; startup warning for the legacy flag | E2E: Listen on a voice-disabled server shows the `ENABLE_VOICE=true` instruction and no fake playing state. **Live TTS not verified (paid, needs approval)** |
| Artificial background | Purple haze, sine-wave dunes, glow blob behind the text | Ridged dunes, low raking sun, wind ripples, natural night and dawn palettes, faint aurora; orb moved above the text with a dimmer halo; edge-free readability scrim | Visual review of the Playwright screenshots in both themes |

Final gates: lint 115 files clean; 4/4 typechecks; vitest **29 files, 367/367**; API and web builds; Playwright **24/24** (re-run after the last CSS/shader tweaks, and passing).

## 0. Owner scope correction (2026-11-06, supersedes all CRM content below)

SADEEMAN AI is a **standalone bilingual conversational AI assistant** with deep travel expertise and general Q&A. It is **not** a CRM, staff portal, booking dashboard or automation system. Earlier rows in this report about the CRM (§C 15, 16, 20, 25; the CRM journey in §B/§G) describe a feature that has since been **removed**.

| Change | Files | Verification |
|---|---|---|
| **AI reply failure root-caused.** Supabase logs for the owner's turn (13:56 UTC) show guest auth, conversation, `propose_travel_constraints` ok, `assess_travel_request` ok and `research_destination` ok (Tavily, 2.7 s). The final Gemini answer was then rejected by the strict citation/diagnostics check with no recovery. | `apps/api/src/agent/runtime.ts` | One tools-off rewrite with the exact allowed URLs; a second failure still fails (safety kept). Code-only `[agent] run failed: …` console line. Tests: repeated bad citation → still `UNGROUNDED_RESPONSE`; corrected rewrite → completed. **Live re-test pending owner approval.** |
| CRM removed end to end | Deleted `apps/api/src/crm/`, `packages/contracts/src/crm.ts`, `crm-panel.tsx`, `review-dialog.tsx`, `tests/crm-workflow.test.ts`; removed the `prepare_customer_request` tool, DB actions, health field, run snapshot field, prompt text, diagnostics line and dead CSS; 2 CRM-only eval specs dropped, 5 recast as boundary specs | Typecheck and lint clean; tests assert no CRM tool, no CRM tables in new DBs, and no CRM UI/route |
| Conversation-first UI | `workspace.tsx`, `celestial.css` | Nav: chat / account / memory & privacy / settings, plus new chat and history. Single centred chat column; contextual trip chips, sources and delete only when relevant; general-assistant welcome and starters; account and session moved to "حسابي". |
| General assistant verified offline | `tests/natural-agent.test.ts` | Prompt keeps "Answer off-topic questions fully" with no CRM wording; 3 general questions complete as plain answers with zero tool calls (**simulated model**) |
| **Citation matching hardened** (likely trigger of the live failure) | `apps/api/src/research/grounding.ts` | The same returned page now matches across `www.`, a trailing slash, http/https, host case, fragments, RTL bidi marks, glued Arabic text and decoded Arabic paths. Path and query stay significant, so an un-returned URL still fails. 17 tests in `tests/citation-matching.test.ts`. Reviewed independently by senior-ai-automation-architect (no blockers; its 3 refinements were applied). |
| Final gates (2026-11-06 20:18) | — | vitest **29 files, 366/366**; Playwright E2E **9/9**; lint clean (112 files); contracts/API/web/tests typecheck; API and web builds pass. All provider behaviour is **simulated**; live is unverified |
| Four demo programs | — | **Not found anywhere** (repo or Cloud, which has 0 rows). Not invented; owner data needed (KNOWN_ISSUES #2) |

## A. Executive summary

The two defects from the owner's manual testing are **fixed and verified in a real browser**. "Start as guest" failed, and the sidebar looked decorative. Guest entry broke because of an origin mismatch between `127.0.0.1` and `localhost`. It was not a missing credential.

The authentication gate was redesigned. A genuine Three.js "Celestial Dunes" scene now reacts to real agent states. Navigation has real URLs. The agent's grounding no longer throws away valid trip facts when a model guesses optional details. Provider failover no longer burns the turn budget.

Still outstanding, and needing the owner or external access:
- a bounded **live** M3 run
- the CRM **Cloud migration** (plan below)
- **Supabase Anonymous sign-ins** must be enabled for Cloud guest entry
- live voice and device verification
- the Cloud session-claim fixture

**Verdict: LOCALLY COMPLETE — EXTERNAL ACCEPTANCE PENDING** (§K).

## B. Actual agent contributions

All nine installed agents were invoked as real subagents. Reviewers were read-only. Only one agent wrote a file, the 3D scene. The main engineer integrated and re-verified everything.

| Agent | Invoked | Reviewed | Changed | Verified |
|---|---|---|---|---|
| ai-project-manager | Yes | Master Prompt and docs vs code traceability; top-10 customer-visible gaps | Nothing (read-only) | Static code reading only |
| senior-backend-developer | Yes | CRM migration (RLS, definer functions, indexes); API security; UI↔API contract; local vs Supabase feature matrix | Nothing | PGlite scratch test of FK cascade order |
| senior-ai-automation-architect | Yes | ASK/ACT/ANSWER trace of the 3-turn scenario; grounding all-or-nothing defect; routing retry policy | Nothing | Code reading (its own vitest attempts hung via `pnpm exec`) |
| senior-ui-ux-designer | Yes | Gate/auth pattern, tokens with contrast, typography, components, text over 3D | Nothing (spec) | Static review |
| senior-game-developer | Yes | — | **Wrote `apps/web/components/celestial-scene.tsx`** | Web typecheck; main engineer verified rendering in Chromium |
| senior-motion-video-producer | Yes | Scene motion language, state flicker, UI motion tokens; found a ~6 Hz error flicker (WCAG 2.3.1 risk) | Nothing (spec) | Static review |
| senior-frontend-developer | Yes | React races, StrictMode persistence bug, refresh-token flow, raw error leaks, scene disposal and shader safety | Nothing | Web typecheck |
| senior-devops-engineer | Yes | Root causes of "pnpm not recognized", launcher, GitHub readiness, secret scan (names only), CI | Nothing (proposed `tools/dev.ts` and CI) | PATH and shim inspection |
| frontend-qa | Yes | Playwright customer journeys on the live local stack: gate keyboard flow, hash routing, CRM create/note/status/search/persist/delete, memory consent/save/edit/delete/withdraw, settings persistence, logout, 5 viewports, console/network | Nothing | Found 1 P1 + 6 P2 + 11 P3 issues; P1, all P2 except "focus after CRM actions", and most P3 were fixed (§C 20–27) |

Skills and MCP used: the Supabase MCP (read-only `query_logs`, which proved the guest request never reached Supabase), the built-in browser, Playwright (QA agent), and the impeccable design hook (one gradient-text finding fixed). The Context7 docs MCP needs authorisation and was not available. The bundled Next 16 docs in `node_modules/next/dist/docs` were used instead.

## C. Defects found and fixed

| # | Symptom | Root cause | Files | Fix | Evidence |
|---|---|---|---|---|---|
| 1 | «ابدأ محادثة كضيف» → "الخدمة مش متاحة دلوقتي" | `next dev --hostname 127.0.0.1` serves `http://127.0.0.1:3000`; `WEB_ORIGIN=http://localhost:3000`; the API rejected any non-exact Origin with 403. Browsers send Origin only on POST, so `/health` (GET) passed. Supabase logs showed **no** auth request that day. The E2E harness used matching origins, so it never caught this. | `apps/api/src/server.ts`, `errors.ts` | Accept WEB_ORIGIN plus its loopback twins (same scheme and port only); new `FORBIDDEN_ORIGIN` code with an actionable Arabic message | Regression test (`tests/server.test.ts`); browser: `POST /auth/guest → 201` from 127.0.0.1:3000 with WEB_ORIGIN=localhost:3000 |
| 2 | Sidebar items did nothing visible | Signed-out, every view rendered the gate unchanged; no URLs | `workspace.tsx` | Hash routing with deep links and back/forward; signed-out private views show the gate with a notice; Settings works signed-out | Browser script: all 5 views, back/forward, signed-out deep link |
| 3 | Awkward `<details>` login | Disclosure under the CTA | `workspace.tsx`, `app/celestial.css` | Glass gate card, ARIA tabs, consent row, loading/disabled states, password toggle, in-card errors, focus management, truthful "no signup/reset" note, mobile bottom sheet | Desktop and 390px screenshots |
| 4 | Results/draft from conversation A shown in B | `openConversation`/delete didn't clear artifacts or `crmDraft` | `workspace.tsx` | `resetConversationView()` | Code + QA |
| 5 | Failed message stayed in chat as if sent; new conversation missing from history | Optimistic bubble never removed; history reload only on success | `workspace.tsx` | Remove the optimistic bubble unless the turn completed; reload history in `finally` | Browser |
| 6 | Hourly logout in Supabase mode | Refresh token never stored or used | `lib/api.ts` | Single-flight refresh on 401; wipe only on 400/401/403; `session-expired` event returns to the gate | Typecheck/review |
| 7 | Raw English/JSON errors could reach customers | `send()` showed `e.message` for any error; stream fetch/parse errors unmapped | `lib/api.ts`, `workspace.tsx` | Code→Arabic map (`failureMessage`); NETWORK detection; stream errors wrapped | Review |
| 8 | Saved theme/locale/motion reset in dev; OS motion preference frozen | Persist effects ran with defaults (StrictMode) | `workspace.tsx` | Persist only on explicit user choice | Review |
| 9 | Skip link switched to chat view | `#main` hit the hash router | `workspace.tsx` | Ignore non-view hashes | Review |
| 10 | Send/cancel race | Shared AbortController ref | `workspace.tsx` | Per-call controller; finalize only its own run | Review |
| 11 | Live M3 failure: all facts discarded | One ungrounded optional field (adults from «شخصين», budgetBasis without evidence) rejected the whole proposal | `apps/api/src/travel/context.ts` | Drop ungrounded optional fields (left unknown, reported as `droppedFields`) only when grounded core facts accompany them; core-field errors still reject | Real Gemini trace replay now completes on the first proposal; new `tests/m3-three-turn-robustness.test.ts` |
| 12 | Restating "same duration/count" failed | An unchanged budgetBasis with weak evidence was re-validated | `context.ts` | Weak evidence keeps the confirmed value without upgrading confidence | Tests |
| 13 | Stale party split after "لو بقينا 3" | adults=2 carried over to travellers=3 | `context.ts` | Clear adults/children when the head-count changes and they are not restated | Tests |
| 14 | A hung Gemini took ~30 s before Groq | Same-provider retry on timeout/quota | `providers/router.ts` | Immediate failover when a fallback exists; single-provider retry kept; most informative error reported | 2 new router tests |
| 15 | 429s while typing in CRM search | 3 requests per keystroke | `crm-panel.tsx` | 350 ms debounce, parallel calls | Code |
| 16 | CRM in Supabase mode → misleading DB error; dead-end draft banner | Routes not gated like `/health` | `crm/routes.ts`, `workspace.tsx` | `DISCONNECTED` outside local mode; banner hidden | crm-workflow tests |
| 17 | Error flicker ~6 Hz across the whole sky | Shader flick term | `celestial-scene.tsx` | ~2 Hz single beat; minimum-dwell layer prevents state strobing; glow tint actually applied | Review + render |
| 18 | `(local, public_only)` looked like a failure | Terse startup line | `apps/api/src/main.ts`, new `diagnostics.ts` | Readiness summary (persistence, guest, model, research, CRM, voice, origin) with warnings; never prints secrets | `tests/diagnostics.test.ts`; real startup output |
| 19 | Mobile layout pushed everything off-screen | New stacking rule overrode the fixed mobile drawer | `celestial.css` | Drawer stays fixed; backdrop + Escape close | 390px screenshot |

| 20 | (QA P1) Normal CRM use → 429 everywhere; after reload the banner wrongly said "server offline" | Each CRM action made 3 GETs against a 30/min global limit; the health catch treated every error as offline | `crm-panel.tsx`, `workspace.tsx`, `config.ts`, `.env.example` | Filters fetch the list only, the directory loads once and after mutations; a 429 at health shows the rate message; default and example limit 120/min | Code + typecheck. **The owner's `.env` still pins `RATE_LIMIT_MAX=30` — change it to 120** |
| 21 | (QA P2) Page scrolled at 1440×900; sidebar background ended mid-page; account row cut at 1024 | Shell not height-bounded | `celestial.css` | Fixed `100dvh` frame; only main, context panel and sidebar scroll; alert overlays instead of pushing content | Browser: document height = viewport (900) |
| 22 | (QA P2) Tablet header wrapped and clipped at 768 | Breadcrumb and actions wrapping | `celestial.css` | Breadcrumb hidden ≤1200 px, no-wrap actions; CRM filters wrap | 768×1024 screenshot |
| 23 | (QA P2) Mobile drawer: no focus entry, background tabbable | Missing focus management | `workspace.tsx` | Focus moves into the nav on open; background `inert`; backdrop and Escape return focus to ☰ | Code |
| 24 | (QA P2) Memory consent invisible and lost on navigation; destructive actions without confirmation | Consent id held only in component state | `privacy-panel.tsx`, `lib/api.ts` | Consent id kept for the tab session (cleared on logout); visible state line; confirmations on withdraw-all and delete | E2E updated to accept the confirm |
| 25 | (QA P2) Raw English enums (`inquiry · new`, `travel_style`) | No label maps | `crm-panel.tsx`, `privacy-panel.tsx` | Arabic labels; stored values unchanged | 768 screenshot |
| 26 | (QA P3) Empty conversations accumulate; no "no results"; same page title everywhere; chat-disabled only discovered after sending | — | `workspace.tsx` | Reuse an empty conversation; "no results" text; per-view `document.title`; up-front composer note when chat is disabled | Browser |
| 27 | (QA P3) 22 px checkbox, 4.3:1 placeholder, orb behind subtitle, favicon 404 | — | `celestial.css`, `app/icon.svg` | 24 px targets, `--text-3` placeholder, soft scrim behind the welcome text, SVG icon | Browser |

Not fixed, and tracked:
- Focus after the CRM confirm and delete still falls back to the document.
- The CRM detail pane still shows a record that the active filter excludes.
- The structural redesign of the CRM, privacy and voice panels is beyond this pass. They received the token and legibility layer only.

Considered and **rejected**: switching `trustProxy` on to key rate limits per client. It reopened spoofed `X-Forwarded-For` resets of the guest limit, which an existing security test caught. It was reverted and tracked for production.

## D. Feature completion

- **M3 Travel Intelligence:** the runtime is complete for local use. Robustness fixes 11–14 are in place. **Live acceptance pending** (one approved bounded Gemini run of the 3-turn scenario).
- **M4 CRM:** complete locally on real PostgreSQL with RLS. **Cloud not applied** (§F).
- **M5 Voice:** adapters, recording, review and playback are implemented, and the 3D presence reflects real mic and playback phases. **Live quality unverified; full duplex not implemented.**
- **M6 Premium frontend:** a real Three.js scene, gate redesign, tokens, fonts, navigation, error/status system. The CRM, privacy and voice panels received the token and legibility layer but no structural redesign.

## E. Three.js and UI/UX delivery

`apps/web/components/celestial-scene.tsx` uses vanilla three 0.187 (already a dependency; no new packages):
- a displaced-plane dune ShaderMaterial (crest rim light from violet to coral to amber, fog)
- a gradient sky sphere with fbm aurora
- additive dust points
- an orb made of a fresnel core, glow sprite, ripple rings and orbit particles

States are mapped from real app signals in `workspace.tsx`:

| State | Real signal |
|---|---|
| listening | MediaRecorder `recording` |
| thinking | model processing or transcribing |
| tool | `tool_started` event |
| speaking | TTS audio playing |
| error | 2.4 s after a real error |

Behaviour and safeguards:
- **Easing:** asymmetric (0.18 s attack, 0.45 s release) with minimum dwell (tool ≥ 0.7 s after a 150 ms enter delay).
- **Load and resolution:** three is lazily imported in an effect. DPR is capped at 1.75. On small or low-core devices, segments and particles are reduced and rendering is capped at about 30 fps.
- **Reduced motion:** one static frame, re-rendered on resize, theme and state.
- **Lifecycle:** the loop pauses while the tab is hidden. Context loss and restore are handled. WebGL failure falls back to a CSS gradient. Every resource is disposed on unmount.

UI work:
- fonts self-hosted through `next/font` (IBM Plex Sans Arabic body, Alexandria display)
- legacy 7–12 px text raised to at least 13 px
- a token layer with AA-targeted text tokens
- glass surfaces with `@supports` fallbacks
- a service-status chip
- unified alerts
- motion tokens shared with the scene

Screenshots: `CLAUDE_HANDOFF/screenshots/` (regenerated by the E2E run — §G).

## F. API, database and Cloud state

Working locally: Web → Next proxy → API (Fastify, 127.0.0.1) → PGlite/Postgres with RLS; guest/session/history/CRM/memory/consent.

Supabase mode was **not exercised end-to-end by Claude**. Every guest sign-in creates a real anonymous Cloud identity, and no cleanup plan was approved.

Owner actions for Cloud guest entry:
1. Supabase Dashboard → Authentication → Sign In / Providers → enable **Anonymous sign-ins** for project `ujdzysbowngtkwndgoqf` (consider CAPTCHA, then set `REQUIRE_GUEST_CAPTCHA=true`).
2. Keep `ENABLE_SUPABASE_GUEST=true`.

**CRM migration: retired, not applied.** Per the owner scope correction it was moved to `supabase/retired/` with a README. It was never applied to Cloud and must not be. New local databases no longer receive it. Existing local tables were left untouched, with no destructive drop. The earlier application plan and forward-fix list are obsolete.

## G. Final QA evidence

All commands were run by Claude on 2026-11-06 on this machine, against the final code.

| Command | Observed outcome |
|---|---|
| `node node_modules/vitest/vitest.mjs run --maxWorkers=1` | **29/29 files, 352/352 tests PASS** (started 15:44:40, 73.6 s). The baseline was 343; new tests cover the origin regression, the 3-turn scenario (4 cases), router failover (2), and startup diagnostics (2). Provider transports in these tests are **simulated**. |
| `tsc --noEmit` for contracts, API and web, plus `tsconfig.tests.json` (tests and tools) | **PASS**, all four |
| `biome check .` | **PASS**, 116 files, 0 errors |
| `next build` (apps/web) | **PASS**, compiled, 3/3 static pages |
| `node tools/run-e2e.ts` (Playwright and Edge, isolated 3100/4100, real local SQL, providers off) | Final run **9/9 PASS** (44.9 s). The previous run had **1 failure**: the mobile test's guest call exceeded the 10 s expectation while a production build was running concurrently. It passed on rerun with no code change. This is recorded as a timing flake. |
| `node tools/dev.ts` (local mode) | Rebuilt the stale API, printed the readiness summary, started web, and printed the URL. Probes: web 200; guest `POST` via the proxy with Origin `127.0.0.1:3000` → **201**. Stopping it left no processes or ports behind. Interactive Ctrl+C was not exercised by hand. |
| Browser (built-in Chromium pane) | Gate, guest entry, 5 views, back/forward, signed-out deep link, truthful chat-disabled path, 1440/768/390 px layouts, light/dark themes. A fresh tab shows **0 console errors**. |
| QA agent (Playwright Chromium) | Journeys listed in §B; findings fixed per §C 20–27 |

Coverage limits:
- Not run: Safari/Firefox, real phones, screen readers, OS-level reduced motion, and any live provider, Supabase, Auth or voice path (all intentionally, with zero paid or Cloud calls).
- The only Cloud access was one read-only Supabase log query.
- Security verification: origin allowlist tests, the existing 10/10 security-hardening tests, and the RLS/two-user local integration tests inside the 352-test suite. The new guest-limit spoofing protection was kept after a rejected change.

## H. Known limitations

See `CLAUDE_HANDOFF/KNOWN_ISSUES.md` (13 items with severity context). The blocking ones are the external acceptance gates in §A.

## I. GitHub readiness

| Item | Status |
|---|---|
| `.gitignore` | Covers `.env*` (except the example), `.private/`, `.pnpm-store/`, `node_modules`, `.next`, `dist`, `test-results`, `.claude/`, `supabase/.temp` |
| Secret scan (names only) | The only hit outside ignored files is the literal test placeholder `sb_secret_test` in `tests/supabase.test.ts` |
| Large files | None over 500 KB |
| License | `license: UNLICENSED` (private) — owner to decide |
| CI | `.github/workflows/ci.yml` proposed (install, build, typecheck, lint, vitest; no secrets). **Not run** |

**Safe to publish after the owner reviews** `CLAUDE_HANDOFF/screenshots` and the starter artifacts (`START_HERE_CODEX.txt`, `STARTER_FILE_MANIFEST.json`). Not done: `git init`, commit, push.

## J. Exact local startup (PowerShell)

```powershell
cd C:\Users\youss\Desktop\Sadeeman
node -v                          # v24.x
pnpm -v                          # 11.25.0 (if not recognized: open a NEW terminal, or npm i -g pnpm@11.25.0)
pnpm install --frozen-lockfile   # first time only
node tools/dev.ts                # builds stale parts, starts API + web, prints the URL
```

Open `http://127.0.0.1:3000/`. Press Ctrl+C to stop both.

## K. Final acceptance verdict

**LOCALLY COMPLETE — EXTERNAL ACCEPTANCE PENDING.** Local functional, security and visual work is verified by the test and browser evidence in §G.

It is not PRODUCTION READY because:
- the live M3 dialogue, the CRM Cloud migration, Supabase Anonymous sign-ins, live voice, and the Cloud session-claim check are all unverified or need owner approval
- production startup is intentionally disabled pending the cookie/CSP and rate-limit-keying work
