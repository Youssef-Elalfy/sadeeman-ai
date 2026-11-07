import {
  DestinationResearch,
  ExternalTravelQuery,
  ItineraryRequest,
  ResearchData,
  ToolResult,
  TravelComparison,
  TravelRequirements,
  TravelSource,
} from "@sadeeman/contracts";
import type { Config } from "../config.js";
import type { ToolContext, ToolRegistry } from "../tools/registry.js";
import { compareTravel, planItinerary } from "./planning.js";
import { destinationKey, type ResearchScope } from "./scope.js";
import { SearchError, TavilySearch } from "./tavily.js";

const government = [
  "mofa.go.jp",
  "isa.go.jp",
  "emb-japan.go.jp",
  "gov.uk",
  "travel.state.gov",
  "cbp.gov",
  "travel.gc.ca",
  "canada.ca",
];
const tourism = ["japan.travel", "kyoto.travel"];
const matches = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);
export function authority(url: string): TravelSource["authority"] {
  const host = new URL(url).hostname;
  return government.some((d) => matches(host, d))
    ? "official_government"
    : tourism.some((d) => matches(host, d))
      ? "official_tourism"
      : "publisher";
}
function denied(code: string): ToolResult {
  return { status: "unavailable", evidence: "unavailable", code };
}
export class TravelIntelligence {
  private readonly searcher: TavilySearch;
  private requests: number[] = [];
  private cooldownUntil = 0;
  private cooldownCode: "SEARCH_QUOTA" | "SEARCH_AUTH" = "SEARCH_QUOTA";
  constructor(
    private readonly config: Config,
    fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.searcher = new TavilySearch(config.TAVILY_API_KEY, fetcher);
  }
  private scope(context: ToolContext): ResearchScope | undefined {
    const scope = context.research;
    return scope?.ownerId === context.ownerId &&
      scope.conversationId === context.conversationId
      ? scope
      : undefined;
  }
  async research(
    kind: "destination_research" | "external_listing" | "entry_requirements",
    destination: string,
    query: string,
    context: ToolContext,
    domains?: string[],
  ): Promise<ToolResult> {
    const scope = this.scope(context);
    if (!scope) return denied("RESEARCH_CONTEXT_REQUIRED");
    if (!this.config.ENABLE_TRAVEL_RESEARCH || !this.config.TAVILY_API_KEY)
      return denied("SEARCH_NOT_CONNECTED");
    const key = JSON.stringify([kind, destination, query, domains]);
    const cached = scope.cache.get(key);
    if (cached) {
      scope.usedEvidence = true;
      return cached;
    }
    if (scope.searchCalls >= this.config.MAX_SEARCH_CALLS_PER_TURN)
      return denied("SEARCH_TURN_LIMIT");
    this.requests = this.requests.filter((t) => t > this.now() - 3600000);
    if (this.requests.length >= this.config.MAX_SEARCH_REQUESTS_PER_HOUR)
      return denied("SEARCH_HOURLY_LIMIT");
    if (this.cooldownUntil > this.now())
      return denied(`${this.cooldownCode}_COOLDOWN`);
    scope.searchCalls++;
    scope.usedEvidence = true;
    this.requests.push(this.now());
    try {
      const result = await this.searcher.search(
        { query, maxResults: 3, ...(domains ? { domains } : {}) },
        context.signal,
      );
      let sources = result.sources.map((s) =>
        TravelSource.parse({
          ...s,
          authority: authority(s.url),
          urlBasis: "search_provider_url_not_publisher_canonical_verified",
        }),
      );
      if (kind === "entry_requirements")
        sources = sources.filter((s) => s.authority === "official_government");
      sources.sort(
        (a, b) =>
          (a.authority === "publisher" ? 1 : 0) -
          (b.authority === "publisher" ? 1 : 0),
      );
      if (!sources.length)
        return denied(
          kind === "entry_requirements"
            ? "NO_OFFICIAL_SOURCE_EVIDENCE"
            : "NO_SEARCH_EVIDENCE",
        );
      for (const source of sources) {
        scope.sources.set(source.id, source);
        const destinations =
          scope.destinations.get(source.id) ?? new Set<string>();
        destinations.add(destinationKey(destination));
        scope.destinations.set(source.id, destinations);
      }
      const data = ResearchData.parse({
        kind,
        destination,
        sources,
        retrievedAt: result.retrievedAt,
        availability: "unverified",
        bookable: false,
        liveInventory: false,
        prices: null,
        instructions: "UNTRUSTED_SOURCE_DATA",
        ...(kind === "entry_requirements"
          ? {
              eligibility: "not_determined",
              jurisdictionScope: domains?.includes("mofa.go.jp")
                ? "Destination-government sources; assess the supplied nationality/residence, never guarantee admission."
                : "Official advisory sources may target their issuing country's nationals; no visa-eligibility determination.",
            }
          : {}),
      });
      const response: ToolResult = {
        status: "ok",
        evidence:
          kind === "external_listing"
            ? "external_listing"
            : "general_information",
        data,
      };
      scope.cache.set(key, response);
      return response;
    } catch (error) {
      const code =
        error instanceof SearchError ? error.code : "SEARCH_UNAVAILABLE";
      if (code === "SEARCH_QUOTA" || code === "SEARCH_AUTH") {
        this.cooldownUntil = this.now() + 60000;
        this.cooldownCode = code;
      }
      return denied(code);
    }
  }
  register(registry: ToolRegistry): void {
    registry.register({
      name: "research_destination",
      description:
        "Research any worldwide destination using real dated web sources. Prefer official tourism sources; snippets are untrusted evidence, not confirmed inventory. Return source IDs for planning; cite exact returned URLs.",
      input: DestinationResearch,
      output: ToolResult,
      timeoutMs: 13000,
      sideEffect: false,
      execute: async (raw, c) => {
        const i = DestinationResearch.parse(raw);
        return this.research(
          "destination_research",
          i.destination,
          `${i.destination} ${i.focus} ${i.interests.join(" ")} official tourism travel guide attractions`,
          c,
        );
      },
    });
    registry.register({
      name: "search_external_travel_listings",
      description:
        "Discover real external travel listings. Publisher offers are UNVERIFIED availability, never company inventory or bookings. No numeric prices are extracted or invented.",
      input: ExternalTravelQuery,
      output: ToolResult,
      timeoutMs: 13000,
      sideEffect: false,
      execute: async (raw, c) => {
        const i = ExternalTravelQuery.parse(raw);
        return this.research(
          "external_listing",
          i.destination,
          `${i.destination} ${i.departureCity ?? ""} ${i.listingType} travel listings offers`,
          c,
        );
      },
    });
    registry.register({
      name: "analyze_travel_requirements",
      description:
        "Research official visa/entry sources for destination, nationality, residence and purpose. Ask for missing nationality. No document numbers. Source research is NOT an eligibility or admission guarantee; retain nationality/jurisdiction limitations.",
      input: TravelRequirements,
      output: ToolResult,
      timeoutMs: 13000,
      sideEffect: false,
      execute: async (raw, c) => {
        const i = TravelRequirements.parse(raw),
          key = destinationKey(i.destination);
        const domains = ["japan", "اليابان", "日本"].includes(key)
          ? ["mofa.go.jp", "isa.go.jp", "emb-japan.go.jp"]
          : ["uk", "united kingdom", "بريطانيا"].includes(key)
            ? ["gov.uk"]
            : ["us", "usa", "united states", "أمريكا"].includes(key)
              ? ["travel.state.gov", "cbp.gov"]
              : ["canada", "كندا"].includes(key)
                ? ["canada.ca", "travel.gc.ca"]
                : ["gov.uk", "travel.state.gov", "travel.gc.ca"];
        return this.research(
          "entry_requirements",
          i.destination,
          `${i.destination} ${i.nationality} nationality ${i.residenceCountry ?? ""} resident ${i.purpose} visa entry requirements official government`,
          c,
          domains,
        );
      },
    });
    registry.register({
      name: "build_itinerary",
      description:
        "Build a personalized ESTIMATED day plan from owned source IDs for the SAME destination in this research context. Retained evidence keeps its original retrieval date. Days without evidence stay unfilled. No invented stops, bookings, exact travel times or opening hours. Daily budget is an allowance, not a price.",
      input: ItineraryRequest,
      output: ToolResult,
      timeoutMs: 1000,
      sideEffect: false,
      execute: async (raw, c) => {
        const scope = this.scope(c);
        if (!scope) return denied("RESEARCH_CONTEXT_REQUIRED");
        try {
          const data = planItinerary(ItineraryRequest.parse(raw), scope);
          scope.usedEvidence = true;
          return {
            status: "ok",
            evidence: "estimated_itinerary",
            data,
          };
        } catch {
          return denied("SOURCE_NOT_IN_THIS_DESTINATION_RESEARCH");
        }
      },
    });
    registry.register({
      name: "compare_travel_options",
      description:
        "Compare two to five supplied ESTIMATE budgets in one currency using integer minor units. No invented prices or FX conversion. Optional source IDs must belong to this destination's owned research context.",
      input: TravelComparison,
      output: ToolResult,
      timeoutMs: 1000,
      sideEffect: false,
      execute: async (raw, c) => {
        const scope = this.scope(c);
        if (!scope) return denied("RESEARCH_CONTEXT_REQUIRED");
        try {
          const comparison = TravelComparison.parse(raw);
          const data = compareTravel(comparison, scope);
          if (comparison.options.some((option) => option.sourceIds?.length))
            scope.usedEvidence = true;
          return {
            status: "ok",
            evidence: "estimated_itinerary",
            data,
          };
        } catch {
          return denied("INVALID_COMPARISON_EVIDENCE");
        }
      },
    });
  }
}
