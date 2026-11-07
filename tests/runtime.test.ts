import { ToolResult } from "@sadeeman/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentRuntime } from "../apps/api/src/agent/runtime.js";
import { SafeError } from "../apps/api/src/errors.js";
import { ModelRouter } from "../apps/api/src/providers/router.js";
import { createTools, ToolRegistry } from "../apps/api/src/tools/registry.js";
import { answer, ScriptedAdapter, setup, testConfig, tool } from "./helpers.js";

describe("bounded agent runtime — providers mocked only inside tests", () => {
  it("executes real deterministic budget tool, then returns the model answer and truthful events", async () => {
    const adapter = new ScriptedAdapter([
      async () =>
        tool("estimate_trip_budget", {
          currency: "EGP",
          items: [
            {
              label: "Synthetic estimate",
              unitAmountMinor: 690000,
              quantity: 2,
            },
          ],
          assumptions: ["Fictional example; transport excluded"],
        }),
      async (input) => {
        const result = input.messages.at(-1);
        expect(result?.role).toBe("tool");
        if (result?.role === "tool")
          expect(result.result).toMatchObject({
            status: "ok",
            evidence: "estimated_itinerary",
            data: { totalMinor: 1380000, bookable: false },
          });
        return answer("تقدير تجريبي، مش حجز.");
      },
    ]);
    const ctx = setup(adapter);
    const run = ctx.state.createRun(ctx.conversation);
    await new AgentRuntime(ctx.router, createTools(), ctx.config).execute(
      run,
      ctx.conversation,
      "احسب تقدير لفردين",
      "ar-EG",
    );
    expect(run.status).toBe("completed");
    expect(run.events.map((e) => e.type)).toEqual([
      "run_started",
      "model_processing",
      "tool_started",
      "tool_completed",
      "model_processing",
      "response_completed",
    ]);
    expect(
      run.events.some((e) => e.type === ("response_delta" as string)),
    ).toBe(false);
    expect(run.usage).toEqual({ inputTokens: 20, outputTokens: 20 });
  });
  it("preserves multi-turn off-topic context without putting user text in event traces", async () => {
    const adapter = new ScriptedAdapter([
      async () => answer("State is local; props are inputs."),
      async (input) => {
        expect(input.messages.map((m) => m.role)).toEqual([
          "user",
          "assistant",
          "user",
        ]);
        expect(input.messages[0]).toMatchObject({
          content: "Explain React state and props",
        });
        expect(input.system).toContain("Answer off-topic questions fully");
        return answer("Here is an example.");
      },
    ]);
    const ctx = setup(adapter);
    const runtime = new AgentRuntime(ctx.router, createTools(), ctx.config);
    await runtime.execute(
      ctx.state.createRun(ctx.conversation),
      ctx.conversation,
      "Explain React state and props",
      "en",
    );
    const run = ctx.state.createRun(ctx.conversation);
    await runtime.execute(run, ctx.conversation, "Explain that example", "en");
    expect(run.status).toBe("completed");
    expect(JSON.stringify(run.events)).not.toContain("Explain that example");
  });
  it("rejects forged consent and unknown mutation tools without executing side effects", async () => {
    const adapter = new ScriptedAdapter([
      async () =>
        tool("create_lead", { consentGranted: true, ownerId: "another-user" }),
      async (input) => {
        expect(input.messages.at(-1)).toMatchObject({
          role: "tool",
          result: { status: "rejected", code: "TOOL_NOT_AUTHORIZED" },
        });
        return answer("No lead was saved.");
      },
    ]);
    const ctx = setup(adapter);
    const run = ctx.state.createRun(ctx.conversation);
    await new AgentRuntime(ctx.router, createTools(), ctx.config).execute(
      run,
      ctx.conversation,
      "save",
      "en",
    );
    expect(run.events.find((e) => e.type === "tool_failed")).toMatchObject({
      toolName: "unregistered_tool",
      safeStatus: "TOOL_NOT_AUTHORIZED",
    });
    expect(JSON.stringify(run.events)).not.toContain("consentGranted");
  });
  it("rejects invalid Zod arguments before tool execution", async () => {
    const adapter = new ScriptedAdapter([
      async () =>
        tool("search_company_packages", { days: -3, consentGranted: true }),
      async (input) => {
        expect(input.messages.at(-1)).toMatchObject({
          result: { code: "INVALID_TOOL_ARGUMENTS" },
        });
        return answer("Please correct the duration.");
      },
    ]);
    const ctx = setup(adapter);
    const run = ctx.state.createRun(ctx.conversation);
    await new AgentRuntime(ctx.router, createTools(), ctx.config).execute(
      run,
      ctx.conversation,
      "x",
      "en",
    );
    expect(run.events.find((e) => e.type === "tool_failed")?.safeStatus).toBe(
      "INVALID_TOOL_ARGUMENTS",
    );
  });
  it("reports unavailable catalog instead of injecting fictional offers", async () => {
    const registry = createTools();
    const result = await registry.execute(
      { id: "a", name: "search_company_packages", arguments: {} },
      {
        ownerId: "a",
        conversationId: "b",
        signal: new AbortController().signal,
      },
    );
    expect(result).toEqual({
      status: "unavailable",
      evidence: "unavailable",
      code: "CATALOG_DATABASE_NOT_CONNECTED",
    });
  });
  it("stops tool loops at the configured round limit and releases the conversation", async () => {
    const adapter = new ScriptedAdapter(
      Array.from(
        { length: 3 },
        () => async () => tool("search_company_packages", {}),
      ),
    );
    const ctx = setup(adapter, testConfig({ MAX_AGENT_TOOL_ROUNDS: 2 }));
    const run = ctx.state.createRun(ctx.conversation);
    await new AgentRuntime(ctx.router, createTools(), ctx.config).execute(
      run,
      ctx.conversation,
      "x",
      "en",
    );
    expect(adapter.inputs).toHaveLength(3);
    expect(run.events.filter((e) => e.type === "tool_started")).toHaveLength(2);
    expect(run.events.at(-1)).toMatchObject({
      type: "run_failed",
      safeStatus: "TURN_BUDGET",
    });
    expect(ctx.conversation.busy).toBe(false);
    expect(ctx.conversation.messages).toHaveLength(0);
  });
  it("stops repeated tool-call IDs instead of re-executing them", async () => {
    const adapter = new ScriptedAdapter([
      async () => tool("search_company_packages", {}, "duplicate"),
      async () => tool("search_company_packages", {}, "duplicate"),
    ]);
    const ctx = setup(adapter);
    const run = ctx.state.createRun(ctx.conversation);
    await new AgentRuntime(ctx.router, createTools(), ctx.config).execute(
      run,
      ctx.conversation,
      "x",
      "en",
    );
    expect(run.events.filter((e) => e.type === "tool_started")).toHaveLength(1);
    expect(run.events.at(-1)?.safeStatus).toBe("INVALID_MODEL_RESPONSE");
  });
  it("rejects an impossible token budget before generation or commit", async () => {
    const adapter = new ScriptedAdapter([
      async () => ({
        ...answer(),
        usage: { inputTokens: 200, outputTokens: 100 },
      }),
    ]);
    const ctx = setup(adapter, testConfig({ MAX_TURN_TOKENS: 128 }));
    const run = ctx.state.createRun(ctx.conversation);
    await new AgentRuntime(ctx.router, createTools(), ctx.config).execute(
      run,
      ctx.conversation,
      "x",
      "en",
    );
    expect(run.events.at(-1)?.safeStatus).toBe("TURN_BUDGET");
    expect(ctx.conversation.messages).toHaveLength(0);
    expect(adapter.inputs).toHaveLength(0);
  });
  it("bounds an adapter that ignores abort and preserves retry context", async () => {
    const adapter = new ScriptedAdapter([async () => new Promise(() => {})]);
    const ctx = setup(adapter, testConfig({ MODEL_TIMEOUT_MS: 50 }));
    const run = ctx.state.createRun(ctx.conversation);
    await new AgentRuntime(ctx.router, createTools(), ctx.config).execute(
      run,
      ctx.conversation,
      "x",
      "en",
    );
    expect(run.events.at(-1)?.safeStatus).toBe("PROVIDER_TIMEOUT");
    expect(ctx.conversation.messages).toHaveLength(0);
  });
  it("cancels an in-flight request and clears busy state", async () => {
    const adapter = new ScriptedAdapter([async () => new Promise(() => {})]);
    const ctx = setup(adapter);
    const run = ctx.state.createRun(ctx.conversation);
    const pending = new AgentRuntime(
      ctx.router,
      createTools(),
      ctx.config,
    ).execute(run, ctx.conversation, "x", "en");
    run.controller.abort();
    await pending;
    expect(run.status).toBe("canceled");
    expect(ctx.conversation.busy).toBe(false);
    expect(run.events.at(-1)?.type).toBe("run_canceled");
  });
  it("rejects malformed model outputs and never exposes raw provider errors", async () => {
    const adapter = new ScriptedAdapter([
      async () => {
        throw new Error("secret-provider-payload");
      },
    ]);
    const ctx = setup(adapter);
    const run = ctx.state.createRun(ctx.conversation);
    await new AgentRuntime(ctx.router, createTools(), ctx.config).execute(
      run,
      ctx.conversation,
      "x",
      "en",
    );
    expect(JSON.stringify(run.events)).not.toContain("secret-provider-payload");
    expect(run.events.at(-1)?.safeStatus).toBe("PROVIDER_UNAVAILABLE");
  });
});

describe("provider routing and tool boundaries", () => {
  const input = {
    system: "Test",
    messages: [{ role: "user" as const, content: "Test" }],
    tools: [],
    maxOutputTokens: 64,
  };
  it("uses one healthy provider only", async () => {
    const primary = new ScriptedAdapter([async () => answer()], "primary");
    const fallback = new ScriptedAdapter([async () => answer()], "fallback");
    await new ModelRouter([primary, fallback], testConfig()).generate(
      input,
      new AbortController().signal,
    );
    expect(primary.inputs).toHaveLength(1);
    expect(fallback.inputs).toHaveLength(0);
  });
  it("uses explicit compatible fallback after a quota failure", async () => {
    const primary = new ScriptedAdapter(
      [
        async () => {
          throw new SafeError("PROVIDER_QUOTA");
        },
      ],
      "primary",
    );
    const fallback = new ScriptedAdapter([async () => answer()], "fallback");
    const result = await new ModelRouter(
      [primary, fallback],
      testConfig(),
    ).generate(input, new AbortController().signal);
    expect(result.providerId).toBe("fallback");
  });
  it("retries safe generation only within configured budget", async () => {
    const adapter = new ScriptedAdapter([
      async () => {
        throw new SafeError("PROVIDER_UNAVAILABLE");
      },
      async () => answer(),
    ]);
    await new ModelRouter(
      [adapter],
      testConfig({ PROVIDER_RETRIES: 1 }),
    ).generate(input, new AbortController().signal);
    expect(adapter.inputs).toHaveLength(2);
  });
  it("fails over to the fallback immediately on timeout instead of retrying the primary", async () => {
    const primary = new ScriptedAdapter(
      [
        async () => {
          throw new SafeError("PROVIDER_TIMEOUT");
        },
      ],
      "primary",
    );
    const fallback = new ScriptedAdapter([async () => answer()], "fallback");
    const result = await new ModelRouter(
      [primary, fallback],
      testConfig({ PROVIDER_RETRIES: 1 }),
    ).generate(input, new AbortController().signal);
    expect(primary.inputs).toHaveLength(1);
    expect(fallback.inputs).toHaveLength(1);
    expect(result.providerId).toBe("fallback");
  });
  it("reports the primary's quota error rather than the fallback's generic failure", async () => {
    const primary = new ScriptedAdapter(
      [
        async () => {
          throw new SafeError("PROVIDER_QUOTA");
        },
      ],
      "primary",
    );
    const fallback = new ScriptedAdapter(
      [
        async () => {
          throw new SafeError("PROVIDER_UNAVAILABLE");
        },
      ],
      "fallback",
    );
    await expect(
      new ModelRouter(
        [primary, fallback],
        testConfig({ PROVIDER_RETRIES: 0 }),
      ).generate(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "PROVIDER_QUOTA" });
  });
  it("opens circuit after three failures and avoids another call", async () => {
    const adapter = new ScriptedAdapter(
      Array.from({ length: 3 }, () => async () => {
        throw new SafeError("PROVIDER_UNAVAILABLE");
      }),
    );
    const router = new ModelRouter([adapter], testConfig());
    for (let i = 0; i < 4; i++)
      await expect(
        router.generate(input, new AbortController().signal),
      ).rejects.toBeInstanceOf(SafeError);
    expect(adapter.inputs).toHaveLength(3);
  });
  it("cannot register a mutation without a durable authorization implementation", () => {
    expect(() =>
      new ToolRegistry().register({
        name: "save",
        description: "x",
        input: z.object({}),
        output: ToolResult,
        timeoutMs: 10,
        sideEffect: true,
        execute: async () => ({
          status: "ok",
          evidence: "general_information",
        }),
      }),
    ).toThrow("durable authorization");
  });
  it("validates and bounds tool outputs", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "large",
      description: "test only",
      input: z.object({}),
      output: ToolResult,
      timeoutMs: 100,
      sideEffect: false,
      execute: async () => ({
        status: "ok",
        evidence: "general_information",
        data: "x".repeat(25000),
      }),
    });
    const result = await registry.execute(
      { id: "a", name: "large", arguments: {} },
      {
        ownerId: "a",
        conversationId: "b",
        signal: new AbortController().signal,
      },
    );
    expect(result).toMatchObject({
      status: "failed",
      code: "INVALID_TOOL_OUTPUT",
    });
  });
});
