import { describe, expect, it, vi } from "vitest";
import { CompatibleAdapter } from "../apps/api/src/providers/compatible.js";
import { createRouter, ModelRouter } from "../apps/api/src/providers/router.js";
import type { ModelInput } from "../apps/api/src/providers/types.js";
import { answer, ScriptedAdapter, testConfig } from "./helpers.js";

const input: ModelInput = {
  system: "test",
  messages: [{ role: "user", content: "Synthetic request" }],
  tools: [
    {
      name: "search_company_packages",
      description: "Catalog",
      parameters: { type: "object" },
    },
  ],
  maxOutputTokens: 64,
};
const wire = {
  choices: [
    {
      message: {
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "search_company_packages",
              arguments: '{"days":3}',
            },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 12, completion_tokens: 8 },
};

describe("compatible REST adapters — fetch mocked only here", () => {
  it.each(["groq", "openrouter"] as const)(
    "serializes tool protocols and validates %s response",
    async (id) => {
      const fetcher = vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify(wire)),
      );
      const result = await new CompatibleAdapter(
        id,
        "test-key",
        "test-model",
        fetcher,
      ).generate(input, new AbortController().signal);
      expect(result).toMatchObject({
        toolCalls: [
          {
            id: "call-1",
            name: "search_company_packages",
            arguments: { days: 3 },
          },
        ],
        usage: { inputTokens: 12, outputTokens: 8 },
      });
      const [url, request] = fetcher.mock.calls[0] ?? [];
      expect(url).toBe(
        id === "groq"
          ? "https://api.groq.com/openai/v1/chat/completions"
          : "https://openrouter.ai/api/v1/chat/completions",
      );
      expect(request?.redirect).toBe("error");
      expect(JSON.parse(String(request?.body))).toMatchObject({
        stream: false,
        tool_choice: "auto",
        model: "test-model",
      });
    },
  );
  it("returns tool-call IDs with matching tool results", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "Done" } }] }),
        ),
    );
    await new CompatibleAdapter("groq", "test", "test", fetcher).generate(
      {
        ...input,
        messages: [
          ...input.messages,
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "a", name: "search_company_packages", arguments: {} },
            ],
          },
          {
            role: "tool",
            callId: "a",
            name: "search_company_packages",
            result: { status: "unavailable", evidence: "unavailable" },
          },
        ],
      },
      new AbortController().signal,
    );
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "a",
    });
    expect(body.messages.at(-2).tool_calls[0].id).toBe("a");
  });
  it.each([
    [401, "PROVIDER_AUTH"],
    [403, "PROVIDER_AUTH"],
    [429, "PROVIDER_QUOTA"],
    [500, "PROVIDER_UNAVAILABLE"],
    [400, "INVALID_MODEL_RESPONSE"],
  ] as const)(
    "categorizes HTTP %s without retaining response body",
    async (status, code) => {
      const fetcher = vi.fn<typeof fetch>(
        async () => new Response("SECRET PROVIDER BODY", { status }),
      );
      const promise = new CompatibleAdapter(
        "groq",
        "test",
        "test",
        fetcher,
      ).generate(input, new AbortController().signal);
      await expect(promise).rejects.toMatchObject({ code });
      await expect(promise).rejects.not.toThrow("SECRET");
    },
  );
  it("rejects malformed JSON tool arguments", async () => {
    const malformed = structuredClone(wire);
    const call = malformed.choices[0]?.message.tool_calls[0];
    if (call) call.function.arguments = "{bad-json";
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(malformed)),
    );
    await expect(
      new CompatibleAdapter("groq", "test", "test", fetcher).generate(
        input,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INVALID_MODEL_RESPONSE" });
  });
  it("rejects oversized decompressed provider response", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response("x".repeat(262145)),
    );
    await expect(
      new CompatibleAdapter("groq", "test", "test", fetcher).generate(
        input,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INVALID_MODEL_RESPONSE" });
  });
  it("rejects more than four calls per model output", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: Array.from(
                    { length: 5 },
                    () => wire.choices[0]?.message.tool_calls[0],
                  ),
                },
              },
            ],
          }),
        ),
    );
    await expect(
      new CompatibleAdapter("groq", "test", "test", fetcher).generate(
        input,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INVALID_MODEL_RESPONSE" });
  });
});
describe("configuration and provider output boundary", () => {
  it("allows genuine public-data development calls without enabling synthetic test input", () => {
    const router = createRouter(
      testConfig({
        NODE_ENV: "development",
        ENABLE_REAL_PROVIDER: true,
        ALLOW_SYNTHETIC_PROVIDER_DATA: false,
        GEMINI_API_KEY: "test-only-key",
        GEMINI_MODEL: "test-model",
      }),
    );
    expect(router.configured).toBe(true);
  });
  it("requires both real-provider and synthetic-data opt-ins", () => {
    expect(
      createRouter(
        testConfig({ GEMINI_API_KEY: "test", GEMINI_MODEL: "model" }),
      ).configured,
    ).toBe(false);
    expect(
      createRouter(
        testConfig({
          ENABLE_REAL_PROVIDER: true,
          GEMINI_API_KEY: "test",
          GEMINI_MODEL: "model",
        }),
      ).configured,
    ).toBe(false);
  });
  it("rejects placeholder model IDs", () => {
    expect(
      createRouter(
        testConfig({
          ENABLE_REAL_PROVIDER: true,
          ALLOW_SYNTHETIC_PROVIDER_DATA: true,
          GEMINI_API_KEY: "test",
          GEMINI_MODEL: "CHECK_SUPPORTED_MODEL_IN_CONSOLE",
        }),
      ).configured,
    ).toBe(false);
  });
  it("validates adapter output at the orchestration boundary too", async () => {
    const adapter = new ScriptedAdapter([
      async () => ({ ...answer(), text: "x".repeat(24001) }),
    ]);
    await expect(
      new ModelRouter([adapter], testConfig()).generate(
        input,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INVALID_MODEL_RESPONSE" });
  });
});
