import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

export const SearchSource = z.strictObject({
  id: z.string().regex(/^src_[a-f0-9]{16}$/),
  url: z.url().max(2048),
  title: z.string().max(180),
  excerpt: z.string().max(1200),
  score: z.number().min(0).max(1).nullable(),
  retrievedAt: z.iso.datetime(),
  publicationEstimateAt: z.iso.datetime().nullable(),
  publicationDateBasis: z.literal("provider_estimate_or_unknown"),
});
export type SearchSource = z.infer<typeof SearchSource>;
const Wire = z.object({
  results: z
    .array(
      z.object({
        url: z.string().max(4096),
        title: z.string().max(10000),
        content: z.string().max(200000),
        score: z.number().min(0).max(1).optional(),
        published_date: z.string().max(120).nullish(),
      }),
    )
    .max(20),
});
export type SearchErrorCode =
  | "SEARCH_AUTH"
  | "SEARCH_QUOTA"
  | "SEARCH_TIMEOUT"
  | "SEARCH_UNAVAILABLE"
  | "SEARCH_INVALID_RESPONSE";
export class SearchError extends Error {
  constructor(readonly code: SearchErrorCode) {
    super(code);
  }
}
export function safeSourceUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw),
      host = u.hostname.replace(/^\[|\]$/g, "");
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      (u.port && u.port !== "443") ||
      isIP(host) ||
      !host.includes(".") ||
      /(^|\.)(localhost|local|internal|invalid|test|onion)$/.test(host)
    )
      return undefined;
    u.hash = "";
    return u.toString();
  } catch {
    return undefined;
  }
}
export interface SearchRequest {
  query: string;
  maxResults: number;
  domains?: string[];
}
export interface SearchResponse {
  retrievedAt: string;
  sources: SearchSource[];
  discardedSources: number;
}
export class TavilySearch {
  constructor(
    private readonly key: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async search(
    input: SearchRequest,
    parent: AbortSignal,
  ): Promise<SearchResponse> {
    if (!this.key) throw new SearchError("SEARCH_AUTH");
    const signal = AbortSignal.any([parent, AbortSignal.timeout(12000)]);
    try {
      const response = await this.fetcher("https://api.tavily.com/search", {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: input.query,
          search_depth: "basic",
          max_results: input.maxResults,
          topic: "general",
          include_published_date: true,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          auto_parameters: false,
          ...(input.domains
            ? {
                include_domains: input.domains,
                include_domains_mode: "restrict",
              }
            : {
                // Video/social pages are not citable travel sources (live
                // finding: 2 of 3 Lisbon sources were YouTube videos).
                exclude_domains: [
                  "youtube.com",
                  "tiktok.com",
                  "instagram.com",
                  "facebook.com",
                  "pinterest.com",
                  "x.com",
                  "twitter.com",
                ],
              }),
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new SearchError(
          [401, 403].includes(response.status)
            ? "SEARCH_AUTH"
            : [402, 429, 432, 433].includes(response.status)
              ? "SEARCH_QUOTA"
              : "SEARCH_UNAVAILABLE",
        );
      }
      if (!response.body) throw new SearchError("SEARCH_INVALID_RESPONSE");
      let size = 0;
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 1048576) throw new SearchError("SEARCH_INVALID_RESPONSE");
        chunks.push(chunk);
      }
      let wire: z.infer<typeof Wire>;
      try {
        wire = Wire.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        throw new SearchError("SEARCH_INVALID_RESPONSE");
      }
      const retrievedAt = new Date().toISOString(),
        sources: SearchSource[] = [],
        seen = new Set<string>();
      let discardedSources = 0;
      for (const result of wire.results) {
        const url = safeSourceUrl(result.url);
        if (
          !url ||
          seen.has(url) ||
          sources.length >= input.maxResults ||
          (input.domains &&
            !input.domains.some(
              (d) =>
                new URL(url).hostname === d ||
                new URL(url).hostname.endsWith(`.${d}`),
            ))
        ) {
          discardedSources++;
          continue;
        }
        seen.add(url);
        const date = result.published_date
          ? Date.parse(result.published_date)
          : NaN;
        sources.push(
          SearchSource.parse({
            id: `src_${createHash("sha256").update(url).digest("hex").slice(0, 16)}`,
            url,
            title: result.title.replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, 180),
            excerpt: result.content
              .replace(/[\p{Cc}\p{Cf}]/gu, " ")
              .slice(0, 800),
            score: result.score ?? null,
            retrievedAt,
            publicationEstimateAt:
              Number.isFinite(date) && date <= Date.now() + 86400000
                ? new Date(date).toISOString()
                : null,
            publicationDateBasis: "provider_estimate_or_unknown",
          }),
        );
      }
      return { retrievedAt, sources, discardedSources };
    } catch (error) {
      if (error instanceof SearchError) throw error;
      throw new SearchError(
        signal.aborted ? "SEARCH_TIMEOUT" : "SEARCH_UNAVAILABLE",
      );
    }
  }
}
