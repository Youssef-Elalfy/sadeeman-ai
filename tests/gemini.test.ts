import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelInput } from "../apps/api/src/providers/types.js";

const sdk = { generate: vi.fn() };

import { GeminiAdapter } from "../apps/api/src/providers/gemini.js";

const input: ModelInput = {
  system: "Synthetic system",
  messages: [{ role: "user", content: "Synthetic user" }],
  tools: [
    {
      name: "search_company_packages",
      description: "test",
      parameters: { type: "object" },
    },
  ],
  maxOutputTokens: 128,
};
beforeEach(() => {
  sdk.generate.mockReset();
});
describe("Gemini SDK wire contract — SDK mocked only inside this file", () => {
  it("disables SDK-owned loops, preserves function signatures and excludes private thought text", async () => {
    const parts = [
      { thought: true, text: "PRIVATE REASONING" },
      {
        functionCall: {
          id: "a",
          name: "search_company_packages",
          args: { days: 3 },
        },
        thoughtSignature: "opaque-signature",
      },
    ];
    sdk.generate.mockResolvedValueOnce({
      candidates: [{ content: { role: "model", parts } }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 4,
        totalTokenCount: 20,
      },
    });
    const adapter = new GeminiAdapter(
      "synthetic-test-key",
      "explicit-model",
      1000,
      { generateContent: sdk.generate },
    );
    const signal = new AbortController().signal;
    const first = await adapter.generate(input, signal);
    expect(first.text).toBe("");
    expect(first.toolCalls).toEqual([
      { id: "a", name: "search_company_packages", arguments: { days: 3 } },
    ]);
    expect(first.usage).toEqual({ inputTokens: 10, outputTokens: 10 });
    expect(sdk.generate.mock.calls[0]?.[0].config).toMatchObject({
      automaticFunctionCalling: { disable: true },
      automaticContinuation: false,
      abortSignal: signal,
      maxOutputTokens: 128,
    });
    sdk.generate.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ text: "Synthetic answer" }] } }],
    });
    await adapter.generate(
      {
        ...input,
        messages: [
          ...input.messages,
          {
            role: "assistant",
            content: first.text,
            toolCalls: first.toolCalls,
            ...(first.native ? { native: first.native } : {}),
          },
          {
            role: "tool",
            callId: "a",
            name: "search_company_packages",
            result: { status: "unavailable", evidence: "unavailable" },
          },
        ],
      },
      signal,
    );
    const next = sdk.generate.mock.calls[1]?.[0];
    expect(next.contents[1].parts).toEqual(parts);
    expect(next.contents[2].parts[0].functionResponse).toMatchObject({
      id: "a",
      name: "search_company_packages",
    });
  });
  it("rejects invalid function declarations returned by a model", async () => {
    sdk.generate.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: "INVALID NAME", args: {} } }],
          },
        },
      ],
    });
    await expect(
      new GeminiAdapter("test", "explicit-model", 1000, {
        generateContent: sdk.generate,
      }).generate(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_MODEL_RESPONSE" });
  });
  it("categorizes SDK quota errors without exposing raw contents", async () => {
    sdk.generate.mockRejectedValueOnce({
      status: 429,
      message: "secret request body",
    });
    const promise = new GeminiAdapter("test", "explicit-model", 1000, {
      generateContent: sdk.generate,
    }).generate(input, new AbortController().signal);
    await expect(promise).rejects.toMatchObject({ code: "PROVIDER_QUOTA" });
    await expect(promise).rejects.not.toThrow("secret");
  });
  it("falls through the model chain once on 503 and sticks to the working model", async () => {
    const ok = {
      candidates: [
        { content: { role: "model", parts: [{ text: "TEST ONLY" }] } },
      ],
    };
    sdk.generate
      .mockRejectedValueOnce({ status: 503, message: "overloaded" })
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(ok);
    const adapter = new GeminiAdapter("test", "model-a, model-b", 1000, {
      generateContent: sdk.generate,
    });
    const signal = new AbortController().signal;
    expect((await adapter.generate(input, signal)).text).toBe("TEST ONLY");
    await adapter.generate(input, signal);
    expect(sdk.generate.mock.calls.map((c) => c[0].model)).toEqual([
      "model-a",
      "model-b",
      "model-b",
    ]);
  });
  it("does not walk the chain on auth errors", async () => {
    sdk.generate.mockRejectedValueOnce({ status: 401, message: "denied" });
    await expect(
      new GeminiAdapter("test", "model-a,model-b", 1000, {
        generateContent: sdk.generate,
      }).generate(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
    expect(sdk.generate).toHaveBeenCalledTimes(1);
  });
});
