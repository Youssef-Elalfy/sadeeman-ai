# Live verification truth table

| Service | Existing genuine evidence | Current delivery evidence |
|---|---|---|
| Gemini | Generation, streaming and tool calling passed historically; two real generations in the last Arabic recheck succeeded | No new live calls; new conversational recovery is offline-tested only |
| Groq LLM | Generation, streaming, tools and fallback passed historically | No new live calls |
| OpenRouter | Authentication previously passed; generation quota blocked | Disabled; zero calls; do not buy credits or retry quota |
| Tavily | One real basic travel search with structured sources previously passed | No new searches; test fixtures are test-only |
| Supabase | Auth/RLS/persistence/memory/consent/deletion and core two-user checks previously passed; owner confirms session migration/history and B cleanup | No connector retry, SQL write, Auth setting or migration-history action |
| Groq STT | Not live-verified | Real multipart adapter and bounded incremental segment orchestration tested offline; real browser MediaRecorder containers with synthetic tone and mocked transcript responses |
| Gemini TTS | Not live-verified | Real request shape and PCM/WAV processing tested with mocked transport |

Latest M3 live run failed acceptance: unsupported `adults:2`, then missing `budgetBasis` evidence. New aggregate feedback allows one complete correction; after a failed correction, tools are disabled and the model can ask naturally. This is tested deterministically, not a claimed live fix.

Any future live acceptance must have separate approval and tight caps (one basic Tavily search, at most ten actual model generations, no same-provider retry, no OpenRouter/Cloud mutation, stop on the first quota failure or unrecovered error). Use new uniquely named evidence files and retain the actual provider/tool sequence. Do not infer current quota or entitlement from a Codex/ChatGPT subscription or old successful request.
