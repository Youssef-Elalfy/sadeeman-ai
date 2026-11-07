import { randomUUID } from "node:crypto";
import type { TravelState } from "@sadeeman/contracts";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../apps/api/src/agent/runtime.js";
import { providerError, SafeError } from "../apps/api/src/errors.js";
import { ModelRouter } from "../apps/api/src/providers/router.js";
import {
  createTools,
  type ToolContext,
} from "../apps/api/src/tools/registry.js";
import {
  emptyTravelState,
  proposeConstraints,
  type TravelTurn,
} from "../apps/api/src/travel/context.js";
import { answer, ScriptedAdapter, setup, testConfig, tool } from "./helpers.js";

const initial: TravelState = {
  version: 1,
  constraints: {
    destination: "Turkey",
    days: 5,
    travellers: 2,
    adults: 2,
    currency: "EGP",
    budgetMinor: 3000000,
    budgetBasis: "party_total",
  },
  options: [{ id: randomUUID(), title: "TEST ONLY program" }],
};
function turn(text: string): TravelTurn {
  return {
    base: structuredClone(initial),
    draft: structuredClone(initial),
    userText: text,
    dirty: false,
  };
}
const context = (travel: TravelTurn): ToolContext => ({
  ownerId: randomUUID(),
  conversationId: randomUUID(),
  signal: new AbortController().signal,
  travel,
});
const propose = (
  patch: Record<string, unknown>,
  evidence: { field: string; quote: string }[],
  version = 1,
) =>
  tool("propose_travel_constraints", {
    expectedVersion: version,
    patch,
    evidence,
  });
const firstCall = (output: ReturnType<typeof tool>) => {
  const call = output.toolCalls[0];
  if (!call) throw new Error("Missing test call");
  return call;
};
describe("M3 structured context — deterministic protocol checks, not live language quality", () => {
  it.each([
    ["طب بدل 5 أيام خليهم 7.", "days", 7],
    ["إحنا 3 أشخاص مش اتنين.", "travellers", 3],
    ["الميزانية الإجمالية 25000 جنيه مصري", "budgetMinor", 2500000],
    ["خلينا سبعة أيام", "days", 7],
    ["خليها ٧ أيام", "days", 7],
  ])("changes only the explicit field for %s", async (text, field, value) => {
    const t = turn(String(text)),
      registry = createTools(undefined, undefined, true);
    expect(
      await registry.execute(
        firstCall(
          propose({ [field]: value }, [
            { field: String(field), quote: String(text) },
          ]),
        ),
        context(t),
      ),
    ).toMatchObject({ status: "ok" });
    const expected: Record<string, unknown> = {
      ...initial.constraints,
      [String(field)]: value,
    };
    // A new head-count invalidates the old 2-adult split: it becomes unknown.
    if (field === "travellers") delete expected.adults;
    expect(t.draft.constraints).toEqual(expected);
    expect(t.base).toEqual(initial);
  });
  it("preserves budget when 'lower' has no amount and offers structured clarification feedback", async () => {
    const t = turn("طب لو الميزانية أقل؟"),
      registry = createTools(undefined, undefined, true);
    const result = await registry.execute(
      firstCall(
        propose({ budgetMinor: 2000000 }, [
          { field: "budgetMinor", quote: t.userText },
        ]),
      ),
      context(t),
    );
    expect(result).toMatchObject({
      status: "rejected",
      code: "CONSTRAINT_CONFLICT",
      data: { reason: "CONSTRAINT_VALUE_NOT_EXPLICIT" },
    });
    expect(t.draft).toEqual(initial);
    expect(t.dirty).toBe(false);
  });
  it("changes destination and excludes the rejected country without resetting money or party size", async () => {
    const t = turn("مش عايز تركيا، شوفلي إيطاليا.");
    proposeConstraints(
      {
        expectedVersion: 1,
        patch: { destination: "إيطاليا", excludedDestinations: ["تركيا"] },
        evidence: [
          { field: "destination", quote: "إيطاليا" },
          { field: "excludedDestinations", quote: "مش عايز تركيا" },
        ],
      },
      t,
    );
    expect(t.draft.constraints).toEqual({
      ...initial.constraints,
      destination: "إيطاليا",
      excludedDestinations: ["تركيا"],
    });
    expect(t.draft.options).toEqual([]);
  });
  it("rejects invented quotes, unquoted traveller assumptions and a currency switch without a new amount", () => {
    expect(() =>
      proposeConstraints(
        {
          expectedVersion: 1,
          patch: { days: 7 },
          evidence: [{ field: "days", quote: "7 days" }],
        },
        turn("عايز نصيحة"),
      ),
    ).toThrow("CURRENT_USER_EVIDENCE_REQUIRED");
    expect(() =>
      proposeConstraints(
        { expectedVersion: 1, patch: { travellers: 3 }, evidence: [] },
        turn("3 أشخاص"),
      ),
    ).toThrow("CURRENT_USER_EVIDENCE_REQUIRED");
    expect(() =>
      proposeConstraints(
        {
          expectedVersion: 1,
          patch: { currency: "USD" },
          evidence: [{ field: "currency", quote: "USD" }],
        },
        turn("USD"),
      ),
    ).toThrow("CURRENCY_CHANGE_REQUIRES_EXPLICIT_AMOUNT");
  });
  it("allows an explicit new amount and currency, without converting the old budget", () => {
    const t = turn("الميزانية total 5000 USD");
    proposeConstraints(
      {
        expectedVersion: 1,
        patch: { currency: "USD", budgetMinor: 500000 },
        evidence: [
          { field: "currency", quote: "USD" },
          { field: "budgetMinor", quote: "5000 USD" },
        ],
      },
      t,
    );
    expect(t.draft.constraints).toEqual({
      ...initial.constraints,
      currency: "USD",
      budgetMinor: 500000,
    });
  });
  it("rejects unknown fields while returning paths and types without proposed values", async () => {
    const registry = createTools(undefined, undefined, true);
    const r = await registry.execute(
      firstCall(
        propose(
          { travellers: "DO_NOT_ECHO_TEST_VALUE", email: "TEST_SECRET" },
          [],
        ),
      ),
      context(turn("3")),
    );
    expect(r.code).toBe("INVALID_TOOL_ARGUMENTS");
    expect(JSON.stringify(r)).not.toContain("DO_NOT_ECHO_TEST_VALUE");
    expect(JSON.stringify(r)).not.toContain("TEST_SECRET");
    expect(r.data).toMatchObject({
      validationIssues: expect.arrayContaining([
        {
          path: "patch.travellers",
          code: "invalid_type",
          expectedType: "number",
        },
      ]),
    });
  });
  it("delivers conflict feedback to the model, then accepts one correction while preserving previous fields", async () => {
    const adapter = new ScriptedAdapter([
      async () => propose({ days: 9 }, [{ field: "days", quote: "7" }]),
      async (input) => {
        expect(input.messages.at(-1)).toMatchObject({
          role: "tool",
          result: {
            code: "CONSTRAINT_CONFLICT",
            data: { reason: "CONSTRAINT_VALUE_NOT_EXPLICIT" },
          },
        });
        return propose({ days: 7 }, [{ field: "days", quote: "7" }]);
      },
      async () =>
        answer("خليتهم 7 أيام وباقي التفاصيل زي ما هي، والأسعار محتاجة تحقق."),
    ]);
    const c = setup(adapter, testConfig()),
      run = c.state.createRun(c.conversation);
    c.conversation.travelState = structuredClone(initial);
    await new AgentRuntime(
      c.router,
      createTools(undefined, undefined, true),
      c.config,
    ).execute(run, c.conversation, "خليهم 7 أيام", "ar-EG");
    expect(run.status).toBe("completed");
    expect(run.toolExecutions.map((t) => t.status)).toEqual(["rejected", "ok"]);
    expect(c.conversation.travelState).toEqual({
      ...initial,
      version: 2,
      constraints: { ...initial.constraints, days: 7 },
      options: [],
    });
    expect(adapter.inputs[2]?.system).toContain('"days":7');
  });
  it("bounds repeated constraint conflicts and leaves prior conversation state intact", async () => {
    const bad = () =>
      Promise.resolve(
        propose({ budgetMinor: 100 }, [{ field: "budgetMinor", quote: "أقل" }]),
      );
    const adapter = new ScriptedAdapter([
        bad,
        bad,
        async (input) => {
          expect(input.tools).toEqual([]);
          return answer("تحب تخلي الميزانية كام؟");
        },
      ]),
      c = setup(adapter),
      run = c.state.createRun(c.conversation);
    c.conversation.travelState = structuredClone(initial);
    await new AgentRuntime(
      c.router,
      createTools(undefined, undefined, true),
      c.config,
    ).execute(run, c.conversation, "أقل", "ar-EG");
    expect(run.status).toBe("completed");
    expect(adapter.inputs).toHaveLength(3);
    expect(run.toolExecutions).toHaveLength(2);
    expect(run.events.at(-1)?.textDelta).toBe("تحب تخلي الميزانية كام؟");
    expect(c.conversation.travelState).toEqual(initial);
    expect(c.conversation.messages).toHaveLength(2);
  });
  it("rolls back staged context after provider quota or a failed durable commit", async () => {
    for (const failCommit of [false, true]) {
      const adapter = new ScriptedAdapter([
        async () => propose({ days: 7 }, [{ field: "days", quote: "7" }]),
        async () => {
          if (!failCommit) throw new SafeError("PROVIDER_QUOTA");
          return answer();
        },
      ]);
      const c = setup(adapter),
        run = c.state.createRun(c.conversation);
      c.conversation.travelState = structuredClone(initial);
      await new AgentRuntime(
        c.router,
        createTools(undefined, undefined, true),
        c.config,
      ).execute(run, c.conversation, "7 أيام", "ar-EG", {
        beforeComplete: async () => {
          throw new SafeError("DATABASE_UNAVAILABLE");
        },
      });
      expect(run.status).toBe("failed");
      expect(c.conversation.travelState).toEqual(initial);
      expect(c.conversation.messages).toEqual([]);
    }
  });
  it("prevents a comparison silently changing confirmed duration, currency, party size or budget", async () => {
    const registry = createTools(undefined, undefined, true),
      t = turn("قارن"),
      c = context(t);
    const input = {
      currency: "USD",
      totalBudgetMinor: 1,
      travellers: 4,
      options: [
        {
          destination: "Italy",
          days: 7,
          items: [{ label: "TEST", unitAmountMinor: 1, quantity: 1 }],
          assumptions: ["TEST ONLY"],
        },
        {
          destination: "Italy",
          days: 7,
          items: [{ label: "TEST", unitAmountMinor: 2, quantity: 1 }],
          assumptions: ["TEST ONLY"],
        },
      ],
    };
    // The real comparison tool is registered by TravelIntelligence; test its guard through a validated generic tool here.
    registry.register({
      name: "compare_travel_options",
      description: "TEST ONLY",
      input: (await import("@sadeeman/contracts")).TravelComparison,
      output: (await import("@sadeeman/contracts")).ToolResult,
      timeoutMs: 1000,
      sideEffect: false,
      execute: async () => {
        throw new Error("Guard must prevent execution");
      },
    });
    const result = await registry.execute(
      firstCall(tool("compare_travel_options", input)),
      c,
    );
    expect(result).toMatchObject({
      code: "CONSTRAINT_CONFLICT",
      data: {
        fields: expect.arrayContaining([
          "currency",
          "travellers",
          "totalBudgetMinor",
          "options.days",
          "options.destination",
        ]),
      },
    });
  });
  it("records the actual failing provider/model/operation without raw error bodies or headers", async () => {
    const primary = new ScriptedAdapter(
      [
        async () => {
          throw providerError(
            {
              status: 429,
              message: "TEST_SECRET",
              headers: { authorization: "TEST_SECRET" },
            },
            new AbortController().signal,
            { provider: "gemini", model: "TEST-MODEL", operation: "generate" },
          );
        },
      ],
      "gemini",
    );
    const fallback = new ScriptedAdapter(
      [async () => answer("رد بالمصري من البديل")],
      "groq",
    );
    const config = testConfig({ PROVIDER_RETRIES: 0 }),
      router = new ModelRouter([primary, fallback], config),
      c = setup(primary, config),
      run = c.state.createRun(c.conversation);
    c.conversation.travelState = structuredClone(initial);
    await new AgentRuntime(
      router,
      createTools(undefined, undefined, true),
      config,
    ).execute(run, c.conversation, "أهلاً", "ar-EG");
    expect(run.status).toBe("completed");
    expect(primary.inputs).toHaveLength(1);
    expect(fallback.inputs).toHaveLength(1);
    expect(run.providerFailures).toMatchObject([
      {
        provider: "gemini",
        model: "TEST-MODEL",
        operation: "generate",
        upstreamStatus: 429,
        category: "PROVIDER_QUOTA",
        quotaScope: "unknown",
        modelSpecific: null,
      },
    ]);
    expect(JSON.stringify(run.providerFailures)).not.toContain("TEST_SECRET");
    expect(c.conversation.travelState).toEqual(initial);
  });
  it("starts empty without inferring financial assumptions", () => {
    expect(emptyTravelState()).toEqual({
      version: 0,
      constraints: {},
      options: [],
    });
  });
});
