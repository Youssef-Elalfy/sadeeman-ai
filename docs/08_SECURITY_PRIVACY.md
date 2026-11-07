# 08 · Security, governance and privacy checklist

## Build-time and operations
- `.env` never in repo; `.env.example` includes harmless placeholders only.
- API keys on backend exclusively. Don't log entire prompts, audio, passports, phone, addresses, OAuth/session tokens.
- Verify appropriate processor terms before using customer PII with a free model tier. Avoid forwarding sensitive documents to research services.
- Protect sessions, JWTs, cookies, CORS, CSRF (cookie mutations), authorization and object-level ownership; RLS is defense in depth, not the only gate.
- Prompt injection: web pages, package docs, audio transcripts and snippets are **untrusted content**. No system instruction overrides from these sources.
- Tool validation: strict Zod, allowlisted supplier domains or safe URL policy, block private network ranges including redirect chains, enforce deadlines/output size and max tool rounds.
- Side-effect tools: explicit user approval; server verified idempotency, audit trail, authorization, anti replay.
- Data policy: explain what and why collected, retention, opt-out, deletion and staff visibility. Use demo data without real phone numbers by default.
- Travel decisions: verify official sources for visas, border restrictions and safety; no guaranteed legal or travel compliance advice.
- Raw errors: server logs redacted; customer sees plain-language recoverable message. Don't hide that provider is temporarily unavailable.

## Abuse and quality tests
Cross-tenant access via ID guessing, hidden prompt injection in travel descriptions, malicious markdown links, SSRF link to localhost, forged `consentGranted` tool parameter, fake booking response, concurrency duplicate lead, STT exceeding file size, revoked memory, role escalation, provider exhaustion and inaccurate price unit.

## Operational safeguards
Run-time request/token/cost quotas with stop switch; automatic prompt/version trace correlation IDs without exposing secrets; configurable retention and reproducible removal. Publish privacy disclosures and staff procedures before handling real customer data.
