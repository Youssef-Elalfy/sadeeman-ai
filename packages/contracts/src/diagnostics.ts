import { z } from "zod";
export const ProviderFailure = z.strictObject({
  provider: z.enum(["gemini", "groq", "openrouter"]),
  model: z.string().max(160),
  operation: z.enum([
    "generate",
    "generate_stream",
    "transcribe",
    "synthesize",
  ]),
  category: z.string().regex(/^[A-Z_]{1,80}$/),
  upstreamStatus: z.number().int().min(100).max(599).nullable(),
  quotaScope: z.enum([
    "daily",
    "per_minute",
    "rate_limit_unspecified",
    "unknown",
  ]),
  modelSpecific: z.boolean().nullable(),
  observedAt: z.iso.datetime(),
});
export type ProviderFailure = z.infer<typeof ProviderFailure>;
