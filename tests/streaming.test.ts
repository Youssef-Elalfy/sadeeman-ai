import { describe, expect, it, vi } from "vitest";
import { SafeError } from "../apps/api/src/errors.js";
import { CompatibleAdapter } from "../apps/api/src/providers/compatible.js";
import { GeminiAdapter } from "../apps/api/src/providers/gemini.js";
import { ModelRouter } from "../apps/api/src/providers/router.js";
import type {
  ModelAdapter,
  ModelInput,
} from "../apps/api/src/providers/types.js";
import { answer, ScriptedAdapter, testConfig } from "./helpers.js";

const input: ModelInput = {
  system: "synthetic",
  messages: [{ role: "user", content: "Synthetic" }],
  tools: [],
  maxOutputTokens: 128,
};
type SdkResponse = Awaited<
  ReturnType<
    NonNullable<
      ConstructorParameters<typeof GeminiAdapter>[3]
    >["generateContent"]
  >
>;
function sse(frames: unknown[], end = true) {
  return new Response(
    frames.map((f) => `data: ${JSON.stringify(f)}\r\n\r\n`).join("") +
      (end ? "data: [DONE]\r\n\r\n" : ""),
    { headers: { "content-type": "text/event-stream" } },
  );
}
describe("actual provider stream protocol handling, mocked transport only in tests", () => {
  it.each(["groq", "openrouter"] as const)(
    "streams text chunks and assembles split %s tool arguments",
    async (id) => {
      const frames = [
        { choices: [{ index: 0, delta: { content: "Synthetic " } }] },
        {
          choices: [
            {
              index: 0,
              delta: {
                content: "answer",
                tool_calls: [
                  {
                    index: 0,
                    id: "a",
                    function: {
                      name: "search_company_packages",
                      arguments: '{"days":',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: "3}" } }],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 8 } },
      ];
      const fetcher = vi.fn<typeof fetch>(async () => sse(frames)),
        deltas: string[] = [];
      const result = await new CompatibleAdapter(
        id,
        "synthetic-key",
        "synthetic-model",
        fetcher,
      ).generate(input, new AbortController().signal, (text) =>
        deltas.push(text),
      );
      expect(deltas).toEqual(["Synthetic ", "answer"]);
      expect(result.text).toBe("Synthetic answer");
      expect(result.toolCalls[0]?.arguments).toEqual({ days: 3 });
      expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 8 });
      expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).stream).toBe(
        true,
      );
    },
  );
  it("rejects truncated streams rather than reporting a completed answer", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      sse([{ choices: [{ delta: { content: "Partial" } }] }], false),
    );
    await expect(
      new CompatibleAdapter("groq", "test", "test", fetcher).generate(
        input,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toMatchObject({ code: "INVALID_MODEL_RESPONSE" });
  });
  it("streams only visible Gemini text, preserves signatures and includes usage", async () => {
    const generateContent = vi.fn(),
      generateContentStream = vi.fn(async () =>
        (async function* () {
          yield {
            candidates: [
              {
                content: {
                  parts: [
                    { thought: true, text: "PRIVATE" },
                    { text: "Synthetic " },
                  ],
                },
              },
            ],
          } as SdkResponse;
          yield {
            candidates: [{ content: { parts: [{ text: "answer" }] } }],
            usageMetadata: { promptTokenCount: 10, totalTokenCount: 15 },
          } as SdkResponse;
        })(),
      );
    const deltas: string[] = [];
    const result = await new GeminiAdapter("test", "test", 1000, {
      generateContent,
      generateContentStream,
    }).generate(input, new AbortController().signal, (text) =>
      deltas.push(text),
    );
    expect(deltas).toEqual(["Synthetic ", "answer"]);
    expect(result.text).toBe("Synthetic answer");
    expect(result.usage.outputTokens).toBe(5);
    expect(generateContent).not.toHaveBeenCalled();
  });
  it("does not retry or invoke fallback after already emitting partial text", async () => {
    const generate = vi.fn<ModelAdapter["generate"]>(
      async (_input, _signal, onDelta) => {
        onDelta?.("Partial");
        throw new SafeError("PROVIDER_QUOTA");
      },
    );
    const primary: ModelAdapter = {
      id: "primary",
      capabilities: { tools: true, streaming: true, contextChars: 64000 },
      generate,
    };
    const fallback = new ScriptedAdapter([async () => answer()], "fallback");
    const router = new ModelRouter(
      [primary, fallback],
      testConfig({ PROVIDER_RETRIES: 2, ENABLE_PROVIDER_STREAMING: true }),
    );
    await expect(
      router.generate(input, new AbortController().signal, () => {}),
    ).rejects.toMatchObject({ code: "PROVIDER_QUOTA" });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(fallback.inputs).toHaveLength(0);
    expect(router.statuses()[0]).toMatchObject({
      status: "unavailable",
      lastError: "PROVIDER_QUOTA",
    });
  });
  it("reports not_verified until a response actually passes validation", async () => {
    const router = new ModelRouter(
      [new ScriptedAdapter([async () => answer()])],
      testConfig(),
    );
    expect(router.statuses()[0]?.status).toBe("not_verified");
    await router.generate(input, new AbortController().signal);
    expect(router.statuses()[0]).toMatchObject({
      status: "available",
      lastSuccessAt: expect.any(String),
    });
  });
});
