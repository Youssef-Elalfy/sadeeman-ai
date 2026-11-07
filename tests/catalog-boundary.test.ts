import { describe, expect, it } from "vitest";
import {
  freeToolModels,
  OpenRouterCatalog,
} from "../apps/api/src/providers/catalog.js";

const model = (id = "example/test:free") => ({
  id,
  pricing: { prompt: "0", completion: "0", request: "0" },
  supported_parameters: ["tools", "tool_choice"],
});
describe("OpenRouter catalog boundary regression and safe free-model selection", () => {
  it("accepts the actual public tilde-prefixed alias shape alongside ordinary model IDs", () => {
    const catalog = OpenRouterCatalog.parse({
      data: [model("~unbiased/pareto-latest"), model()],
    });
    expect(catalog.data).toHaveLength(2);
    expect(freeToolModels(catalog)).toEqual(["example/test:free"]);
  });
  it("does not turn arbitrary tilde placement, whitespace or oversized IDs into valid aliases", () => {
    for (const id of [
      "~~example/test",
      "example/~test",
      "~",
      "example/test\n",
      "example/test space",
      `example/${"x".repeat(160)}`,
    ]) {
      expect(OpenRouterCatalog.safeParse({ data: [model(id)] }).success).toBe(
        false,
      );
    }
  });
  it("rejects malformed or non-finite prices instead of coercing them to free", () => {
    for (const prompt of ["", "free", "NaN", "1e999", null, 0]) {
      expect(
        OpenRouterCatalog.safeParse({
          data: [{ ...model(), pricing: { prompt, completion: "0" } }],
        }).success,
      ).toBe(false);
    }
  });
  it("excludes paid, unknown-price and missing-tool-choice models from probe selection", () => {
    const catalog = OpenRouterCatalog.parse({
      data: [
        model(),
        model("example/paid"),
        {
          ...model("example/charged:free"),
          pricing: { prompt: "0.01", completion: "0" },
        },
        {
          ...model("example/unknown:free"),
          pricing: { prompt: "-1", completion: "0" },
        },
        { ...model("example/no-choice:free"), supported_parameters: ["tools"] },
      ],
    });
    expect(freeToolModels(catalog)).toEqual(["example/test:free"]);
  });
  it("rejects malformed catalog envelopes and parameter lists", () => {
    for (const body of [
      {},
      { data: {} },
      { data: [null] },
      { data: [{ ...model(), supported_parameters: "tools" }] },
    ]) {
      expect(OpenRouterCatalog.safeParse(body).success).toBe(false);
    }
  });
  it("keeps the catalog count bounded", () => {
    expect(
      OpenRouterCatalog.safeParse({
        data: Array.from({ length: 5001 }, () => model()),
      }).success,
    ).toBe(false);
  });
});
