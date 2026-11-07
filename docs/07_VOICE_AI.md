# 07 · Voice AI architecture and real-world validation

## Priority order
1. Recordable/uploadable voice note from the browser with proper permission and cancel handling.
2. STT via verified Groq Whisper adapter or alternative; show user the transcript and optionally allow correction before sending.
3. Same agent pipeline (tools, memory and consent) as text. A voice request must NOT bypass guardrails.
4. TTS if actually supported by configured provider + correct Arabic Egyptian voice; play controls + transcription visibility.
5. Full-duplex live mode only AFTER stable voice notes, approved platform data handling, verified realtime service and genuine interruption/VAD support.

## Protocol considerations
Use MediaRecorder supported formats with MIME checks and server-side validation. Bound max bytes/duration and decode safely; scan/request rate limits. Do not transcribe huge unknown data or store original audio by default. Temporary audio may be deleted after processing under explicit policy. Public API must not hand out permanent provider keys to the browser; realtime ephemeral tokens only.

## Language accuracy suite
Held-out consent-safe synthetic samples: Egyptian colloquialisms, numbers 15 vs 50, dates, cities (أوزنجول، طرابزون، كابادوكيا), currency EGP/USD, multilingual names, background fan noise, fast speech, unclear word and interruption. Measure word error rate AND key slot accuracy and report actual values. Don't claim human-like voice quality until listen tests pass.

## Honest UX
Mic on only after granted permission; waveform tracks measured amplitude, not decorative pulse; STT processing state based on real request; transcript can be corrected; no 'realtime connected' badge before handshake. If all services unavailable, display actionable text fallback.
