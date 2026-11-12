import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../apps/api/src/agent/runtime.js";
import {
  cooldownMs,
  providerError,
  rateHintFromText,
  SafeError,
} from "../apps/api/src/errors.js";
import { CompatibleAdapter } from "../apps/api/src/providers/compatible.js";
import { GeminiAdapter } from "../apps/api/src/providers/gemini.js";
import { ModelRouter } from "../apps/api/src/providers/router.js";
import type { ModelInput } from "../apps/api/src/providers/types.js";
import { createTools } from "../apps/api/src/tools/registry.js";
import { answer, ScriptedAdapter, setup, testConfig } from "./helpers.js";

// Offline only: SDK/fetch are mocked; no provider, network or quota is used.
const ok = (text = "TEST ONLY") => ({
  candidates: [
    {
      finishReason: "STOP",
      content: { role: "model", parts: [{ text }] },
    },
  ],
});
const quotaText = (window: "PerDay" | "PerMinute") =>
  `{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"violations":[{"quotaId":"GenerateRequests${window}PerProjectPerModel-FreeTier"}]},{"retryDelay":"17s"}]}}`;
const toolHistory: ModelInput = {
  system: "TEST ONLY",
  maxOutputTokens: 256,
  tools: [],
  messages: [
    { role: "user", content: "TEST ONLY Maldives" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "c1", name: "research_destination", arguments: { q: "x" } },
      ],
      native: {
        provider: "gemini",
        model: "gemini-3.8-flash",
        parts: [
          {
            functionCall: { id: "c1", name: "research_destination" },
            thoughtSignature: "REAL",
          },
        ],
      },
    },
    {
      role: "tool",
      callId: "c1",
      name: "research_destination",
      result: { status: "ok", evidence: "general_information" },
    },
  ],
};
type Params = {
  model: string;
  contents: { role: string; parts: Record<string, unknown>[] }[];
};
const params = (fn: ReturnType<typeof vi.fn>, call: number) =>
  fn.mock.calls[call]?.[0] as Params;

describe("Gemini tool history across models (MASAR signature rule)", () => {
  it("replays raw signed parts only to the model that produced them", async () => {
    const generate = vi.fn().mockResolvedValueOnce(ok());
    await new GeminiAdapter("k", "gemini-3.8-flash", 1000, {
      generateContent: generate,
    }).generate(toolHistory, new AbortController().signal);
    expect(params(generate, 0).contents[1]?.parts[0]?.thoughtSignature).toBe(
      "REAL",
    );
  });
  it("sends portable parts with the documented skip signature to another Gemini 3 model", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, message: "overloaded" })
      .mockResolvedValueOnce(ok());
    await new GeminiAdapter(
      "k",
      "gemini-3.8-flash,gemini-3.5-flash-lite",
      1000,
      {
        generateContent: generate,
      },
    ).generate(toolHistory, new AbortController().signal);
    const lite = params(generate, 1);
    expect(lite.model).toBe("gemini-3.5-flash-lite");
    expect(lite.contents[1]?.parts[0]?.thoughtSignature).toBe(
      "skip_thought_signature_validator",
    );
  });
});

describe("rate-limit classification and resting — no wasted calls", () => {
  it("reads the quota window and retry delay without keeping the text", () => {
    expect(rateHintFromText(quotaText("PerDay"))).toEqual({
      quotaScope: "daily",
      retryAfterMs: 17000,
    });
    expect(rateHintFromText(quotaText("PerMinute")).quotaScope).toBe(
      "per_minute",
    );
  });
  it("cooldowns: per-minute ≥ 30 s, daily until reset, overload 60 s", () => {
    const fail = (scope: "daily" | "per_minute", retry?: number) =>
      providerError(
        { status: 429 },
        new AbortController().signal,
        { provider: "groq", model: "m", operation: "generate" },
        { quotaScope: scope, ...(retry ? { retryAfterMs: retry } : {}) },
      );
    expect(cooldownMs(fail("per_minute", 5000))).toBe(30000);
    expect(cooldownMs(fail("per_minute", 45000))).toBe(45000);
    expect(cooldownMs(fail("daily"))).toBe(3600000);
    expect(cooldownMs(new SafeError("PROVIDER_UNAVAILABLE"))).toBe(60000);
    expect(cooldownMs(new SafeError("INVALID_MODEL_RESPONSE"))).toBe(0);
  });
  it("a model with a spent daily quota is skipped on later turns", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, message: quotaText("PerDay") })
      .mockResolvedValue(ok());
    const adapter = new GeminiAdapter(
      "k",
      "gemini-3.8-flash,gemini-3.5-flash-lite",
      1000,
      { generateContent: generate },
    );
    for (let i = 0; i < 3; i++)
      await adapter.generate(toolHistory, new AbortController().signal);
    expect(generate.mock.calls.map((c) => (c[0] as Params).model)).toEqual([
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash-lite",
    ]);
  });
  it("classifies Groq 429 from headers only (per-minute vs daily)", async () => {
    const reply = (headers: Record<string, string>) =>
      vi.fn<typeof fetch>(
        async () => new Response("{}", { status: 429, headers }),
      );
    const run = (fetcher: typeof fetch) =>
      new CompatibleAdapter("groq", "k", "openai/gpt-oss-120b", fetcher)
        .generate(toolHistory, new AbortController().signal)
        .then(
          () => {
            throw new Error("expected a provider failure");
          },
          (e: unknown) => e as SafeError,
        );
    const minute = await run(reply({ "retry-after": "15" }));
    expect(minute.providerFailure).toMatchObject({ quotaScope: "per_minute" });
    expect(minute.retryAfterMs).toBe(15000);
    const daily = await run(reply({ "x-ratelimit-remaining-requests": "0" }));
    expect(daily.providerFailure).toMatchObject({ quotaScope: "daily" });
  });
});

describe("bounded waits only when the provider asks for a short one", () => {
  const groq = (fetcher: typeof fetch) =>
    new CompatibleAdapter("groq", "k", "openai/gpt-oss-120b", fetcher);
  const okBody = () =>
    Response.json({
      choices: [{ message: { content: "TEST ONLY" }, finish_reason: "stop" }],
    });
  it("Groq: honors a ≤10 s Retry-After once, then answers", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("{}", { status: 429, headers: { "retry-after": "1" } }),
      )
      .mockResolvedValueOnce(okBody());
    const out = await groq(fetcher).generate(
      toolHistory,
      new AbortController().signal,
    );
    expect(out.text).toBe("TEST ONLY");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("Groq: never waits on long or daily limits", async () => {
    for (const headers of [
      { "retry-after": "30" },
      { "x-ratelimit-remaining-requests": "0", "retry-after": "1" },
    ]) {
      const fetcher = vi.fn<typeof fetch>(
        async () => new Response("{}", { status: 429, headers }),
      );
      await expect(
        groq(fetcher).generate(toolHistory, new AbortController().signal),
      ).rejects.toMatchObject({ code: "PROVIDER_QUOTA" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("Gemini: one short pause after the whole chain is overloaded, never on quota", async () => {
    const overloaded = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, message: "high demand" })
      .mockRejectedValueOnce({ status: 503, message: "high demand" })
      .mockResolvedValueOnce(ok("after pause"));
    const a = new GeminiAdapter(
      "k",
      "gemini-3.8-flash,gemini-3.5-flash-lite",
      1000,
      {
        generateContent: overloaded,
      },
    );
    expect(
      (await a.generate(toolHistory, new AbortController().signal)).text,
    ).toBe("after pause");
    expect(overloaded).toHaveBeenCalledTimes(3);
    const quota = vi
      .fn()
      .mockRejectedValue({ status: 429, message: quotaText("PerMinute") });
    await expect(
      new GeminiAdapter("k", "gemini-3.8-flash,gemini-3.5-flash-lite", 1000, {
        generateContent: quota,
      }).generate(toolHistory, new AbortController().signal),
    ).rejects.toMatchObject({ code: "PROVIDER_QUOTA" });
    expect(quota).toHaveBeenCalledTimes(2);
  });
});

describe("consecutive turns with provider failures — mocked providers", () => {
  const quota =
    (provider: "gemini" | "groq", scope: "daily" | "per_minute") =>
    async (_input: ModelInput, signal: AbortSignal) => {
      throw providerError(
        { status: 429 },
        signal,
        { provider, model: "TEST ONLY", operation: "generate" },
        { quotaScope: scope },
      );
    };
  async function turn(router: ModelRouter, question: string) {
    const c = setup(new ScriptedAdapter([]), testConfig());
    const run = c.state.createRun(c.conversation);
    const events: string[] = [];
    run.listeners.add((e) => {
      if (e.textDelta) events.push(e.textDelta);
    });
    await new AgentRuntime(router, createTools(), c.config).execute(
      run,
      c.conversation,
      question,
      "ar-EG",
    );
    return { run, text: events.at(-1) ?? "", conversation: c.conversation };
  }
  it("Groq answers when Gemini is rate-limited; the next turns skip resting Gemini", async () => {
    const gemini = new ScriptedAdapter(
      [quota("gemini", "per_minute")],
      "gemini",
    );
    const groq = new ScriptedAdapter(
      [
        async () => answer("رحلة المالديف التقديرية: ٥ أيام."),
        async () => answer("ده كود بايثون بسيط."),
        async () => answer("برامج الشركة: الغردقة ٦٬٥٠٠ جنيه للفرد."),
      ],
      "groq",
    );
    const router = new ModelRouter([gemini, groq], testConfig());
    for (const q of [
      "عايز خطة للمالديف",
      "اكتبلي كود بايثون",
      "إيه برامج الشركة؟",
    ])
      expect((await turn(router, q)).run.status).toBe("completed");
    expect(gemini.inputs).toHaveLength(1);
    expect(groq.inputs).toHaveLength(3);
  });
  it("per-minute limits on both providers → busy message, conversation unchanged", async () => {
    const router = new ModelRouter(
      [
        new ScriptedAdapter([quota("gemini", "per_minute")], "gemini"),
        new ScriptedAdapter([quota("groq", "per_minute")], "groq"),
      ],
      testConfig(),
    );
    const { run, text, conversation } = await turn(router, "عايز خطة للمالديف");
    expect(run.status).toBe("failed");
    expect(text).toContain("حد الطلبات في الدقيقة");
    expect(text).toContain("رسالتك لسه في الخانة");
    expect(conversation.messages).toEqual([]);
  });
  it("daily quotas on both providers → daily message", async () => {
    const router = new ModelRouter(
      [
        new ScriptedAdapter([quota("gemini", "daily")], "gemini"),
        new ScriptedAdapter([quota("groq", "daily")], "groq"),
      ],
      testConfig(),
    );
    expect((await turn(router, "عايز خطة للمالديف")).text).toContain(
      "الحد اليومي",
    );
  });
});
