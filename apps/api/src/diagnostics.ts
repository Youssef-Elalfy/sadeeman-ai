import type { Config } from "./config.js";
import { dataMode } from "./data-policy.js";

/**
 * Human-readable startup readiness. Shows WHAT is enabled and WHY something
 * is off, so "public_only" is never mistaken for a failure mode. Never prints
 * secret values — only whether a key is present.
 */
export function startupReport(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): {
  lines: string[];
  warnings: string[];
} {
  const has = (value: string) => value.trim().length > 0;
  const warnings: string[] = [];
  if (!config.ENABLE_VOICE && env.ENABLE_REALTIME_VOICE !== undefined)
    warnings.push(
      "ENABLE_REALTIME_VOICE is a legacy name and is ignored. Listen (text-to-speech) and the microphone need ENABLE_VOICE=true.",
    );
  const persistence =
    config.PERSISTENCE_MODE === "supabase"
      ? `supabase (project ${config.SUPABASE_PROJECT_REF})`
      : config.PERSISTENCE_MODE === "local"
        ? `local PostgreSQL (${config.LOCAL_DATABASE_PATH})`
        : "ephemeral (in memory; lost on restart)";
  const guest =
    config.PERSISTENCE_MODE === "supabase"
      ? config.ENABLE_SUPABASE_GUEST
        ? "enabled (Supabase anonymous sign-in)"
        : "DISABLED — set ENABLE_SUPABASE_GUEST=true (requires anonymous sign-ins enabled in Supabase Auth)"
      : "enabled (local session)";
  if (config.PERSISTENCE_MODE === "supabase" && !config.ENABLE_SUPABASE_GUEST)
    warnings.push(
      "Guest entry is off: the «ابدأ محادثة كضيف» button will report the service as unavailable.",
    );
  const providers = [
    config.MODEL_PROVIDER,
    ...config.FALLBACK_PROVIDERS.split(",")
      .map((p) => p.trim())
      .filter(Boolean),
  ].filter((p, i, all) => all.indexOf(p) === i);
  const keyFor = (p: string) =>
    p === "gemini"
      ? has(config.GEMINI_API_KEY) && has(config.GEMINI_MODEL)
      : p === "groq"
        ? has(config.GROQ_API_KEY) && has(config.GROQ_MODEL)
        : config.ENABLE_OPENROUTER_RUNTIME &&
          has(config.OPENROUTER_API_KEY) &&
          has(config.OPENROUTER_MODEL);
  let model: string;
  if (!config.ENABLE_REAL_PROVIDER)
    model =
      "DISABLED — ENABLE_REAL_PROVIDER=false (chat answers honestly that it is unavailable)";
  else {
    const ready = providers.filter(keyFor);
    const missing = providers.filter((p) => !keyFor(p));
    model = ready.length
      ? `${ready.join(" → ")} (configured, not verified until first request)`
      : "DISABLED — no provider has both an API key and a model name";
    if (missing.length)
      warnings.push(
        `Provider(s) without key/model or disabled: ${missing.join(", ")}.`,
      );
  }
  const research = !config.ENABLE_TRAVEL_RESEARCH
    ? "disabled (ENABLE_TRAVEL_RESEARCH=false)"
    : has(config.TAVILY_API_KEY)
      ? "Tavily configured (not verified)"
      : "DISABLED — TAVILY_API_KEY missing";
  const lines = [
    `  Data policy  : ${dataMode(config)} — development workspace; use public, non-sensitive data only`,
    `  Persistence  : ${persistence}`,
    `  Guest entry  : ${guest}`,
    `  Chat model   : ${model}`,
    `  Research     : ${research}`,
    `  Voice        : ${config.ENABLE_VOICE ? "enabled (Groq STT / Gemini TTS)" : "disabled (ENABLE_VOICE=false)"}`,
    `  Browser URL  : ${config.WEB_ORIGIN} (its localhost/127.0.0.1 twin is also accepted)`,
  ];
  return { lines, warnings };
}
