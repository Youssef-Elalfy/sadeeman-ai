# Known limits and unverified behavior

Updated 2026-11-06 after the owner's **product-scope correction**: SADEEMAN AI is a standalone bilingual conversational assistant with deep travel expertise. It is **not** a CRM, staff portal, booking dashboard or automation system. The CRM feature was removed (see `docs/reports/FINAL_SADEEMAN_RELEASE_REVIEW.md` §0).

## Open — needs the owner

1. **The live AI reply is not yet re-verified.** Supabase logs show that the owner's failed turn (2026-11-06 13:56 UTC) authenticated, created the conversation, and ran three tools successfully: trip facts, assessment, and Tavily research. The finished Gemini answer then failed the strict post-answer check. That check now gets one tools-off rewrite before failing, and the API console prints a code-only reason (`[agent] run failed: …`). Proving the fix needs **one approved, bounded live test** (a few Gemini turns plus one Tavily search).
2. **The four demonstration programs are not in the system.** Hurghada, Nubia, Sharm El Sheikh and Fayoum exist nowhere in the repository, and the Cloud `sadeeman_company_packages` table has **0 rows**. The repo fixture holds four *other* fictional demos (Siwa, Dahab, Aswan, Marsa Alam) used only in tests. Nothing was invented. The owner needs to supply each program's verified title, duration, price (with currency and basis), inclusions, schedule and description. Those then go through the documented catalog validator, followed by a **separately approved** import.
3. **Controlled Cloud missing/expired-claim verification remains open.** No safe privileged fixture or cleanup path exists.
4. **Voice / Listen:** root cause of the silent Listen button: the owner `.env` has only the legacy `ENABLE_REALTIME_VOICE` (ignored); the API reads `ENABLE_VOICE`, which is absent, so voice defaults to off. The button now explains this instead of failing vaguely, and the API warns at startup. To enable it, add `ENABLE_VOICE=true` and restart. Real playback then calls Gemini TTS (paid quota) and is **not yet verified live**. There is no full duplex.
5. **Anonymous guests create real Supabase users** (anonymous sign-ins are enabled and working). Plan a retention or cleanup policy before wider use.
6. **Local `.env`:** set `RATE_LIMIT_MAX=120`. The owner has said they will do this.

## Engineering limits (tracked, not blockers for local use)

7. Local data is not encrypted at rest.
8. Tokens are kept in `sessionStorage`. For production, move the refresh token to an httpOnly cookie and add a CSP. Production startup stays intentionally disabled.
9. Rate limiting is per process/IP with `trustProxy:false` (spoof-safe). Behind a real proxy, key it on a verified client address.
10. The UI chrome is Arabic-first. English conversation and voice work, but the interface is not fully translated.
11. Travel result cards come from the current run and are not restored after a restart. Conversation text is persisted.
12. History search matches the trip number and date only. Conversations have no stored title.
13. The Three.js scene was verified in Chromium/Edge on this machine only. WebGL failure falls back to a gradient.
14. Existing **local** databases under `.private/` that already applied the retired CRM migration still hold those empty tables. They were deliberately not dropped. New databases never get them.

Business automation, scheduling, outreach, CRM, bookings and payments are out of scope.
