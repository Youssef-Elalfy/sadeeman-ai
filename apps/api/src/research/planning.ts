import { ItineraryRequest, TravelComparison } from "@sadeeman/contracts";
import type { z } from "zod";
import { destinationKey, type ResearchScope } from "./scope.js";

export function planItinerary(
  raw: z.infer<typeof ItineraryRequest>,
  scope: ResearchScope,
) {
  const input = ItineraryRequest.parse(raw);
  const sources = [...new Set(input.sourceIds)].map((id) => {
    const source = scope.sources.get(id);
    if (
      !source ||
      !scope.destinations.get(id)?.has(destinationKey(input.destination))
    )
      throw new Error("SOURCE_NOT_IN_THIS_DESTINATION_RESEARCH");
    return source;
  });
  const blocksPerDay =
    input.pace === "relaxed" ? 1 : input.pace === "active" ? 3 : 2;
  const days = Array.from({ length: input.days }, (_, i) => ({
    day: i + 1,
    researchSuggestions: sources
      .slice(i * blocksPerDay, (i + 1) * blocksPerDay)
      .map((s) => ({ title: s.title, sourceId: s.id, sourceUrl: s.url })),
    timeBasis:
      "UNSCHEDULED_SUGGESTIONS_REQUIRING_LOCAL_TRANSPORT_AND_OPENING_TIME_CHECKS",
    ...(input.dailyBudgetMinor === undefined
      ? {}
      : { dailyAllowanceMinor: input.dailyBudgetMinor }),
  }));
  return {
    label: "ESTIMATED_ITINERARY",
    destination: input.destination,
    interests: input.interests,
    pace: input.pace,
    days,
    ...(input.currency ? { currency: input.currency } : {}),
    sources,
    unfilledDays: days
      .filter((d) => !d.researchSuggestions.length)
      .map((d) => d.day),
    availability: "unverified",
    bookable: false,
    liveInventory: false,
    limitations: [
      "Source pages are research suggestions, not confirmed attractions or reservations.",
      "Unfilled days need more destination research; no invented stops, flights, hotel stock or schedules.",
      "Budget allowances are user estimates, not advertised prices.",
    ],
  };
}
export function compareTravel(
  raw: z.infer<typeof TravelComparison>,
  scope: ResearchScope,
) {
  const input = TravelComparison.parse(raw);
  const options = input.options
    .map((option) => {
      for (const id of option.sourceIds)
        if (
          !scope.sources.has(id) ||
          !scope.destinations.get(id)?.has(destinationKey(option.destination))
        )
          throw new Error("SOURCE_NOT_IN_THIS_DESTINATION_RESEARCH");
      const totalMinor = option.items.reduce(
        (sum, item) => sum + item.unitAmountMinor * item.quantity,
        0,
      );
      if (!Number.isSafeInteger(totalMinor)) throw new Error("MONEY_OVERFLOW");
      return {
        ...option,
        totalMinor,
        overBudgetMinor: Math.max(0, totalMinor - input.totalBudgetMinor),
        withinBudget: totalMinor <= input.totalBudgetMinor,
        perTravellerMinorRoundedUp: Math.ceil(totalMinor / input.travellers),
        perDayPartyMinorRoundedUp: Math.ceil(totalMinor / option.days),
      };
    })
    .sort((a, b) => a.totalMinor - b.totalMinor);
  return {
    label: "ESTIMATED_COMPARISON",
    currency: input.currency,
    totalBudgetMinor: input.totalBudgetMinor,
    travellers: input.travellers,
    options,
    bookable: false,
    liveInventory: false,
    priceBasis: "SUPPLIED_ESTIMATES_ONLY_NO_FX_CONVERSION",
    rounding: "UP_TO_NEAREST_MINOR_UNIT",
  };
}
