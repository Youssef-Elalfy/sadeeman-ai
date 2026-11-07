import { TravelConstraints } from "@sadeeman/contracts";
import { z } from "zod";
import { SafeError, safeError } from "../errors.js";
import type { ModelRouter } from "../providers/router.js";
import { canonicalPlace } from "../travel/context.js";

export const TravelDialogueCase = z
  .strictObject({
    id: z.string().regex(/^M3-LIVE-\d{3}$/),
    content: z.string().min(1).max(6000),
    requiredTools: z
      .array(z.string().regex(/^[a-z_]+$/))
      .min(1)
      .max(4),
    requiresSources: z.boolean(),
    requiresArabic: z.boolean(),
    expectedConstraints: TravelConstraints.required({
      destination: true,
      days: true,
      travellers: true,
      currency: true,
      budgetMinor: true,
      budgetBasis: true,
    }),
    expectedOptionTotalsMinor: z
      .array(z.number().int().min(0).max(1000000000000))
      .length(2)
      .optional(),
  })
  .refine(
    (c) => c.requiresSources || c.expectedOptionTotalsMinor !== undefined,
  );
export const ComparisonObservation = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  travellers: z.number().int().min(1),
  totalBudgetMinor: z.number().int().min(0),
  options: z
    .array(
      z.object({
        destination: z.string(),
        days: z.number().int(),
        totalMinor: z.number().int().min(0),
        withinBudget: z.boolean(),
      }),
    )
    .min(2)
    .max(5),
});
export function comparisonMatches(
  raw: unknown,
  scenario: z.infer<typeof TravelDialogueCase>,
): boolean {
  const parsed = ComparisonObservation.safeParse(raw),
    expected = scenario.expectedConstraints,
    totals = scenario.expectedOptionTotalsMinor;
  if (!parsed.success || !totals) return false;
  const data = parsed.data;
  return (
    data.currency === expected.currency &&
    data.travellers === expected.travellers &&
    data.totalBudgetMinor === expected.budgetMinor &&
    expected.budgetBasis === "party_total" &&
    data.options.length === totals.length &&
    data.options.every(
      (o, index) =>
        o.days === expected.days &&
        canonicalPlace(o.destination) ===
          canonicalPlace(expected.destination) &&
        o.totalMinor === totals[index] &&
        o.withinBudget === o.totalMinor <= expected.budgetMinor,
    )
  );
}
// Explicit evaluation-only request budget. Does not replace or fabricate provider outputs.
export function capEvaluationRequests(router: ModelRouter, maximum = 12) {
  const state: {
    requests: number;
    maximum: number;
    attempts: { provider: string; outcome: string }[];
  } = { requests: 0, maximum, attempts: [] };
  for (const adapter of router.adapters) {
    const generate = adapter.generate.bind(adapter);
    adapter.generate = async (...args) => {
      if (state.requests >= maximum) throw new SafeError("TURN_BUDGET");
      state.requests++;
      const row = { provider: adapter.id, outcome: "started" };
      state.attempts.push(row);
      try {
        const output = await generate(...args);
        row.outcome = "ok";
        return output;
      } catch (error) {
        row.outcome = safeError(error).code;
        throw error;
      }
    };
  }
  return state;
}
