import { describe, expect, it } from "vitest";
import { SafeError } from "../apps/api/src/errors.js";
import { createRouter, ModelRouter } from "../apps/api/src/providers/router.js";
import { answer, ScriptedAdapter, testConfig } from "./helpers.js";

const input = {
  system: "Test",
  messages: [{ role: "user" as const, content: "Public test" }],
  tools: [],
  maxOutputTokens: 64,
};
describe("verified runtime provider policy", () => {
  it("keeps configured OpenRouter out of active routing by default", () => {
    const router = createRouter(
      testConfig({
        ENABLE_REAL_PROVIDER: true,
        ALLOW_SYNTHETIC_PROVIDER_DATA: true,
        MODEL_PROVIDER: "gemini",
        GEMINI_API_KEY: "fixture-only",
        GEMINI_MODEL: "test-model",
        GROQ_API_KEY: "fixture-only",
        GROQ_MODEL: "test-model",
        OPENROUTER_API_KEY: "fixture-only",
        OPENROUTER_MODEL: "example/test:free",
        FALLBACK_PROVIDERS: "groq,openrouter",
      }),
    );
    expect(router.adapters.map((a) => a.id)).toEqual(["gemini", "groq"]);
  });
  it("uses a verified fallback once after quota, then observes cooldown on the next turn", async () => {
    const primary = new ScriptedAdapter(
      [
        async () => {
          throw new SafeError("PROVIDER_QUOTA");
        },
      ],
      "gemini",
    );
    const fallback = new ScriptedAdapter(
      [async () => answer(), async () => answer()],
      "groq",
    );
    const router = new ModelRouter(
      [primary, fallback],
      testConfig({ PROVIDER_RETRIES: 0 }),
    );
    expect(
      (await router.generate(input, new AbortController().signal)).providerId,
    ).toBe("groq");
    expect(
      (await router.generate(input, new AbortController().signal)).providerId,
    ).toBe("groq");
    expect(primary.inputs).toHaveLength(1);
    expect(fallback.inputs).toHaveLength(2);
  });
  it("returns a genuine failure when both providers are unavailable", async () => {
    const fail = async () => {
      throw new SafeError("PROVIDER_QUOTA");
    };
    const router = new ModelRouter(
      [
        new ScriptedAdapter([fail], "gemini"),
        new ScriptedAdapter([fail], "groq"),
      ],
      testConfig(),
    );
    await expect(
      router.generate(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "PROVIDER_QUOTA" });
  });
});
