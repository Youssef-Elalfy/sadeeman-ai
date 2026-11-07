import {
  ConstraintProposal,
  type TravelConstraints,
  TravelState,
} from "@sadeeman/contracts";
import type { z } from "zod";
import {
  budgetBasisGrounded,
  ConstraintIssues,
  currencyGrounded,
  GroundingError,
  normalizeArabic,
  numericGrounded,
  sourceSpan,
} from "./grounding.js";
export interface TravelTurn {
  base: TravelState;
  draft: TravelState;
  userText: string;
  dirty: boolean;
  previousUserText?: string;
}
export const emptyTravelState = (): TravelState => ({
  version: 0,
  constraints: {},
  options: [],
});
export const placeKey = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/[إأآ]/g, "ا").trim();
const aliases: Record<string, string> = {
  ايطاليا: "italy",
  italia: "italy",
  تركيا: "turkey",
  türkiye: "turkey",
  كيوتو: "kyoto",
  اليابان: "japan",
};
export const canonicalPlace = (s: string) =>
  aliases[placeKey(s)] ?? placeKey(s);
const normalize = (s: string) => normalizeArabic(s).trim();
type TravelGroundingValue = string | number | boolean | string[];
/** Optional trip metadata: never invented, and never allowed to sink core facts. */
const optionalMetadata: ReadonlySet<string> = new Set([
  "adults",
  "children",
  "budgetIncludesFlights",
  "budgetBasis",
]);
export function proposeConstraints(
  raw: z.infer<typeof ConstraintProposal>,
  turn: TravelTurn,
) {
  const input = ConstraintProposal.parse(raw);
  if (input.expectedVersion !== turn.base.version)
    throw new Error("TRAVEL_VERSION_CONFLICT");
  const previous = turn.draft.constraints,
    // Mutable copy: ungrounded optional metadata is removed below, never invented.
    patch: Partial<TravelConstraints> = { ...input.patch };
  if (
    patch.currency &&
    previous.currency &&
    patch.currency !== previous.currency &&
    previous.budgetMinor !== undefined &&
    patch.budgetMinor === undefined
  )
    throw new Error("CURRENCY_CHANGE_REQUIRES_EXPLICIT_AMOUNT");
  const currency = patch.currency ?? previous.currency;
  const grounding: {
    field: string;
    normalizedValue: string | number | boolean | string[];
    source:
      | "current_user"
      | "previous_user"
      | "confirmed_context"
      | "staged_context";
    quote?: string;
    start?: number;
    end?: number;
    contextVersion?: number;
    supportingContext?: {
      source: "current_user" | "confirmed_context";
      quote?: string;
      start?: number;
      end?: number;
      contextVersion?: number;
    };
  }[] = [];
  const issues: GroundingError[] = [];
  let basisEvidenceAccepted = false;
  const unchangedGrounding = (field: string, value: TravelGroundingValue) =>
    grounding.push({
      field,
      normalizedValue: value,
      source:
        JSON.stringify(value) ===
        JSON.stringify(turn.base.constraints[field as keyof TravelConstraints])
          ? "confirmed_context"
          : "staged_context",
      contextVersion: turn.base.version,
    });
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const unchanged =
      JSON.stringify(value) ===
      JSON.stringify(previous[field as keyof TravelConstraints]);
    if (
      unchanged &&
      field === "budgetBasis" &&
      input.evidence.some((e) => e.field === "budgetBasis")
    ) {
      // Re-stating an already-known basis may upgrade its confidence only when
      // the new quote really grounds it; a weak quote keeps the confirmed value
      // instead of failing the whole turn (live failure: "نفس المدة والعدد").
      const evidence = input.evidence.find((e) => e.field === "budgetBasis");
      const sourceText =
        evidence?.source === "previous_user"
          ? turn.previousUserText
          : turn.userText;
      const span =
        evidence && sourceText
          ? sourceSpan(sourceText, evidence.quote)
          : undefined;
      if (
        span &&
        budgetBasisGrounded(span.quote, String(value), {
          ...previous,
          ...patch,
        })
      ) {
        basisEvidenceAccepted = true;
        grounding.push({
          field,
          normalizedValue: value,
          source: "current_user",
          ...span,
        });
      } else
        issues.push(
          new GroundingError(
            span
              ? "CONSTRAINT_VALUE_NOT_EXPLICIT"
              : "CURRENT_USER_EVIDENCE_REQUIRED",
            "budgetBasis",
          ),
        );
      continue;
    }
    if (unchanged) {
      unchangedGrounding(field, value);
      continue;
    }
    try {
      const evidence = input.evidence.find((e) => e.field === field);
      const quote = evidence?.quote;
      const sourceText =
        evidence?.source === "previous_user"
          ? turn.previousUserText
          : turn.userText;
      if (
        !sourceText ||
        (evidence?.source === "previous_user" &&
          previous[field as keyof TravelConstraints] !== undefined)
      )
        throw new GroundingError(
          "CURRENT_USER_EVIDENCE_REQUIRED",
          field as keyof TravelConstraints,
        );
      const span = quote ? sourceSpan(sourceText, quote) : undefined;
      if (!span)
        throw new GroundingError(
          "CURRENT_USER_EVIDENCE_REQUIRED",
          field as keyof TravelConstraints,
        );
      const exactQuote = span.quote;
      let explicit = false;
      if (field === "destination")
        explicit =
          canonicalPlace(exactQuote).includes(canonicalPlace(String(value))) ||
          normalize(exactQuote).includes(normalize(String(value)));
      else if (field === "excludedDestinations")
        explicit = (value as string[]).every(
          (v) =>
            previous.excludedDestinations?.includes(v) ||
            normalize(exactQuote).includes(normalize(v)),
        );
      else if (field === "budgetMinor") {
        if (!currency)
          throw new GroundingError("CURRENCY_REQUIRED", "currency");
        if (
          /جنيه|دولار|\b(?:EGP|USD|GBP|EUR|CAD|AUD)\b/i.test(exactQuote) &&
          !currencyGrounded(
            exactQuote,
            sourceText,
            currency,
            previous.currency ??
              (grounding.some((g) => g.field === "currency")
                ? patch.currency
                : undefined),
          )
        )
          throw new GroundingError("CONSTRAINT_VALUE_NOT_EXPLICIT", "currency");
        const exponent =
          new Intl.NumberFormat("en", {
            style: "currency",
            currency,
          }).resolvedOptions().maximumFractionDigits ?? 2;
        const minor = /قرش|minor units|cents/i.test(exactQuote);
        explicit = numericGrounded(
          sourceText,
          span,
          minor ? Number(value) : Number(value) / 10 ** exponent,
          "budgetMinor",
          minor,
        );
      } else if (field === "startsOn" || field === "endsOn") {
        const dates: readonly string[] =
          normalize(exactQuote).match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
        explicit = dates.includes(String(value));
      } else if (typeof value === "number")
        explicit = numericGrounded(
          sourceText,
          span,
          value,
          field as "days" | "travellers" | "adults" | "children",
        );
      else if (field === "budgetIncludesFlights") {
        const q = normalize(exactQuote);
        const no =
          /من غير طيران|بدون طيران|مش شاملة الطيران|لا تشمل الطيران/u.test(q);
        explicit =
          value === false
            ? no
            : !no && /شاملة الطيران|تشمل الطيران|بالطيران/u.test(q);
      } else if (field === "currency")
        explicit = currencyGrounded(
          exactQuote,
          sourceText,
          String(value),
          previous.currency,
        );
      else if (field === "budgetBasis")
        explicit = budgetBasisGrounded(exactQuote, String(value), {
          ...previous,
          ...patch,
        });
      if (field === "budgetBasis" && explicit) basisEvidenceAccepted = true;
      if (!explicit)
        throw new GroundingError(
          "CONSTRAINT_VALUE_NOT_EXPLICIT",
          field as keyof TravelConstraints,
        );
      grounding.push({
        field,
        normalizedValue: value,
        source:
          evidence?.source === "previous_user"
            ? "previous_user"
            : "current_user",
        ...span,
        ...(field === "currency"
          ? {
              supportingContext:
                turn.base.constraints.currency === value
                  ? {
                      source: "confirmed_context" as const,
                      contextVersion: turn.base.version,
                    }
                  : {
                      source: "current_user" as const,
                      quote: turn.userText,
                      start: 0,
                      end: turn.userText.length,
                    },
            }
          : {}),
      });
    } catch (error) {
      if (error instanceof GroundingError) issues.push(error);
      else throw error;
    }
  }
  // Optional metadata never blocks the core trip facts. If ONLY optional fields
  // lack exact evidence (e.g. adults=2 guessed from "شخصين"), drop them so they
  // stay unknown, accept the grounded core fields, and report what was dropped.
  // Any core-field issue still rejects the whole proposal, unchanged.
  const droppedFields: { field: string; code: string }[] = [];
  const issueFields = new Set(issues.map((issue) => String(issue.field)));
  if (
    issues.length &&
    [...issueFields].every((field) => optionalMetadata.has(field)) &&
    // Only when grounded core facts come with it; a proposal made solely of
    // ungrounded optional fields is still rejected so the model gets feedback.
    Object.keys(patch).some((field) => !issueFields.has(field))
  ) {
    for (const issue of issues) {
      const field = String(issue.field);
      if (field === "currency") continue;
      delete patch[field as keyof TravelConstraints];
      droppedFields.push({ field, code: issue.message });
    }
    issues.length = 0;
  }
  if (issues.length) throw new ConstraintIssues(issues);
  const merged: TravelConstraints = { ...previous, ...patch };
  // A changed head-count invalidates an earlier adult/child split unless the
  // user restated it in this turn; keep it unknown rather than stale.
  const clearedFields: string[] = [];
  if (
    patch.travellers !== undefined &&
    patch.travellers !== previous.travellers &&
    patch.adults === undefined &&
    patch.children === undefined
  )
    for (const field of ["adults", "children"] as const)
      if (merged[field] !== undefined) {
        delete merged[field];
        clearedFields.push(field);
      }
  if (merged.startsOn && merged.endsOn && merged.endsOn < merged.startsOn)
    throw new Error("INVALID_TRAVEL_DATES");
  if (patch.excludedDestinations)
    merged.excludedDestinations = [
      ...new Set([
        ...(previous.excludedDestinations ?? []),
        ...patch.excludedDestinations,
      ]),
    ];
  const destination = merged.destination;
  if (
    destination &&
    merged.excludedDestinations?.some(
      (d) => canonicalPlace(d) === canonicalPlace(destination),
    )
  )
    throw new Error("DESTINATION_EXCLUDED");
  let budgetBasisConfidence = turn.draft.budgetBasisConfidence;
  const basisEvidence = input.evidence.find((e) => e.field === "budgetBasis");
  if (patch.budgetBasis && basisEvidence && basisEvidenceAccepted) {
    const strong = /total|إجمال|اجمال|كلنا|للفرد|لكل فرد|per person/i.test(
      basisEvidence.quote,
    );
    budgetBasisConfidence = strong
      ? "confirmed"
      : (budgetBasisConfidence ?? "shared_intent");
  }
  turn.draft = TravelState.parse({
    ...turn.draft,
    constraints: merged,
    ...(budgetBasisConfidence ? { budgetBasisConfidence } : {}),
  });
  if (
    ["destination", "days", "excludedDestinations", "startsOn", "endsOn"].some(
      (field) =>
        field in patch &&
        JSON.stringify(patch[field as keyof TravelConstraints]) !==
          JSON.stringify(previous[field as keyof TravelConstraints]),
    )
  )
    turn.draft.options = [];
  turn.dirty ||=
    JSON.stringify(previous) !== JSON.stringify(merged) ||
    turn.draft.budgetBasisConfidence !== turn.base.budgetBasisConfidence;
  return {
    status: "PENDING_TURN_COMMIT",
    state: turn.draft,
    grounding,
    preservedContext: Object.keys(previous)
      .filter((k) => !(k in patch))
      .map((field) => ({
        field,
        source:
          JSON.stringify(previous[field as keyof TravelConstraints]) ===
          JSON.stringify(
            turn.base.constraints[field as keyof TravelConstraints],
          )
            ? "confirmed_context"
            : "staged_context",
        contextVersion: turn.base.version,
      })),
    unchangedFields: Object.keys(previous).filter((k) => !(k in patch)),
    ...(droppedFields.length
      ? {
          droppedFields,
          droppedFieldsNote:
            "These optional fields were NOT saved because the user did not state them explicitly; they remain unknown. Do not assume them. Ask only if they matter for the next step.",
        }
      : {}),
    ...(clearedFields.length
      ? {
          clearedFields,
          clearedFieldsNote:
            "Traveller count changed, so the earlier adult/child split was cleared and is now unknown.",
        }
      : {}),
    partyCompositionNeedsConfirmation:
      merged.adults !== undefined &&
      merged.travellers !== undefined &&
      merged.adults !== merged.travellers,
  };
}
export function constraintConflict(
  name: string,
  input: unknown,
  turn?: TravelTurn,
): string[] {
  if (!turn || typeof input !== "object" || input === null) return [];
  const args = input as Record<string, unknown>,
    c = turn.draft.constraints,
    conflicts: string[] = [];
  if (name === "compare_travel_options")
    for (const [field, key] of [
      ["travellers", "travellers"],
      ["currency", "currency"],
      ["totalBudgetMinor", "budgetMinor"],
    ] as const)
      if (c[key] !== undefined && args[field] !== c[key]) conflicts.push(field);
  if (name === "compare_travel_options" && c.budgetBasis === "per_person")
    conflicts.push("budgetBasis_requires_explicit_party_total");
  if (name === "compare_travel_options" && Array.isArray(args.options))
    for (const option of args.options) {
      if (typeof option !== "object" || option === null) continue;
      if (c.days !== undefined && "days" in option && option.days !== c.days)
        conflicts.push("options.days");
      if (
        c.destination &&
        "destination" in option &&
        typeof option.destination === "string" &&
        canonicalPlace(option.destination) !== canonicalPlace(c.destination)
      )
        conflicts.push("options.destination");
    }
  if (
    name === "estimate_trip_budget" &&
    c.currency &&
    args.currency !== c.currency
  )
    conflicts.push("currency");
  if (name === "search_company_packages") {
    if (c.days !== undefined && args.days !== undefined && args.days !== c.days)
      conflicts.push("days");
    if (c.currency && args.currency && args.currency !== c.currency)
      conflicts.push("currency");
  }
  if (
    name === "build_itinerary" &&
    c.days !== undefined &&
    args.days !== c.days
  )
    conflicts.push("days");
  if (
    typeof args.destination === "string" &&
    c.excludedDestinations?.some(
      (d) => canonicalPlace(d) === canonicalPlace(args.destination as string),
    )
  )
    conflicts.push("destination");
  if (
    [
      "build_itinerary",
      "search_company_packages",
      "research_destination",
      "search_external_travel_listings",
      "analyze_travel_requirements",
    ].includes(name) &&
    typeof args.destination === "string" &&
    c.destination &&
    canonicalPlace(args.destination) !== canonicalPlace(c.destination)
  )
    conflicts.push("destination");
  return conflicts;
}
