import { readFileSync } from "node:fs";
import { z } from "zod";

const flag = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((v) => v === "true");
const integer = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const Env = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: integer(4000, 1, 65535),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  ENABLE_VOICE: flag("false"),
  GROQ_STT_MODEL: z
    .string()
    .regex(/^[a-zA-Z0-9._-]{1,100}$/)
    .default("whisper-large-v3-turbo"),
  GEMINI_TTS_MODEL: z
    .string()
    .regex(/^[a-zA-Z0-9._-]{1,100}$/)
    .default("gemini-3.1-flash-tts-preview"),
  ENABLE_REAL_PROVIDER: flag("false"),
  ENABLE_PROVIDER_STREAMING: flag("false"),
  PERSISTENCE_MODE: z
    .enum(["ephemeral", "local", "supabase"])
    .default("ephemeral"),
  LOCAL_DATABASE_PATH: z.string().default(".private/postgres"),
  SUPABASE_URL: z.string().default(""),
  SUPABASE_PROJECT_REF: z.string().default(""),
  SUPABASE_PUBLISHABLE_KEY: z.string().default(""),
  ENABLE_SUPABASE_GUEST: flag("false"),
  REQUIRE_GUEST_CAPTCHA: flag("false"),
  GUEST_RATE_LIMIT_MAX: integer(5, 1, 30),
  ALLOW_SYNTHETIC_PROVIDER_DATA: flag("false"),
  MODEL_PROVIDER: z.enum(["gemini", "groq", "openrouter"]).default("gemini"),
  FALLBACK_PROVIDERS: z.string().default(""),
  GEMINI_MODEL: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  GROQ_MODEL: z.string().default(""),
  GROQ_API_KEY: z.string().default(""),
  OPENROUTER_MODEL: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),
  ENABLE_OPENROUTER_RUNTIME: flag("false"),
  PROVIDER_QUOTA_COOLDOWN_MS: integer(60000, 1000, 3600000),
  TAVILY_API_KEY: z.string().default(""),
  ENABLE_TRAVEL_RESEARCH: flag("false"),
  ENABLE_COMPANY_CATALOG: flag("false"),
  ENABLE_TRAVEL_CONTEXT: flag("false"),
  ENABLE_TRAVEL_CONTEXT_PERSISTENCE: flag("false"),
  ALLOW_CATALOG_DEMO: flag("false"),
  MAX_SEARCH_CALLS_PER_TURN: integer(2, 1, 4),
  MAX_SEARCH_REQUESTS_PER_HOUR: integer(20, 1, 100),
  MAX_AGENT_TOOL_ROUNDS: integer(5, 1, 5),
  MAX_TOOL_CALLS_PER_TURN: integer(12, 1, 20),
  MODEL_TIMEOUT_MS: integer(15000, 50, 30000),
  TURN_TIMEOUT_MS: integer(60000, 100, 120000),
  PROVIDER_RETRIES: integer(1, 0, 2),
  MAX_TURN_TOKENS: integer(16000, 128, 32000),
  MAX_OUTPUT_TOKENS: integer(2048, 64, 4096),
  MAX_CONTEXT_CHARS: integer(32000, 1000, 64000),
  // Above 120 only for the isolated QA harness (NODE_ENV=test), see loadConfig.
  RATE_LIMIT_MAX: integer(120, 1, 1000),
});
export type Config = z.infer<typeof Env>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid environment fields: ${[...new Set(parsed.error.issues.map((i) => i.path[0]))].join(", ")}`,
    );
  if (parsed.data.NODE_ENV === "production")
    throw new Error(
      "Production is disabled until durable auth, RLS and privacy gates pass.",
    );
  if (parsed.data.RATE_LIMIT_MAX > 120 && parsed.data.NODE_ENV !== "test")
    throw new Error(
      "RATE_LIMIT_MAX above 120 is allowed only in NODE_ENV=test",
    );
  if (parsed.data.ALLOW_CATALOG_DEMO && parsed.data.NODE_ENV !== "test")
    throw new Error("Catalog demo access is allowed only in NODE_ENV=test");
  if (
    parsed.data.ALLOW_SYNTHETIC_PROVIDER_DATA &&
    parsed.data.NODE_ENV !== "test"
  )
    throw new Error(
      "ALLOW_SYNTHETIC_PROVIDER_DATA is permitted only in an explicitly selected NODE_ENV=test verification environment",
    );
  const fallbacks = parsed.data.FALLBACK_PROVIDERS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fallbacks.some((p) => !["gemini", "groq", "openrouter"].includes(p)))
    throw new Error("Invalid FALLBACK_PROVIDERS");
  if (parsed.data.PERSISTENCE_MODE === "supabase") {
    const {
      SUPABASE_URL: url,
      SUPABASE_PROJECT_REF: ref,
      SUPABASE_PUBLISHABLE_KEY: key,
    } = parsed.data;
    if (
      !/^[a-z0-9]{20}$/.test(ref) ||
      url !== `https://${ref}.supabase.co` ||
      !key ||
      key.startsWith("sb_secret_")
    )
      throw new Error("Supabase target or publishable key is invalid");
    if (key.split(".").length === 3) {
      try {
        if (
          JSON.parse(
            Buffer.from(key.split(".")[1] ?? "", "base64url").toString(),
          ).role !== "anon"
        )
          throw new Error();
      } catch {
        throw new Error(
          "Supabase requires a publishable or legacy anon key, never service role",
        );
      }
    } else if (!key.startsWith("sb_publishable_"))
      throw new Error("Supabase requires a publishable key");
    if (parsed.data.NODE_ENV !== "test") {
      const target = z
        .object({ projectRef: z.string(), apiUrl: z.string() })
        .parse(
          JSON.parse(
            readFileSync(
              new URL("../../../config/supabase-target.json", import.meta.url),
              "utf8",
            ),
          ),
        );
      if (ref !== target.projectRef || url !== target.apiUrl)
        throw new Error("Supabase target is not the verified Sadeeman project");
    }
  }
  return parsed.data;
}
