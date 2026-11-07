# 11 · Model, search, TTS/STT and external-provider decision records

**Time-varying notice:** Any rate limit, free-tier entitlement or model availability can change. Check provider consoles and official docs at IMPLEMENTATION time, recording verification date in `ENVIRONMENT_AUDIT.md`. Never assume a consumer ChatGPT/Claude subscription gives API credit.

## Model candidates
- Gemini Developer API: available free tiers for selected models; compatible API adapter and function calls must be actually tested. Be aware some free usage terms permit content processing for service improvement. Official: https://ai.google.dev/gemini-api/docs/pricing and https://ai.google.dev/gemini-api/docs/function-calling
- GroqCloud: high speed inference and Whisper transcription, subject to org/model/audio rate limits. Official: https://console.groq.com/docs/rate-limits and https://console.groq.com/docs/speech-to-text
- OpenRouter: optional routing/fallback; free models have variable quotas/availability. Official: https://openrouter.ai/docs
- OpenAI and Anthropic API: optional paid integrations only with approved keys and cost; never implicitly included in ChatGPT or Codex subscriptions.

## Research tools
- Tavily Search API (if credentials and acceptable terms); use authoritative sources and cite. Official: https://docs.tavily.com/
- Official immigration/visa government and travel authority websites first for changing entry rules.
- Contracted booking/supplier APIs only after approval; search engines do not prove inventory. Weather and exchange-rate providers used only with current verified endpoints.

## Voice
- Recorded audio -> STT with verified Whisper/Groq or equivalent -> user correction -> text agent -> TTS through actually available provider.
- Gemini Live or comparable realtime as future optional, but free-tier and privacy caveats must be evaluated.
- Never display a live-voice mode as connected if a handshake never succeeded.

## Model routing policy example
Simple questions -> lowest-cost capable verified model; multi-step tool tasks -> capable tool-supporting primary; outages -> compatible tested fallback; irreversible actions -> mandatory consent irrespective of model. No blanket 'the most models means smartest.'

## Cost / privacy controls
Feature flags, daily token budgets, rate caps, anonymized dev fixtures, provider-specific data-processing disclosures and kill switches. No real customer records on an unreviewed free model tier. Export provider decisions in source controlled documentation, not hardcoded into marketing claims.
