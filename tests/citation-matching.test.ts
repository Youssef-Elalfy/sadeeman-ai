import { TravelSource } from "@sadeeman/contracts";
import { describe, expect, it } from "vitest";
import {
  citationKey,
  validateResearchCitations,
} from "../apps/api/src/research/grounding.js";
import { researchScope } from "../apps/api/src/research/scope.js";

const returned = "https://www.example-travel.com/guides/istanbul/";
function scope() {
  const value = researchScope("owner", "conversation", "run");
  value.searchCalls = 1;
  const source = TravelSource.parse({
    id: "src_0123456789abcdef",
    url: returned,
    title: "TEST ONLY Istanbul guide",
    excerpt: "TEST ONLY",
    score: null,
    retrievedAt: "2026-11-06T00:00:00.000Z",
    publicationEstimateAt: null,
    publicationDateBasis: "provider_estimate_or_unknown",
    authority: "publisher",
    urlBasis: "search_provider_url_not_publisher_canonical_verified",
  });
  value.sources.set(source.id, source);
  return value;
}

describe("citation matching (offline)", () => {
  it.each([
    "https://www.example-travel.com/guides/istanbul/",
    "https://example-travel.com/guides/istanbul",
    "http://www.example-travel.com/guides/istanbul/",
    "https://WWW.Example-Travel.com/guides/istanbul#top",
    "[الدليل](https://example-travel.com/guides/istanbul/).",
  ])("accepts a spelling variant of the returned page: %s", (link) => {
    expect(() =>
      validateResearchCitations(`اقتراح حسب ${link}`, scope()),
    ).not.toThrow();
  });
  it.each([
    "https://example-travel.com/guides/paris",
    "https://evil.example/guides/istanbul",
    "https://example-travel.com/guides/istanbul?ref=spam",
    "https://user:pw@example-travel.com/guides/istanbul",
    "https://127.0.0.1/guides/istanbul",
  ])("still rejects a page that was not returned: %s", (link) => {
    expect(() =>
      validateResearchCitations(`اقتراح حسب ${link}`, scope()),
    ).toThrow("UNGROUNDED_RESPONSE");
  });
  it.each([
    "شوف https://example-travel.com/guides/istanbul/وهو دليل كويس",
    "‏https://example-travel.com/guides/istanbul‏.",
    "(المصدر: https://example-travel.com/guides/istanbul)؟",
    "«https://example-travel.com/guides/istanbul»",
  ])("accepts RTL glue around a returned link: %s", (text) => {
    expect(() => validateResearchCitations(text, scope())).not.toThrow();
  });
  it("matches an Arabic-path link written decoded against a percent-encoded source", () => {
    const value = scope();
    const encoded = TravelSource.parse({
      ...[...value.sources.values()][0],
      id: "src_fedcba9876543210",
      url: "https://ar.wikipedia.org/wiki/%D8%AA%D8%B1%D9%83%D9%8A%D8%A7",
    });
    value.sources.set(encoded.id, encoded);
    expect(() =>
      validateResearchCitations(
        "اقرأ https://ar.wikipedia.org/wiki/تركيا للمعلومات",
        value,
      ),
    ).not.toThrow();
  });
  it("still requires at least one citation when sources were returned", () => {
    expect(() => validateResearchCitations("بدون مصدر", scope())).toThrow(
      "UNGROUNDED_RESPONSE",
    );
  });
  it("keeps path and query significant in the identity key", () => {
    expect(citationKey("https://a.com/x?y=1")).not.toBe(
      citationKey("https://a.com/x"),
    );
    expect(citationKey("https://www.A.com/x/")).toBe(
      citationKey("http://a.com/x"),
    );
  });
});
