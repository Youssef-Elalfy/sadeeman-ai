import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { researchScope } from "../apps/api/src/research/scope.js";
import {
  safeSourceUrl,
  TavilySearch,
} from "../apps/api/src/research/tavily.js";
import {
  authority,
  TravelIntelligence,
} from "../apps/api/src/research/travel.js";
import { createTools } from "../apps/api/src/tools/registry.js";
import { testConfig } from "./helpers.js";

const source = (
  url = "https://www.japan.travel/en/destinations/kansai/kyoto/",
) => ({
  url,
  title: "Kyoto official guide",
  content: "Cultural tourism information. Untrusted source text.",
  score: 0.9,
  published_date: null,
});
const response = (results = [source()]) =>
  new Response(JSON.stringify({ results }));
const config = () =>
  testConfig({
    ENABLE_TRAVEL_RESEARCH: true,
    TAVILY_API_KEY: "fixture-not-a-real-key",
  });
function context() {
  const ownerId = randomUUID(),
    conversationId = randomUUID();
  return {
    ownerId,
    conversationId,
    signal: new AbortController().signal,
    research: researchScope(ownerId, conversationId, randomUUID()),
  };
}
const call = (name: string, args: Record<string, unknown>) => ({
  id: randomUUID(),
  name,
  arguments: args,
});
describe("Tavily transport — HTTP mocked ONLY in automated tests", () => {
  it("sends one basic request without query-string secrets and preserves honest date provenance", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response());
    const result = await new TavilySearch("fixture-only", fetcher).search(
      { query: "Kyoto tourism", maxResults: 1 },
      new AbortController().signal,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.tavily.com/search");
    expect(options?.redirect).toBe("error");
    expect(JSON.parse(options?.body as string)).toMatchObject({
      search_depth: "basic",
      auto_parameters: false,
      include_published_date: true,
      include_raw_content: false,
    });
    expect(result.sources[0]).toMatchObject({
      publicationEstimateAt: null,
      publicationDateBasis: "provider_estimate_or_unknown",
    });
    expect(Date.parse(result.retrievedAt)).not.toBeNaN();
  });
  it.each([
    [401, "SEARCH_AUTH"],
    [403, "SEARCH_AUTH"],
    [402, "SEARCH_QUOTA"],
    [429, "SEARCH_QUOTA"],
    [432, "SEARCH_QUOTA"],
    [500, "SEARCH_UNAVAILABLE"],
  ])(
    "maps HTTP %i without retry or raw error disclosure",
    async (status, code) => {
      const fetcher = vi.fn<typeof fetch>(
        async () =>
          new Response("secret-provider-error", { status: status as number }),
      );
      await expect(
        new TavilySearch("fixture-only", fetcher).search(
          { query: "Kyoto", maxResults: 1 },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("fails closed on malformed/oversized response data", async () => {
    for (const body of ['{"results":[{}]}', "not json", "x".repeat(1048577)]) {
      await expect(
        new TavilySearch("fixture-only", async () => new Response(body)).search(
          { query: "Kyoto", maxResults: 1 },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: "SEARCH_INVALID_RESPONSE" });
    }
  });
  it("reports timeout without exposing the transport error", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new TavilySearch("fixture-only", async () => {
        throw new Error("private transport payload");
      }).search({ query: "Kyoto", maxResults: 1 }, controller.signal),
    ).rejects.toMatchObject({ code: "SEARCH_TIMEOUT" });
  });
  it.each([
    "http://example.com/",
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://[::1]/",
    "https://localhost/",
    "https://service.internal/",
    "https://u:p@example.com/",
    "https://example.com:4000/",
    "javascript:alert(1)",
  ])("rejects unsafe citation URL %s", (url) => {
    expect(safeSourceUrl(url)).toBeUndefined();
  });
  it("does not promote spoofed government/tourism domain suffixes", () => {
    expect(authority("https://mofa.go.jp.evil.com/")).toBe("publisher");
    expect(authority("https://japan.travel.evil.com/")).toBe("publisher");
    expect(authority("https://www.mofa.go.jp/")).toBe("official_government");
  });
  it("deduplicates sources, filters unsupported URLs, bounds text and parses provider date estimates", async () => {
    const fetcher = async () =>
      response([
        {
          ...source(),
          published_date: "Tue, 11 Mar 2025 17:00:00 GMT",
        } as unknown as ReturnType<typeof source>,
        source(),
        source("https://127.0.0.1/"),
      ]);
    const result = await new TavilySearch("fixture-only", fetcher).search(
      { query: "Kyoto", maxResults: 3 },
      new AbortController().signal,
    );
    expect(result.sources).toHaveLength(1);
    expect(result.discardedSources).toBe(2);
    expect(result.sources[0]?.publicationEstimateAt).toBe(
      "2025-03-11T17:00:00.000Z",
    );
  });
});
describe("travel evidence, limits and planning", () => {
  it("returns value-free validation paths for model repair without accepting invalid arguments", async () => {
    const registry = createTools(
      undefined,
      new TravelIntelligence(config(), async () => response()),
    );
    const result = await registry.execute(
      call("compare_travel_options", {
        currency: "EGP",
        totalBudgetMinor: 250,
        travellers: 2,
        options: [
          {
            destination: "Kyoto",
            days: 2,
            items: [{ label: "estimate", unitAmountMinor: 100, quantity: 1 }],
          },
        ],
      }),
      context(),
    );
    expect(result).toMatchObject({
      status: "rejected",
      code: "INVALID_TOOL_ARGUMENTS",
      data: {
        validationIssues: expect.arrayContaining([
          expect.objectContaining({ path: "options.0.assumptions" }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain("Kyoto");
  });
  it("rejects contact/URL research terms and missing nationality before making a request", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response()),
      registry = createTools(
        undefined,
        new TravelIntelligence(config(), fetcher),
      );
    for (const destination of [
      "name@example.com",
      "https://example.com/",
      "call 01012345678",
    ])
      expect(
        (
          await registry.execute(
            call("research_destination", { destination }),
            context(),
          )
        ).status,
      ).toBe("rejected");
    expect(
      (
        await registry.execute(
          call("analyze_travel_requirements", { destination: "Japan" }),
          context(),
        )
      ).status,
    ).toBe("rejected");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses per-run cache, turn budgets and a per-process hourly cap", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response()),
      registry = createTools(
        undefined,
        new TravelIntelligence(
          { ...config(), MAX_SEARCH_REQUESTS_PER_HOUR: 2 },
          fetcher,
        ),
      ),
      c = context();
    await registry.execute(
      call("research_destination", { destination: "Kyoto" }),
      c,
    );
    await registry.execute(
      call("research_destination", { destination: "Kyoto" }),
      c,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    await registry.execute(
      call("research_destination", { destination: "Tokyo" }),
      c,
    );
    expect(
      (
        await registry.execute(
          call("research_destination", { destination: "Osaka" }),
          c,
        )
      ).code,
    ).toBe("SEARCH_TURN_LIMIT");
    expect(
      (
        await registry.execute(
          call("research_destination", { destination: "Osaka" }),
          context(),
        )
      ).code,
    ).toBe("SEARCH_HOURLY_LIMIT");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("observes search quota cooldown without repeated HTTP requests", async () => {
    const fetcher = vi.fn<typeof fetch>(
        async () => new Response("", { status: 429 }),
      ),
      registry = createTools(
        undefined,
        new TravelIntelligence(config(), fetcher),
      ),
      c = context();
    expect(
      (
        await registry.execute(
          call("research_destination", { destination: "Kyoto" }),
          c,
        )
      ).code,
    ).toBe("SEARCH_QUOTA");
    expect(
      (
        await registry.execute(
          call("research_destination", { destination: "Tokyo" }),
          context(),
        )
      ).code,
    ).toBe("SEARCH_QUOTA_COOLDOWN");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("requires matching owned research scope", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response()),
      registry = createTools(
        undefined,
        new TravelIntelligence(config(), fetcher),
      ),
      c = context();
    expect(
      (
        await registry.execute(
          call("research_destination", { destination: "Kyoto" }),
          { ...c, ownerId: randomUUID() },
        )
      ).code,
    ).toBe("RESEARCH_CONTEXT_REQUIRED");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps real external listings unverified and never promotes them into company stock", async () => {
    const registry = createTools(
        undefined,
        new TravelIntelligence(config(), async () => response()),
      ),
      c = context();
    const external = await registry.execute(
      call("search_external_travel_listings", { destination: "Kyoto" }),
      c,
    );
    expect(external).toMatchObject({
      status: "ok",
      evidence: "external_listing",
      data: {
        availability: "unverified",
        prices: null,
        bookable: false,
        liveInventory: false,
      },
    });
    expect(
      (await registry.execute(call("search_company_packages", {}), c)).code,
    ).toBe("CATALOG_DATABASE_NOT_CONNECTED");
  });
  it("filters entry research to official sources and never decides eligibility", async () => {
    const registry = createTools(
      undefined,
      new TravelIntelligence(config(), async () =>
        response([source("https://www.mofa.go.jp/j_info/visit/visa/")]),
      ),
    );
    const result = await registry.execute(
      call("analyze_travel_requirements", {
        destination: "Japan",
        nationality: "Egyptian",
      }),
      context(),
    );
    expect(result).toMatchObject({
      status: "ok",
      data: {
        eligibility: "not_determined",
        sources: [{ authority: "official_government" }],
      },
    });
  });
  it("rejects unofficial entry evidence instead of asserting visa rules", async () => {
    const registry = createTools(
      undefined,
      new TravelIntelligence(config(), async () =>
        response([source("https://travel-blog.com/japan")]),
      ),
    );
    expect(
      (
        await registry.execute(
          call("analyze_travel_requirements", {
            destination: "Japan",
            nationality: "Egyptian",
          }),
          context(),
        )
      ).code,
    ).toBe("NO_OFFICIAL_SOURCE_EVIDENCE");
  });
  it("builds an estimated source-grounded plan without filling unsupported days or crossing owners", async () => {
    const registry = createTools(
        undefined,
        new TravelIntelligence(config(), async () => response()),
      ),
      c = context();
    await registry.execute(
      call("research_destination", { destination: "Kyoto" }),
      c,
    );
    const ids = [...c.research.sources.keys()],
      args = {
        destination: "Kyoto",
        days: 3,
        sourceIds: ids,
        pace: "relaxed",
        interests: ["Culture"],
      };
    expect(
      await registry.execute(call("build_itinerary", args), c),
    ).toMatchObject({
      status: "ok",
      data: {
        label: "ESTIMATED_ITINERARY",
        unfilledDays: [2, 3],
        bookable: false,
      },
    });
    expect(
      (await registry.execute(call("build_itinerary", args), context())).code,
    ).toBe("SOURCE_NOT_IN_THIS_DESTINATION_RESEARCH");
    expect(
      (
        await registry.execute(
          call("build_itinerary", { ...args, destination: "Rome" }),
          c,
        )
      ).status,
    ).toBe("unavailable");
  });
  it("compares integer estimate budgets without FX, fabricated prices or reservations", async () => {
    const registry = createTools(
      undefined,
      new TravelIntelligence(config(), async () => response()),
    );
    const result = await registry.execute(
      call("compare_travel_options", {
        currency: "EGP",
        totalBudgetMinor: 250,
        travellers: 3,
        options: [
          {
            destination: "Kyoto",
            days: 2,
            items: [
              { label: "user estimate", unitAmountMinor: 100, quantity: 2 },
            ],
            assumptions: ["test estimate"],
          },
          {
            destination: "Tokyo",
            days: 2,
            items: [
              { label: "user estimate", unitAmountMinor: 300, quantity: 1 },
            ],
            assumptions: ["test estimate"],
          },
        ],
      }),
      context(),
    );
    expect(result).toMatchObject({
      status: "ok",
      data: {
        label: "ESTIMATED_COMPARISON",
        options: [
          {
            totalMinor: 200,
            withinBudget: true,
            perTravellerMinorRoundedUp: 67,
          },
          { totalMinor: 300, withinBudget: false, overBudgetMinor: 50 },
        ],
        bookable: false,
      },
    });
  });
});
