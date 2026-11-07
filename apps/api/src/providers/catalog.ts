import { z } from "zod";

// Projection of the public catalog fields required for safe probe selection.
// OpenRouter includes aliases beginning with ONE '~'; embedded/repeated '~' is invalid.
const ModelId = z
  .string()
  .min(1)
  .max(160)
  .regex(/^~?[A-Za-z0-9/_.:-]+$/);
const Price = z
  .string()
  .max(40)
  .regex(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i)
  .refine((value) => Number.isFinite(Number(value)));
export const OpenRouterCatalog = z.object({
  data: z
    .array(
      z.object({
        id: ModelId,
        supported_parameters: z.array(z.string().max(100)).max(100).optional(),
        pricing: z.object({
          prompt: Price,
          completion: Price,
          request: Price.optional(),
        }),
      }),
    )
    .max(5000),
});
export function freeToolModels(
  catalog: z.infer<typeof OpenRouterCatalog>,
): string[] {
  return catalog.data
    .filter(
      (m) =>
        m.id.endsWith(":free") &&
        Number(m.pricing.prompt) === 0 &&
        Number(m.pricing.completion) === 0 &&
        Number(m.pricing.request ?? "0") === 0 &&
        m.supported_parameters?.includes("tools") &&
        m.supported_parameters.includes("tool_choice"),
    )
    .map((m) => m.id);
}
