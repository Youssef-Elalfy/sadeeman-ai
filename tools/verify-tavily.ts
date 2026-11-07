import { SearchError, TavilySearch } from "../apps/api/dist/research/tavily.js";

if (
  !process.argv.includes("--live") ||
  !process.argv.includes("--authorized-key-use")
) {
  process.stderr.write(
    "Use --live --authorized-key-use only with permission to use the current local key. One basic travel search; no retries.\n",
  );
  process.exitCode = 2;
} else {
  try {
    const result = await new TavilySearch(
      process.env.TAVILY_API_KEY ?? "",
    ).search(
      {
        query: "Kyoto Japan official tourism travel guide attractions",
        maxResults: 2,
        domains: ["japan.travel"],
      },
      new AbortController().signal,
    );
    if (!result.sources.length)
      throw new SearchError("SEARCH_INVALID_RESPONSE");
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "REAL_TAVILY_TRAVEL_SEARCH_PASSED",
          authentication: "accepted",
          searchRequests: 1,
          searchDepth: "basic",
          retrievedAt: result.retrievedAt,
          sources: result.sources.map((s) => ({
            id: s.id,
            title: s.title,
            sourceUrl: s.url,
            publicationEstimateAt: s.publicationEstimateAt,
            publicationDateBasis: s.publicationDateBasis,
          })),
          unknownPublicationDates: result.sources.filter(
            (s) => !s.publicationEstimateAt,
          ).length,
          credentialsDisplayed: false,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ status: "FAILED", code: error instanceof SearchError ? error.code : "SEARCH_INVALID_RESPONSE", retries: 0, credentialsDisplayed: false })}\n`,
    );
    process.exitCode = 1;
  }
}
