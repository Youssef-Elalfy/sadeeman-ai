import { randomUUID } from "node:crypto";
import { ToolResult } from "@sadeeman/contracts";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fitModelInput, inputChars } from "../apps/api/src/agent/context.js";
import { AgentRuntime } from "../apps/api/src/agent/runtime.js";
import { providerError, SafeError } from "../apps/api/src/errors.js";
import { GeminiAdapter } from "../apps/api/src/providers/gemini.js";
import { ModelRouter } from "../apps/api/src/providers/router.js";
import type {
  ModelAdapter,
  ModelInput,
} from "../apps/api/src/providers/types.js";
import { researchScope } from "../apps/api/src/research/scope.js";
import { TravelIntelligence } from "../apps/api/src/research/travel.js";
import { createTools, ToolRegistry } from "../apps/api/src/tools/registry.js";
import { answer, ScriptedAdapter, setup, testConfig, tool } from "./helpers.js";

// All content, providers and transport here are TEST ONLY. No live calls.
const sourceUrl = "https://visitmaldives.com/en/";
const config = () =>
  testConfig({
    ENABLE_TRAVEL_RESEARCH: true,
    TAVILY_API_KEY: "TEST ONLY",
    ENABLE_TRAVEL_CONTEXT: true,
  });
const searcher = () =>
  vi.fn<typeof fetch>(async () =>
    Response.json({
      results: [
        {
          url: sourceUrl,
          title: "TEST ONLY Maldives source",
          content: "TEST ONLY public island travel guidance.",
          score: 0.9,
        },
      ],
    }),
  );
const research = () =>
  tool("research_destination", { destination: "Maldives" });
const grounded = () =>
  answer(`TEST ONLY estimate; availability unverified. [Source](${sourceUrl})`);
const upstream503 = (signal: AbortSignal) =>
  providerError({ status: 503, message: "PRIVATE TEST PAYLOAD" }, signal, {
    provider: "gemini",
    model: "TEST ONLY",
    operation: "generate",
  });
const simpleInput: ModelInput = {
  system: "TEST ONLY",
  messages: [{ role: "user", content: "TEST ONLY" }],
  tools: [],
  maxOutputTokens: 128,
};

describe("agent reliability — real orchestration with mocked providers", () => {
  it("completes fifteen turns, preserves confirmed facts, handles hotels/general follow-ups and keeps full stored history", async () => {
    const cfg = config(),
      fetcher = searcher();
    const adapter = new ScriptedAdapter([
      async () => research(),
      async () => grounded(),
      ...Array.from({ length: 14 }, (_, i) => async (input: ModelInput) => {
        expect(input.system).toContain('"destination":"Maldives"');
        expect(input.system).toContain('"budgetMinor":3000000');
        expect(input.system).toContain('"travellers":2');
        expect(
          input.messages.some(
            (m) =>
              m.role === "user" &&
              m.content.includes("TEST ONLY first request"),
          ),
        ).toBe(true);
        expect(inputChars(input)).toBeLessThanOrEqual(cfg.MAX_CONTEXT_CHARS);
        return answer(
          i === 7
            ? "TEST ONLY general answer about React."
            : "TEST ONLY follow-up explanation. " +
                "Useful prior planning detail. ".repeat(180),
        );
      }),
    ]);
    const c = setup(adapter, cfg);
    c.conversation.travelState = {
      version: 1,
      constraints: {
        destination: "Maldives",
        days: 5,
        travellers: 2,
        budgetMinor: 3000000,
        currency: "EGP",
        budgetBasis: "party_total",
      },
      budgetBasisConfidence: "confirmed",
      options: [],
    };
    const runtime = new AgentRuntime(
      c.router,
      createTools(undefined, new TravelIntelligence(cfg, fetcher), true),
      cfg,
    );
    for (let turn = 0; turn < 15; turn++) {
      const run = c.state.createRun(c.conversation);
      await runtime.execute(
        run,
        c.conversation,
        turn === 0
          ? "TEST ONLY first request: research Maldives"
          : turn === 8
            ? "TEST ONLY explain React"
            : `TEST ONLY continue with hotels and the same trip ${turn}`,
        "en",
      );
      expect(run.status, `turn ${turn}`).toBe("completed");
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(c.conversation.messages).toHaveLength(30);
    expect(c.conversation.travelState?.constraints).toMatchObject({
      days: 5,
      travellers: 2,
      budgetMinor: 3000000,
      currency: "EGP",
    });
    expect(c.conversation.travelState?.constraints.adults).toBeUndefined();
  });

  it("preserves a validated final answer that consumes the remaining reported token budget", async () => {
    const adapter = new ScriptedAdapter([
      async () => ({
        ...answer("TEST ONLY complete final answer"),
        usage: { inputTokens: 15000, outputTokens: 1000 },
      }),
    ]);
    const c = setup(adapter),
      run = c.state.createRun(c.conversation);
    const commit = vi.fn(async () => {});
    await new AgentRuntime(c.router, createTools(), c.config).execute(
      run,
      c.conversation,
      "TEST ONLY question",
      "en",
      { beforeComplete: commit },
    );
    expect(run.status).toBe("completed");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(run.usage.inputTokens + run.usage.outputTokens).toBe(16000);
    expect(c.conversation.messages.at(-1)).toMatchObject({
      content: "TEST ONLY complete final answer",
    });
  });

  it("reserves a tools-off final generation after a costly successful tool step", async () => {
    const adapter = new ScriptedAdapter([
      async () => ({
        ...tool("estimate_trip_budget", {
          currency: "EGP",
          items: [{ label: "TEST ONLY", unitAmountMinor: 3000, quantity: 2 }],
          assumptions: ["TEST ONLY user estimate"],
        }),
        usage: { inputTokens: 11000, outputTokens: 1000 },
      }),
      async (input) => {
        expect(input.tools).toEqual([]);
        expect(input.maxOutputTokens).toBeGreaterThanOrEqual(64);
        return {
          ...answer("TEST ONLY estimate total 6000 minor units."),
          usage: { inputTokens: 3000, outputTokens: 1000 },
        };
      },
    ]);
    const c = setup(adapter),
      run = c.state.createRun(c.conversation);
    await new AgentRuntime(c.router, createTools(), c.config).execute(
      run,
      c.conversation,
      "TEST ONLY estimate",
      "en",
    );
    expect(run.status).toBe("completed");
    expect(run.toolExecutions).toHaveLength(1);
  });

  it("keeps successful research when the next Gemini generation returns 503 and Groq answers", async () => {
    const cfg = config(),
      fetcher = searcher();
    const primary = new ScriptedAdapter(
      [
        async () => research(),
        async (_input, signal) => {
          throw upstream503(signal);
        },
      ],
      "gemini",
    );
    const fallback = new ScriptedAdapter(
      [
        async (input) => {
          expect(JSON.stringify(input.messages)).toContain(sourceUrl);
          return grounded();
        },
      ],
      "groq",
    );
    const c = setup(primary, cfg),
      run = c.state.createRun(c.conversation);
    const router = new ModelRouter([primary, fallback], cfg);
    await new AgentRuntime(
      router,
      createTools(undefined, new TravelIntelligence(cfg, fetcher), true),
      cfg,
    ).execute(run, c.conversation, "TEST ONLY Maldives", "en");
    expect(run.status).toBe("completed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fallback.inputs).toHaveLength(1);
    expect(run.providerFailures?.[0]).toMatchObject({
      category: "PROVIDER_UNAVAILABLE",
      upstreamStatus: 503,
    });
  });
  it("does not let opaque native metadata block runtime admission before a compatible fallback is considered", async () => {
    const cfg = config(),
      fetcher = searcher();
    const primary = new ScriptedAdapter(
      [
        async () => ({
          ...research(),
          native: {
            provider: "gemini",
            parts: [{ thoughtSignature: "TEST-ONLY-OPAQUE".repeat(4500) }],
          },
        }),
      ],
      "gemini",
    );
    const fallback = new ScriptedAdapter(
      [
        async (input) => {
          expect(JSON.stringify(input)).not.toContain("TEST-ONLY-OPAQUE");
          return grounded();
        },
      ],
      "groq",
    );
    const c = setup(primary, cfg),
      run = c.state.createRun(c.conversation),
      router = new ModelRouter([primary, fallback], cfg);
    await new AgentRuntime(
      router,
      createTools(undefined, new TravelIntelligence(cfg, fetcher), true),
      cfg,
    ).execute(run, c.conversation, "TEST ONLY Maldives", "en");
    expect(run.status).toBe("completed");
    expect(primary.inputs).toHaveLength(1);
    expect(fallback.inputs).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(router.statuses()[0]).toMatchObject({
      skipReason: "context_capacity",
    });
  });

  it("uses an unattempted context-limited fallback for a tools-off final answer without retrying the failed provider", async () => {
    const cfg = testConfig({
        ...config(),
        MAX_CONTEXT_CHARS: 64000,
        MAX_TURN_TOKENS: 32000,
      }),
      fetcher = searcher();
    const primary = new ScriptedAdapter(
      [
        async () => research(),
        async (_input, signal) => {
          throw upstream503(signal);
        },
      ],
      "gemini",
    );
    const fallback = new ScriptedAdapter(
      [
        async (input) => {
          expect(input.tools).toEqual([]);
          expect(JSON.stringify(input.messages)).toContain(sourceUrl);
          return grounded();
        },
      ],
      "groq",
    );
    const registry = createTools(
      undefined,
      new TravelIntelligence(cfg, fetcher),
      true,
    );
    registry.register({
      name: "test_large_contract",
      description: "TEST ONLY schema overhead",
      input: z.strictObject({
        detail: z.string().describe("TEST ONLY documentation ".repeat(1100)),
      }),
      output: ToolResult,
      timeoutMs: 100,
      sideEffect: false,
      execute: async () => ({ status: "ok", evidence: "general_information" }),
    });
    const c = setup(primary, cfg),
      run = c.state.createRun(c.conversation);
    const router = new ModelRouter(
      [
        primary,
        {
          id: "groq",
          capabilities: { ...fallback.capabilities, contextChars: 10000 },
          generate: fallback.generate.bind(fallback),
        },
      ],
      cfg,
    );
    await new AgentRuntime(router, registry, cfg).execute(
      run,
      c.conversation,
      "TEST ONLY Maldives",
      "en",
    );
    expect(run.status).toBe("completed");
    expect(primary.inputs).toHaveLength(2);
    expect(fallback.inputs).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retains failed-turn research and reuses it on retry without another search or false travel commit", async () => {
    const cfg = config(),
      fetcher = searcher();
    const adapter = new ScriptedAdapter(
      [
        async () => research(),
        async (_input, signal) => {
          throw upstream503(signal);
        },
        async () => research(),
        async () => grounded(),
      ],
      "gemini",
    );
    const c = setup(adapter, cfg),
      runtime = new AgentRuntime(
        c.router,
        createTools(undefined, new TravelIntelligence(cfg, fetcher), true),
        cfg,
      );
    const failed = c.state.createRun(c.conversation);
    await runtime.execute(failed, c.conversation, "TEST ONLY Maldives", "en");
    expect(failed.status).toBe("failed");
    expect(c.conversation.messages).toEqual([]);
    expect(failed.events.at(-1)?.textDelta).toContain(
      "sources remain available",
    );
    const retried = c.state.createRun(c.conversation);
    await runtime.execute(retried, c.conversation, "TEST ONLY Maldives", "en");
    expect(retried.status).toBe("completed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(retried.research?.searchCalls).toBe(0);
    expect(retried.research?.usedEvidence).toBe(true);
  });

  it("reuses identical completed calls with new IDs and directs the model to finish", async () => {
    const cfg = config(),
      fetcher = searcher();
    const adapter = new ScriptedAdapter([
      async () => research(),
      async () => research(),
      async (input) => {
        expect(input.tools).toEqual([]);
        return grounded();
      },
    ]);
    const c = setup(adapter, cfg),
      run = c.state.createRun(c.conversation);
    const registry = createTools(
        undefined,
        new TravelIntelligence(cfg, fetcher),
        true,
      ),
      execute = vi.spyOn(registry, "execute");
    await new AgentRuntime(c.router, registry, cfg).execute(
      run,
      c.conversation,
      "TEST ONLY Maldives",
      "en",
    );
    expect(run.status).toBe("completed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(run.toolExecutions[1]?.resultCode).toBe("TOOL_RESULT_REUSED");
  });

  it("finishes every parallel tool pair after the second rejection, asks naturally and allows a later general turn", async () => {
    const bad = () =>
      tool("propose_travel_constraints", {
        expectedVersion: 0,
        patch: { travellers: 8 },
        evidence: [],
      });
    const cfg = config(),
      fetcher = searcher();
    const adapter = new ScriptedAdapter([
      async () => bad(),
      async () => ({
        ...bad(),
        toolCalls: [...bad().toolCalls, ...research().toolCalls],
      }),
      async (input) => {
        expect(input.tools).toEqual([]);
        const issued = input.messages.flatMap((m) =>
          m.role === "assistant" ? m.toolCalls.map((t) => t.id) : [],
        );
        const resolved = input.messages.flatMap((m) =>
          m.role === "tool" ? [m.callId] : [],
        );
        expect(resolved).toEqual(issued);
        expect(input.messages.at(-1)).toMatchObject({
          role: "tool",
          result: { code: "FINAL_RESPONSE_REQUIRED" },
        });
        expect(input.messages.find((m) => m.role === "tool")).toMatchObject({
          result: {
            code: "CONSTRAINT_CONFLICT",
            data: { fields: ["travellers"] },
          },
        });
        return answer("هتكونوا كام شخص؟ نقدر نكمل كلامنا من غير افتراض عدد.");
      },
      async () => answer("TEST ONLY general explanation of gravity."),
    ]);
    const c = setup(adapter, cfg),
      runtime = new AgentRuntime(
        c.router,
        createTools(undefined, new TravelIntelligence(cfg, fetcher), true),
        cfg,
      );
    const run = c.state.createRun(c.conversation);
    await runtime.execute(
      run,
      c.conversation,
      "TEST ONLY unclear travellers",
      "ar-EG",
    );
    expect(run.status).toBe("completed");
    expect(run.toolExecutions.map((t) => t.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(c.conversation.travelState).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
    const next = c.state.createRun(c.conversation);
    await runtime.execute(
      next,
      c.conversation,
      "TEST ONLY explain gravity",
      "en",
    );
    expect(next.status).toBe("completed");
    expect(next.toolExecutions).toEqual([]);
  });

  it("completes a batch without executing calls beyond its call budget", async () => {
    const adapter = new ScriptedAdapter([
      async () => ({
        ...answer(""),
        toolCalls: [
          tool("search_company_packages", {}).toolCalls[0],
          tool("search_company_packages", { days: 3 }).toolCalls[0],
        ].filter((c) => c !== undefined),
      }),
      async (input) => {
        expect(input.tools).toEqual([]);
        expect(input.messages.at(-1)).toMatchObject({
          result: { code: "FINAL_RESPONSE_REQUIRED" },
        });
        return answer("TEST ONLY catalog unavailable; no offer invented.");
      },
    ]);
    const c = setup(adapter, testConfig({ MAX_TOOL_CALLS_PER_TURN: 1 })),
      run = c.state.createRun(c.conversation);
    await new AgentRuntime(c.router, createTools(), c.config).execute(
      run,
      c.conversation,
      "TEST ONLY catalog",
      "en",
    );
    expect(run.status).toBe("completed");
    expect(run.toolExecutions).toHaveLength(1);
  });
  it("releases a failed correction turn so a subsequent general question still completes", async () => {
    const bad = async () =>
      tool("propose_travel_constraints", {
        expectedVersion: 0,
        patch: { travellers: 8 },
        evidence: [],
      });
    const adapter = new ScriptedAdapter([
      bad,
      bad,
      bad,
      async () => answer("TEST ONLY general answer"),
    ]);
    const c = setup(adapter),
      runtime = new AgentRuntime(
        c.router,
        createTools(undefined, undefined, true),
        c.config,
      );
    const failed = c.state.createRun(c.conversation);
    await runtime.execute(
      failed,
      c.conversation,
      "TEST ONLY ambiguous trip",
      "en",
    );
    expect(failed.status).toBe("failed");
    expect(failed.toolExecutions).toHaveLength(2);
    expect(c.conversation.busy).toBe(false);
    expect(c.conversation.travelState).toBeUndefined();
    const next = c.state.createRun(c.conversation);
    await runtime.execute(
      next,
      c.conversation,
      "TEST ONLY general question",
      "en",
    );
    expect(next.status).toBe("completed");
    expect(next.toolExecutions).toEqual([]);
  });
  it("distinguishes the overall turn deadline from provider timeout and user cancellation", async () => {
    let time = Date.now();
    const now = vi.spyOn(Date, "now").mockImplementation(() => time);
    try {
      const adapter = new ScriptedAdapter([
        async () => {
          time += 1000;
          return answer("TEST ONLY late completed text");
        },
      ]);
      const c = setup(
          adapter,
          testConfig({ TURN_TIMEOUT_MS: 200, MODEL_TIMEOUT_MS: 100 }),
        ),
        run = c.state.createRun(c.conversation);
      await new AgentRuntime(c.router, createTools(), c.config).execute(
        run,
        c.conversation,
        "TEST ONLY",
        "en",
      );
      expect(run.budgetReason).toBe("turn_timeout");
      expect(run.events.at(-1)).toMatchObject({
        type: "run_failed",
        safeStatus: "TURN_BUDGET",
      });
      expect(c.conversation.messages).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it("reserves final time before a slow tool can consume the whole turn", async () => {
    vi.useFakeTimers();
    try {
      const cfg = testConfig({ TURN_TIMEOUT_MS: 900, MODEL_TIMEOUT_MS: 300 });
      const adapter = new ScriptedAdapter([
        async () => tool("test_slow", {}),
        async (input) => {
          expect(input.tools).toEqual([]);
          return answer("TEST ONLY completed using available results.");
        },
      ]);
      const c = setup(adapter, cfg),
        registry = new ToolRegistry();
      registry.register({
        name: "test_slow",
        description: "TEST ONLY",
        input: z.strictObject({}),
        output: ToolResult,
        timeoutMs: 5000,
        sideEffect: false,
        execute: async () => new Promise(() => {}),
      });
      const run = c.state.createRun(c.conversation),
        pending = new AgentRuntime(c.router, registry, cfg).execute(
          run,
          c.conversation,
          "TEST ONLY",
          "en",
        );
      await vi.advanceTimersByTimeAsync(610);
      await pending;
      expect(run.status).toBe("completed");
      expect(run.toolExecutions[0]?.resultCode).toBe("TOOL_CANCELED");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [testConfig({ MAX_TURN_TOKENS: 128 }), "TEST ONLY", "token_capacity"],
    [
      testConfig({ MAX_CONTEXT_CHARS: 1000 }),
      "TEST ONLY ".repeat(500),
      "context_capacity",
    ],
  ] as const)(
    "categorizes preflight budget failures without a model call",
    async (cfg, text, reason) => {
      const adapter = new ScriptedAdapter([]),
        c = setup(adapter, cfg),
        run = c.state.createRun(c.conversation);
      await new AgentRuntime(c.router, createTools(), cfg).execute(
        run,
        c.conversation,
        text,
        "en",
      );
      expect(run.status).toBe("failed");
      expect(run.budgetReason).toBe(reason);
      expect(adapter.inputs).toEqual([]);
    },
  );
});

describe("provider mapping, bounded retry and safe fallback", () => {
  it("rejects provider-truncated output without mislabeling it as upstream 503", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      candidates: [
        {
          finishReason: "MAX_TOKENS",
          content: { parts: [{ text: "TEST ONLY incomplete" }] },
        },
      ],
    });
    const error = await new GeminiAdapter("TEST ONLY", "TEST ONLY", 1000, {
      generateContent,
    })
      .generate(simpleInput, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "INVALID_MODEL_RESPONSE",
      providerFailure: { upstreamStatus: null },
    });
  });
  it("blocks late private stream chunks after an uncooperative adapter times out", async () => {
    const primary: ModelAdapter = {
      id: "gemini",
      capabilities: { tools: true, streaming: true, contextChars: 64000 },
      generate: async (_input, _signal, delta) => {
        setTimeout(() => delta?.("PRIVATE TEST LATE"), 60);
        return new Promise(() => {});
      },
    };
    const fallback: ModelAdapter = {
      id: "groq",
      capabilities: { tools: true, streaming: true, contextChars: 32000 },
      generate: async (_input, _signal, delta) => {
        delta?.("TEST ONLY good");
        return answer("TEST ONLY good");
      },
    };
    const deltas: string[] = [];
    const result = await new ModelRouter(
      [primary, fallback],
      testConfig({ ENABLE_PROVIDER_STREAMING: true, MODEL_TIMEOUT_MS: 20 }),
    ).generate(
      simpleInput,
      new AbortController().signal,
      (text) => {
        deltas.push(text);
      },
      undefined,
      { bufferedDeltas: true, deadlineAt: Date.now() + 500 },
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(result.providerId).toBe("groq");
    expect(deltas).toEqual(["TEST ONLY good"]);
  });
  it("records why an ineligible provider was skipped without logging context content", async () => {
    const adapter = new ScriptedAdapter([], "groq");
    const router = new ModelRouter(
      [
        {
          id: adapter.id,
          capabilities: { ...adapter.capabilities, contextChars: 100 },
          generate: adapter.generate.bind(adapter),
        },
      ],
      testConfig(),
    );
    await expect(
      router.generate(
        { ...simpleInput, system: "PRIVATE TEST SYSTEM".repeat(100) },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(router.statuses()[0]).toMatchObject({
      skipReason: "context_capacity",
    });
    expect(adapter.inputs).toEqual([]);
  });
  it("does not log user text, prompt data, arguments or generated answers in development", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true),
      stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const adapter = new ScriptedAdapter([
      async () => answer("PRIVATE TEST ANSWER"),
      async () => {
        throw Error("PRIVATE TEST ERROR");
      },
    ]);
    const c = setup(adapter, testConfig({ NODE_ENV: "development" })),
      runtime = new AgentRuntime(c.router, createTools(), c.config);
    await runtime.execute(
      c.state.createRun(c.conversation),
      c.conversation,
      "PRIVATE TEST USER",
      "en",
      { context: "PRIVATE TEST CONTEXT" },
    );
    await runtime.execute(
      c.state.createRun(c.conversation),
      c.conversation,
      "PRIVATE TEST FOLLOWUP",
      "en",
    );
    const logged = JSON.stringify([...stderr.mock.calls, ...stdout.mock.calls]);
    expect(logged).not.toContain("PRIVATE TEST");
    expect(logged).toContain("PROVIDER_UNAVAILABLE");
  });
  it("maps genuine Gemini 503 at the adapter boundary without reading/logging the body", async () => {
    const sdk = {
      generateContent: vi.fn(async () => {
        throw { status: 503, message: "PRIVATE TEST BODY" };
      }),
    };
    const error = await new GeminiAdapter("TEST ONLY", "TEST ONLY", 1000, sdk)
      .generate(simpleInput, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      providerFailure: { upstreamStatus: 503 },
    });
    expect(JSON.stringify(error)).not.toContain("PRIVATE TEST BODY");
  });
  it("does not invent upstream 503 for an internal invalid/truncated model response", () => {
    const error = providerError(
      new SafeError("INVALID_MODEL_RESPONSE"),
      new AbortController().signal,
      { provider: "gemini", model: "TEST ONLY", operation: "generate" },
    );
    expect(error).toMatchObject({
      code: "INVALID_MODEL_RESPONSE",
      providerFailure: { upstreamStatus: null },
    });
  });
  it("retries temporary failures within the configured limit, but never retries quota", async () => {
    const temporary = new ScriptedAdapter([
      async (_input, signal) => {
        throw upstream503(signal);
      },
      async () => answer(),
    ]);
    await new ModelRouter(
      [temporary],
      testConfig({ PROVIDER_RETRIES: 1 }),
    ).generate(simpleInput, new AbortController().signal);
    expect(temporary.inputs).toHaveLength(2);
    const quota = new ScriptedAdapter([
      async () => {
        throw new SafeError("PROVIDER_QUOTA");
      },
    ]);
    const router = new ModelRouter(
      [quota],
      testConfig({ PROVIDER_RETRIES: 2 }),
    );
    for (let i = 0; i < 2; i++)
      await expect(
        router.generate(simpleInput, new AbortController().signal),
      ).rejects.toMatchObject({ code: "PROVIDER_QUOTA" });
    expect(quota.inputs).toHaveLength(1);
  });
  it("allows fallback for privately buffered stream failures without leaking/mixing partial answers", async () => {
    const primary: ModelAdapter = {
      id: "gemini",
      capabilities: { tools: true, streaming: true, contextChars: 64000 },
      generate: vi.fn(async (_input, signal, delta) => {
        delta?.("PRIVATE TEST PARTIAL");
        throw upstream503(signal);
      }),
    };
    const fallback: ModelAdapter = {
      id: "groq",
      capabilities: { tools: true, streaming: true, contextChars: 32000 },
      generate: vi.fn(async (_input, _signal, delta) => {
        delta?.("TEST ONLY final");
        return answer("TEST ONLY final");
      }),
    };
    const deltas: string[] = [];
    const result = await new ModelRouter(
      [primary, fallback],
      testConfig({ ENABLE_PROVIDER_STREAMING: true }),
    ).generate(
      simpleInput,
      new AbortController().signal,
      (text) => {
        deltas.push(text);
      },
      undefined,
      { bufferedDeltas: true },
    );
    expect(result.providerId).toBe("groq");
    expect(deltas).toEqual(["TEST ONLY final"]);
  });
  it("fits Groq by removing foreign native signatures while preserving tool IDs/results", async () => {
    const primary = new ScriptedAdapter(
      [
        async (_input, signal) => {
          throw upstream503(signal);
        },
      ],
      "gemini",
    );
    const fallback = new ScriptedAdapter(
      [
        async (input) => {
          expect(JSON.stringify(input)).not.toContain("opaque-signature");
          expect(input.messages.at(-1)).toMatchObject({
            role: "tool",
            callId: "call",
          });
          return answer();
        },
      ],
      "groq",
    );
    const input: ModelInput = {
      ...simpleInput,
      messages: [
        ...simpleInput.messages,
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call", name: "research_destination", arguments: {} },
          ],
          native: {
            provider: "gemini",
            parts: [{ thoughtSignature: "opaque-signature".repeat(2400) }],
          },
        },
        {
          role: "tool",
          callId: "call",
          name: "research_destination",
          result: {
            status: "ok",
            evidence: "general_information",
            data: { currency: "EGP", budgetMinor: 3000000 },
          },
        },
      ],
    };
    const result = await new ModelRouter(
      [
        primary,
        {
          ...fallback,
          id: fallback.id,
          capabilities: { ...fallback.capabilities, contextChars: 32000 },
          generate: fallback.generate.bind(fallback),
        },
      ],
      testConfig(),
    ).generate(input, new AbortController().signal);
    expect(result.providerId).toBe("groq");
    expect(primary.inputs).toHaveLength(1);
  });
  it("allows tools-off answers on a provider without tool-generation capability", async () => {
    const generate = vi.fn<ModelAdapter["generate"]>(async () => answer());
    const adapter = {
      id: "TEST ONLY text",
      capabilities: { tools: false, streaming: false, contextChars: 32000 },
      generate,
    };
    await new ModelRouter([adapter], testConfig()).generate(
      simpleInput,
      new AbortController().signal,
    );
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("context and research cache boundaries", () => {
  it("clears derived research on owner privacy changes and does not reuse it afterward", async () => {
    const cfg = config(),
      fetcher = searcher();
    let entered = () => {};
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release = (_value: ReturnType<typeof answer>) => {};
    const adapter = new ScriptedAdapter([
      async () => research(),
      async () => grounded(),
      async () => research(),
      async () => {
        entered();
        return new Promise<ReturnType<typeof answer>>((resolve) => {
          release = resolve;
        });
      },
    ]);
    const c = setup(adapter, cfg),
      runtime = new AgentRuntime(
        c.router,
        createTools(undefined, new TravelIntelligence(cfg, fetcher), true),
        cfg,
      );
    await runtime.execute(
      c.state.createRun(c.conversation),
      c.conversation,
      "TEST ONLY Maldives",
      "en",
    );
    expect(c.conversation.research?.sources.size).toBe(1);
    c.state.cancelOwner(c.ownerId);
    expect(c.conversation.research).toBeUndefined();
    const canceled = c.state.createRun(c.conversation);
    const pending = runtime.execute(
      canceled,
      c.conversation,
      "TEST ONLY Maldives",
      "en",
    );
    await waiting;
    c.state.cancelOwner(c.ownerId);
    release(grounded());
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(canceled.status).toBe("canceled");
    expect(c.conversation.research).toBeUndefined();
    expect(canceled.events.at(-1)?.textDelta).toBeUndefined();
  });
  it("compacts large untrusted excerpts without changing financial facts, IDs, URLs or stored input", () => {
    const original: ModelInput = {
      ...simpleInput,
      messages: [
        ...simpleInput.messages,
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "a", name: "test", arguments: {} }],
        },
        {
          role: "tool",
          callId: "a",
          name: "test",
          result: {
            status: "ok",
            evidence: "general_information",
            data: {
              currency: "EGP",
              budgetMinor: 3000000,
              travellers: 2,
              includesFlights: false,
              sources: [
                {
                  id: "exact-id",
                  url: sourceUrl,
                  retrievedAt: "2026-11-07T00:00:00.000Z",
                  excerpt: "TEST ONLY ".repeat(1500),
                },
              ],
            },
          },
        },
      ],
    };
    const before = JSON.stringify(original),
      compacted = fitModelInput(original, 3000);
    expect(compacted).toBeDefined();
    expect(inputChars(compacted as ModelInput)).toBeLessThan(3000);
    expect(compacted?.messages.at(-1)).toMatchObject({
      role: "tool",
      result: {
        data: {
          currency: "EGP",
          budgetMinor: 3000000,
          travellers: 2,
          includesFlights: false,
          sources: [{ id: "exact-id", url: sourceUrl }],
        },
      },
    });
    expect(JSON.stringify(original)).toBe(before);
    const reservedNames: ModelInput = {
      ...simpleInput,
      messages: [
        {
          role: "tool",
          callId: "b",
          name: "test",
          result: {
            status: "ok",
            evidence: "general_information",
            data: {
              native: "x".repeat(4000),
              attachments: [{ data: "y".repeat(4000) }],
            },
          },
        },
      ],
    };
    expect(inputChars(reservedNames, true)).toBeGreaterThan(8000);
  });
  it("never reuses another owner's/conversation's evidence and expires cached results", async () => {
    const cfg = config(),
      fetcher = searcher(),
      scope = researchScope("owner", "conversation", randomUUID());
    await new TravelIntelligence(cfg, fetcher).research(
      "destination_research",
      "Maldives",
      "TEST ONLY",
      {
        ownerId: "owner",
        conversationId: "conversation",
        signal: new AbortController().signal,
        research: scope,
      },
    );
    expect(
      researchScope("other", "conversation", randomUUID(), scope).sources.size,
    ).toBe(0);
    expect(
      researchScope("owner", "other", randomUUID(), scope).cache.size,
    ).toBe(0);
    expect(
      researchScope(
        "owner",
        "conversation",
        randomUUID(),
        scope,
        Date.now() + 600001,
      ).cache.size,
    ).toBe(0);
    expect(
      researchScope("owner", "conversation", randomUUID(), scope).cache.size,
    ).toBe(1);
  });
});
