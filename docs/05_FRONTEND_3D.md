# 05 · Premium 3D standalone agent UI — Celestial Dunes

## THIS IS NOT A TOURISM WEBSITE
The UI is a sophisticated voice/text AI agent WORKSPACE, not a scrolling destination landing page. A sculptural 3D element supports the conversation without competing with it. The brand's unique motion aesthetic is dusk-plum, warm gold, coral and lavender — never borrowed teal/cyan/navy motifs.

## Layout
Desktop: 240–270px left history/navigation rail; center fluid conversation max 900px; optional right context pane with current trip parameters/source citations/memory state and verified agent activity. Tablet: collapse history and move context into drawer. Mobile: single-column chat, 44px targets, bottom safe-area composer, voice recording overlay, modal focus management.

## Required modules
- Welcome/new conversation with authentic prompt starters (not promotional hero).
- User messages / assistant messages with safe Markdown, correct URLs, timestamps, retry, source footnotes and optional real token streaming.
- Dynamic company/demo package result, external listing with verification badge, itineraries and consented quote CTA.
- Journey memory panel with provenance + edit/delete and consent states; no shadow profiling.
- Voice record, waveform from actual microphone amplitude, transcript correction, text fallback and verified speech playback.
- Separate operator CRM routes protected by server role checks (no customer-level access to lead lists).
- Settings: locale, reduced motion, volume, privacy, data history, theme; human handoff when available.

## True 3D feature
`OrbitalLantern`: one abstract, non-humanoid layered mesh evoking a floating meteor and concentric sand-carved rings. Colors plum/coral/amber/lilac; physically reasonable lighting, subtle shader if tested on target GPUs. States: idle=slow breathing; listening=real mic amplitude response; thinking=gentle inward rotation only while actual request running; searching=thin gold trace only from server tool event; speaking=response to actual playback. No simulated thinking inside decorative animations. Use React Three Fiber / Three.js dynamic client-only import, capped DPR <=1.5 on average devices, WebGL context cleanup, focus-safe fallback static SVG, disable on `prefers-reduced-motion` and low-memory/mobile conditions where beneficial.

## Background implementation
CSS layered warm dusk gradients (12–20s gentle drift), sparse topographic dune contours (SVG), a few glinting particles (not dozens of DOM elements), 2–3 depth layers parallax amplitude <=8px on desktop, absolutely no parallax in text region. Never hijack scroll. Clean static layout on reduced-motion or GPU loss.

## Motion
Message enter 160–230ms translateY <=8px; side drawer 200–280ms; audio panels 250ms; orb idle 14–20s. Prefer Motion for React and CSS. GSAP optional only if real performance justification. No animation per token, no forced scroll bounce, no intensive postprocessing.

## Readability / access
WCAG AA contrast checks, solid conversation surfaces over decorative background, keyboard/focus traps, screen-reader message announcements, readable Arabic typography 16px with 1.7+ line height, proper `dir=auto`, bidi isolation for URLs/prices and code, tabular number alignment, keyboard audio controls. Respect reduced motion, light/dark system preference and user overrides. Mobile GPU stable and efficient.

## Acceptance
Test desktop 1440x900, tablet 820x1180, mobile 390x844; browser screenshots before 'done'. Verify dark/light, Egyptian Arabic, long messages, multiline composer, source cards, mic deny, AI timeout, no tools, no history and highly constrained devices. No fake 3D screenshots claim.
