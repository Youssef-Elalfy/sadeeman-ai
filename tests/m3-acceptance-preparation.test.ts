import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../apps/api/src/agent/runtime.js";
import {
  capEvaluationRequests,
  comparisonMatches,
  TravelDialogueCase,
} from "../apps/api/src/evals/travel.js";
import { TravelIntelligence } from "../apps/api/src/research/travel.js";
import { createTools } from "../apps/api/src/tools/registry.js";
import { answer, ScriptedAdapter, setup, testConfig, tool } from "./helpers.js";

async function cases() {
  return (
    await readFile(
      new URL("./evals/m3.scenarios.jsonl", import.meta.url),
      "utf8",
    )
  )
    .trim()
    .split(/\r?\n/)
    .map((line) => TravelDialogueCase.parse(JSON.parse(line)));
}
describe("bounded M3 acceptance preparation — no live calls", () => {
  it("defines three explicit turns and retains money when only traveler count changes", async () => {
    const rows = await cases(),
      first = rows[0],
      budget = rows[1],
      party = rows[2];
    expect(rows).toHaveLength(3);
    expect(first?.requiresSources).toBe(true);
    expect(budget?.requiresSources).toBe(false);
    expect(party?.requiresSources).toBe(false);
    expect(party?.expectedConstraints).toEqual({
      ...budget?.expectedConstraints,
      travellers: 3,
    });
    expect(party?.expectedOptionTotalsMinor).toEqual(
      budget?.expectedOptionTotalsMinor,
    );
  });
  it("rejects a false comparison pass if price, currency, party size or budget drift", async () => {
    const scenario = (await cases())[2];
    if (!scenario) throw new Error("Missing fixture");
    const result = {
      currency: "EGP",
      travellers: 3,
      totalBudgetMinor: 250000,
      options: [
        {
          destination: "Kyoto",
          days: 2,
          totalMinor: 200000,
          withinBudget: true,
        },
        {
          destination: "Kyoto",
          days: 2,
          totalMinor: 300000,
          withinBudget: false,
        },
      ],
    };
    expect(comparisonMatches(result, scenario)).toBe(true);
    for (const patch of [
      { currency: "USD" },
      { travellers: 2 },
      { totalBudgetMinor: 1 },
      {
        options: [
          { ...result.options[0], totalMinor: 600000 },
          result.options[1],
        ],
      },
    ])
      expect(comparisonMatches({ ...result, ...patch }, scenario)).toBe(false);
  });
  it("counts actual adapter attempts and blocks a request before exceeding the hard cap", async () => {
    const adapter = new ScriptedAdapter(
        [async () => answer(), async () => answer()],
        "gemini",
      ),
      c = setup(adapter),
      cap = capEvaluationRequests(c.router, 2);
    const input = {
      system: "TEST ONLY",
      messages: [],
      tools: [],
      maxOutputTokens: 64,
    };
    await c.router.generate(input, new AbortController().signal);
    await c.router.generate(input, new AbortController().signal);
    await expect(
      c.router.generate(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "TURN_BUDGET" });
    expect(adapter.inputs).toHaveLength(2);
    expect(cap.requests).toBe(2);
  });
  it("executes numeric context follow-ups with real deterministic tools; research is tested separately", async () => {
    const rows = await cases(),
      comparisons: unknown[] = [];
    let turnIndex = 0;
    const compare = () =>
      tool("compare_travel_options", {
        currency: "EGP",
        travellers: turnIndex === 1 ? 2 : 3,
        totalBudgetMinor: 250000,
        options: [200000, 300000].map((amount) => ({
          destination: "Kyoto",
          days: 2,
          items: [
            {
              label: "User party-total estimate",
              unitAmountMinor: amount,
              quantity: 1,
            },
          ],
          assumptions: [
            "PUBLIC TEST user supplied total, not a commercial price",
          ],
        })),
      });
    const capture = (input: Parameters<ScriptedAdapter["generate"]>[0]) => {
      const last = input.messages.at(-1);
      if (last?.role !== "tool") throw new Error("Missing test tool result");
      comparisons.push(last.result.data);
      return answer("التقديرات والعملة زي ما هي؛ تكلفة الفرد تقديرية.");
    };
    const adapter = new ScriptedAdapter([
      async () =>
        tool("propose_travel_constraints", {
          expectedVersion: 0,
          patch: rows[0]?.expectedConstraints,
          evidence: [
            { field: "destination", quote: "Kyoto" },
            { field: "days", quote: "2 أيام" },
            { field: "travellers", quote: "2 مسافرين" },
            { field: "currency", quote: "EGP" },
            { field: "budgetMinor", quote: "300000 قرش EGP" },
            { field: "budgetBasis", quote: "الإجمالية total" },
          ],
        }),
      async () =>
        answer("التفاصيل في سياق الاختبار فقط؛ البحث متحقق باختبارات منفصلة."),
      async () =>
        tool("propose_travel_constraints", {
          expectedVersion: 1,
          patch: { budgetMinor: 250000 },
          evidence: [{ field: "budgetMinor", quote: "250000 قرش EGP" }],
        }),
      async () => compare(),
      async (input) => capture(input),
      async () =>
        tool("propose_travel_constraints", {
          expectedVersion: 2,
          patch: { travellers: 3 },
          evidence: [{ field: "travellers", quote: "3 مسافرين" }],
        }),
      async () => compare(),
      async (input) => capture(input),
    ]);
    const cfg = testConfig(),
      c = setup(adapter, cfg),
      registry = createTools(
        undefined,
        new TravelIntelligence(cfg, async () => {
          throw new Error("No offline search expected");
        }),
        true,
      ),
      runtime = new AgentRuntime(c.router, registry, cfg);
    for (const row of rows) {
      const run = c.state.createRun(c.conversation);
      await runtime.execute(run, c.conversation, row.content, "ar-EG");
      expect(run.status).toBe("completed");
      expect(c.conversation.travelState?.constraints).toEqual(
        row.expectedConstraints,
      );
      expect(run.research?.searchCalls).toBe(0);
      turnIndex++;
    }
    expect(comparisons).toHaveLength(2);
    const scenario = rows[2];
    if (!scenario) throw new Error("Missing test scenario");
    expect(comparisonMatches(comparisons[1], scenario)).toBe(true);
  });
});
