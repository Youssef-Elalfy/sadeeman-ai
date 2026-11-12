import type { TravelAction, TravelState } from "@sadeeman/contracts";
import type { z } from "zod";

type Field = keyof TravelState["constraints"];
const questions: Partial<Record<Field, string>> = {
  destination: "حابب تسافر فين؟",
  days: "ناوي الرحلة كام يوم؟",
  travellers: "هتكونوا كام شخص؟",
  currency: "تقصد جنيه مصري ولا عملة تانية؟",
  budgetMinor: "حابب تكون الميزانية في حدود كام؟",
  budgetBasis: "الميزانية دي ليكم كلكم ولا لكل فرد؟",
  budgetIncludesFlights: "الميزانية تشمل الطيران ولا الإقامة والمصاريف بس؟",
  adults: "الشخصين دول بالغين ولا معاك طفل؟",
  children: "معاكم كام طفل؟",
};
export function assessTravel(
  action: z.infer<typeof TravelAction>,
  state: TravelState,
  lastAnswer = "",
) {
  const c = state.constraints;
  const required: Field[] =
    action === "conversation"
      ? []
      : action === "research"
        ? ["destination"]
        : action === "itinerary"
          ? ["destination"]
          : action === "age_pricing"
            ? ["travellers", "adults", "children"]
            : ["currency", "budgetMinor", "budgetBasis", "travellers"];
  if (action === "budget_recommendation")
    required.push("budgetIncludesFlights");
  const missing = required.filter((field) => c[field] === undefined);
  if (
    action.startsWith("budget_") &&
    state.budgetBasisConfidence === "shared_intent" &&
    !missing.includes("budgetBasis")
  )
    missing.push("budgetBasis");
  if (
    action === "age_pricing" &&
    c.adults !== undefined &&
    c.children !== undefined &&
    c.adults + c.children !== c.travellers
  )
    missing.push("adults", "children");
  const field = missing[0];
  const question =
    field === "adults" && c.travellers !== 2
      ? "المجموعة فيها كام بالغ وكام طفل؟"
      : field
        ? questions[field]
        : undefined;
  const alreadyAsked = Boolean(question && lastAnswer.includes(question));
  return {
    decision: missing.length
      ? alreadyAsked
        ? "ANSWER"
        : "ASK"
      : action === "conversation"
        ? "ANSWER"
        : "ACT",
    action,
    missingFields: missing,
    optionalUnknowns: (
      ["adults", "children", "budgetIncludesFlights"] as const
    ).filter((f) => c[f] === undefined && !required.includes(f)),
    ...(question && !alreadyAsked ? { suggestedQuestion: question } : {}),
    alreadyAsked,
    guidance: missing.length
      ? alreadyAsked
        ? "Do not repeat the question. Continue nonfinancial planning or explain why this action must wait."
        : "Ask one natural essential question. Continue useful planning that does not depend on the missing fact."
      : action === "itinerary" && c.days === undefined
        ? "Act now: assume a typical duration for this destination, state it in one line and offer to adjust."
        : "Enough grounded information for this action. Do not ask for unrelated optional facts.",
    commercialAvailability: "unverified",
    bookingSupported: false,
  };
}

export const conversationalPolicy = `

Travel decisions (ASK / ACT / ANSWER, not a form checklist)
- Default to ACT or ANSWER. ASK only when an unknown truly blocks the next action and no sensible default exists; ask one short natural question and never repeat a question already answered. If the user cannot or does not answer, continue with stated assumptions.
- Research, recommendations and itineraries need only a destination: when days, dates, party or budget are missing, assume typical values, say so in one line and deliver the full plan. Leave adults/children unknown when the user says people/persons; do not infer adults=travellers.
- Before financial conclusions on a shared budget (ميزانيتنا), confirm total versus per person; ask about flights only for budget-dependent recommendations. No bookings or age-based price claims.
- Preserve confirmed constraints, dates and context across turns. A proposed update is not saved until a successful grounded tool result and turn commit. For propose_travel_constraints include a separate exact quote for EVERY changed field, including budgetBasis; omit unknown optional fields. source=previous_user can recover an unconfirmed field from the previous user message; it cannot overwrite confirmed facts.
- Tool errors are private feedback: use all reported issues for ONE complete correction, or continue conversationally. Never tell the user about Zod, JSON fields, schemas, validation failures, internal tool names or error codes, and never claim a rejected action succeeded.`;

export function hasInternalDiagnostics(text: string) {
  return /\b(?:zod|INVALID_TOOL_ARGUMENTS|CONSTRAINT_CONFLICT|CONSTRAINT_VALUE_NOT_EXPLICIT|CURRENT_USER_EVIDENCE_REQUIRED|CURRENCY_AMBIGUOUS|expectedVersion|budgetBasis|propose_travel_constraints|validationIssues|priceText|amountMinor|partyTotalMinor|sourceRef)\b/i.test(
    text,
  );
}
