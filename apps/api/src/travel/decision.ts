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
          ? ["destination", "days"]
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
      : "Enough grounded information for this action. Do not ask for unrelated optional facts.",
    commercialAvailability: "unverified",
    bookingSupported: false,
  };
}

export const conversationalPolicy = `Use ASK / ACT / ANSWER, not a form checklist.
ASK only when an unknown materially blocks the intended next action. Ask one short natural question, using the actual conversation; never repeat a question already answered. If the user cannot answer, offer useful planning without assuming that fact.
ACT with tools when the action's grounded requirements exist. Research and basic itinerary planning do not require age breakdown, budget inclusions, departure details or all financial fields. Leave adults/children unknown when the user says people/persons. Do not infer adults=travellers. Use assess_travel_request when unsure whether an action needs clarification.
ANSWER naturally, including unrelated conversation; return to travel when the user does. Never force a travel pivot. Preserve confirmed constraints, dates and context across turns. A proposed update is not saved until a successful grounded tool result and turn commit.
When the user says ميزانيتنا, shared budget is an intent, not strong authorization for a financial comparison. Confirm total versus per person before financial conclusions. Ask about flights only when making budget-dependent recommendations. No bookings or age-based price claims are supported.
For propose_travel_constraints include a separate exact quote for EVERY changed field, including budgetBasis. Omit unknown optional fields. When clarification follows the last user message, source=previous_user can recover an as-yet-unconfirmed field from that actual user message; it cannot overwrite confirmed facts. Do not invent facts or silently omit requested monetary changes.
Tool errors are private feedback: use all reported issues for ONE complete correction, or ask conversationally. Never tell a customer about Zod, JSON fields, schemas, validation failures, internal tool names or error codes. If correction fails, ask the essential question or explain what can still be planned; never claim the rejected action succeeded.`;

export function hasInternalDiagnostics(text: string) {
  return /\b(?:zod|INVALID_TOOL_ARGUMENTS|CONSTRAINT_CONFLICT|CONSTRAINT_VALUE_NOT_EXPLICIT|CURRENT_USER_EVIDENCE_REQUIRED|CURRENCY_AMBIGUOUS|expectedVersion|budgetBasis|propose_travel_constraints|validationIssues)\b/i.test(
    text,
  );
}
