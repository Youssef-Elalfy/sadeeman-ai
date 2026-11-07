# 13 · Interface component and interaction acceptance

## Components
ConversationSidebar, ChatHeader, WelcomePrompts, MessageFeed, UserBubble, AgentBubble, StreamingText, ToolActivity, ResearchSourceCard, CompanyPackageCard, ExternalListingCard, ComparisonView, TripComposer, VoiceRecorder, VoicePlayer, TranscriptReview, PrivacyDialog, MemoryManager, LeadReview, HumanHandoff, OrbitalLantern, CelestialDuneBackground, SettingsDrawer, SafeError, CRMOperatorView.

## Nonfunctional and accurate state requirements
- Agent event state must come from backend: pending / searching / responding / completed / retry / error. No fake countdown, pretend tool call, fictional sources or fake typed streaming.
- Consent is required to write memory/lead. Save UI state only after backend acknowledgment.
- Text composer supports multiline, paste, IME, keyboard submit, attachment guardrails, cancel/retry and draft restoration.
- All controls keyboard accessible with correct labels, contrast, focus and 44px targets on mobile.
- Both light and dark are designed, not invert-only. Preserve Arabic diacritics, RTL alignment, LTR isolation for URLs, and mixed-currency formatting.
- 3D gracefully fails over to vector fallback; prefer reduced-motion and low-powered-device stability.
- Tests: desktop/tablet/mobile, Chrome/Edge, Arabic/English, long reply, no conversations, API down, source unavailable, audio permission denied, 429 and invalid lead.
