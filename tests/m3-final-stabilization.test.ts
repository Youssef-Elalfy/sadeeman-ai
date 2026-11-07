import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { TravelState } from "@sadeeman/contracts";
import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../apps/api/src/agent/runtime.js";
import {
  classifyAuthCleanup,
  expectedSignedOutDenial,
} from "../apps/api/src/evals/session.js";
import {
  comparisonMatches,
  TravelDialogueCase,
} from "../apps/api/src/evals/travel.js";
import { SupabaseDatabase } from "../apps/api/src/persistence/supabase.js";
import { TravelIntelligence } from "../apps/api/src/research/travel.js";
import { createTools } from "../apps/api/src/tools/registry.js";
import { PersistentCompanyCatalog } from "../apps/api/src/travel/catalog.js";
import {
  emptyTravelState,
  proposeConstraints,
} from "../apps/api/src/travel/context.js";
import { answer, ScriptedAdapter, setup, testConfig, tool } from "./helpers.js";

describe("final M3 stabilization — deterministic fixtures only, no live model quality claim", () => {
  it.each([401, 403])(
    "continues the check harness after expected sign-out denial %i",
    async (status) => {
      let stage = "auth_signout_removes_session_and_rejects_unexpired_jwt";
      let halted = false;
      const fetcher = vi.fn<typeof fetch>(async (input) => {
        if (halted) throw new Error("Test guard halted");
        const route = new URL(String(input)).pathname;
        const response =
          route === "/auth/v1/user"
            ? Response.json(
                { code: "session_not_found", message: "TEST ONLY" },
                { status },
              )
            : new Response(null, { status: 204 });
        if (
          !response.ok &&
          !expectedSignedOutDenial(stage, route, response.status)
        ) {
          halted = true;
          throw new Error("Unexpected test HTTP status");
        }
        return response;
      });
      const db = new SupabaseDatabase(
        testConfig({
          SUPABASE_URL: "https://ujdzysbowngtkwndgoqf.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        }),
        fetcher,
      );
      await expect(
        db.authenticate("Bearer TEST-ONLY-NOT-A-JWT"),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(fetcher).toHaveBeenCalledTimes(1);
      stage = "cleanup_second_auth_session";
      expect(
        (
          await fetcher(
            "https://ujdzysbowngtkwndgoqf.supabase.co/auth/v1/logout",
          )
        ).status,
      ).toBe(204);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(halted).toBe(false);
      expect(classifyAuthCleanup(204)).toBe("CONFIRMED_SIGNOUT");
      expect(classifyAuthCleanup(status)).toBe("DENIED_UNCONFIRMED");
      expect(classifyAuthCleanup(500)).toBe("UNEXPECTED");
      expect(expectedSignedOutDenial(stage, "/auth/v1/logout", status)).toBe(
        true,
      );
      expect(
        expectedSignedOutDenial(
          "create_and_authenticate_two_guests",
          "/auth/v1/user",
          status,
        ),
      ).toBe(false);
      expect(expectedSignedOutDenial(stage, "/auth/v1/user", 500)).toBe(false);
      expect(
        expectedSignedOutDenial(
          stage,
          "/rest/v1/sadeeman_conversations",
          status,
        ),
      ).toBe(false);
    },
  );

  it("preserves explicit dates across budget, traveler and date changes without silently changing money or duration", () => {
    const base = TravelState.parse({
      version: 1,
      constraints: {
        destination: "Kyoto",
        days: 4,
        travellers: 2,
        currency: "EGP",
        budgetMinor: 300000,
        budgetBasis: "party_total",
        startsOn: "2026-12-20",
        endsOn: "2026-12-23",
      },
      options: [{ id: randomUUID(), title: "TEST ONLY prior program" }],
    });
    const makeTurn = (text: string) => ({
      base: structuredClone(base),
      draft: structuredClone(base),
      userText: text,
      dirty: false,
    });
    const budget = makeTurn("خلّي الإجمالي 2500 EGP");
    proposeConstraints(
      {
        expectedVersion: 1,
        patch: { budgetMinor: 250000 },
        evidence: [{ field: "budgetMinor", quote: "2500 EGP" }],
      },
      budget,
    );
    expect(budget.draft.constraints).toEqual({
      ...base.constraints,
      budgetMinor: 250000,
    });
    const dates = makeTurn("بدّل المواعيد من ٢٠٢٧-٠١-١٠ لحد ٢٠٢٧-٠١-١٣");
    proposeConstraints(
      {
        expectedVersion: 1,
        patch: { startsOn: "2027-01-10", endsOn: "2027-01-13" },
        evidence: [
          { field: "startsOn", quote: "٢٠٢٧-٠١-١٠" },
          { field: "endsOn", quote: "٢٠٢٧-٠١-١٣" },
        ],
      },
      dates,
    );
    expect(dates.draft.constraints).toEqual({
      ...base.constraints,
      startsOn: "2027-01-10",
      endsOn: "2027-01-13",
    });
    expect(dates.draft.options).toEqual([]);
    const party = makeTurn("إحنا 3 مسافرين");
    proposeConstraints(
      {
        expectedVersion: 1,
        patch: { travellers: 3 },
        evidence: [{ field: "travellers", quote: "3 مسافرين" }],
      },
      party,
    );
    expect(party.draft.constraints).toEqual({
      ...base.constraints,
      travellers: 3,
    });
  });

  it("rejects an invented year or reversed date range and leaves prior state unchanged", () => {
    const state = TravelState.parse({
      ...emptyTravelState(),
      version: 1,
      constraints: { startsOn: "2026-12-20", endsOn: "2026-12-23" },
    });
    for (const [text, patch, field, quote, error] of [
      [
        "نسافر في ديسمبر",
        { startsOn: "2027-12-01" },
        "startsOn",
        "ديسمبر",
        "CONSTRAINT_VALUE_NOT_EXPLICIT",
      ],
      [
        "خلّي النهاية 2026-12-19",
        { endsOn: "2026-12-19" },
        "endsOn",
        "2026-12-19",
        "INVALID_TRAVEL_DATES",
      ],
    ] as const) {
      const turn = {
        base: structuredClone(state),
        draft: structuredClone(state),
        userText: text,
        dirty: false,
      };
      expect(() =>
        proposeConstraints(
          { expectedVersion: 1, patch, evidence: [{ field, quote }] },
          turn,
        ),
      ).toThrow(error);
      expect(turn.draft).toEqual(state);
    }
    expect(
      TravelState.safeParse({
        ...state,
        constraints: { startsOn: "2026-12-20", endsOn: "2026-12-19" },
      }).success,
    ).toBe(false);
  });

  it("finishes research → itinerary → invalid budget correction → traveler update with one test-only search", async () => {
    const cases = (
      await readFile(
        new URL("./evals/m3.scenarios.jsonl", import.meta.url),
        "utf8",
      )
    )
      .trim()
      .split(/\r?\n/)
      .map((l) => TravelDialogueCase.parse(JSON.parse(l)));
    const sourceUrl = "https://www.japan.travel/en/destinations/kansai/kyoto/";
    const cfg = testConfig({
      ENABLE_TRAVEL_RESEARCH: true,
      TAVILY_API_KEY: "TEST-ONLY",
    });
    const search = vi.fn<typeof fetch>(async () =>
      Response.json({
        results: [
          {
            url: sourceUrl,
            title: "TEST ONLY official-source fixture",
            content: "TEST ONLY Kyoto culture evidence",
            score: 0.9,
          },
        ],
      }),
    );
    const comparisons: unknown[] = [];
    const proposals = cases.map(
      (c, index) => () =>
        tool("propose_travel_constraints", {
          expectedVersion: index,
          patch:
            index === 0
              ? c.expectedConstraints
              : index === 1
                ? { budgetMinor: 250000 }
                : { travellers: 3 },
          evidence:
            index === 0
              ? [
                  { field: "destination", quote: "Kyoto" },
                  { field: "days", quote: "2 أيام" },
                  { field: "travellers", quote: "2 مسافرين" },
                  { field: "currency", quote: "EGP" },
                  { field: "budgetMinor", quote: "300000 قرش EGP" },
                  { field: "budgetBasis", quote: "الإجمالية total" },
                ]
              : index === 1
                ? [{ field: "budgetMinor", quote: "250000 قرش EGP" }]
                : [{ field: "travellers", quote: "3 مسافرين" }],
        }),
    );
    const compare = (travellers: number, invalid = false) =>
      tool("compare_travel_options", {
        currency: "EGP",
        travellers,
        totalBudgetMinor: 250000,
        options: [200000, 300000].map((n, index) => ({
          destination: "Kyoto",
          days: 2,
          items: [
            {
              label: "User supplied party-total estimate",
              unitAmountMinor: n,
              quantity: 1,
            },
          ],
          ...(!invalid || index !== 0
            ? { assumptions: ["TEST ONLY user estimate, no inventory"] }
            : {}),
        })),
      });
    const capture = (input: Parameters<ScriptedAdapter["generate"]>[0]) => {
      const last = input.messages.at(-1);
      if (last?.role !== "tool") throw new Error("Missing comparison output");
      comparisons.push(last.result.data);
      return answer(
        "الأول جوه الميزانية والتاني أعلى منها؛ دي تقديراتك لينا كلنا، مش سعر حجز مؤكد.",
      );
    };
    const adapter = new ScriptedAdapter([
      async () => proposals[0]?.() ?? answer(),
      async () =>
        tool("research_destination", {
          destination: "Kyoto",
          focus: "culture",
        }),
      async (input) => {
        const last = input.messages.at(-1);
        if (last?.role !== "tool") throw new Error("No source output");
        const data = last.result.data as { sources: { id: string }[] };
        return tool("build_itinerary", {
          destination: "Kyoto",
          days: 2,
          pace: "relaxed",
          sourceIds: data.sources.map((s) => s.id),
        });
      },
      async () =>
        answer(
          `خطة تقديرية بالمصري؛ المصدر [كيوتو](${sourceUrl}). مفيش سعر أو حجز مضمون.`,
        ),
      async () => proposals[1]?.() ?? answer(),
      async () => compare(2, true),
      async (input) => {
        expect(input.messages.at(-1)).toMatchObject({
          role: "tool",
          result: {
            code: "INVALID_TOOL_ARGUMENTS",
            data: {
              validationIssues: expect.arrayContaining([
                expect.objectContaining({ path: "options.0.assumptions" }),
              ]),
            },
          },
        });
        return compare(2);
      },
      async (input) => capture(input),
      async () => proposals[2]?.() ?? answer(),
      async () => compare(3),
      async (input) => capture(input),
    ]);
    const c = setup(adapter, cfg),
      runtime = new AgentRuntime(
        c.router,
        createTools(undefined, new TravelIntelligence(cfg, search), true),
        cfg,
      );
    const sequences: string[][] = [];
    for (const scenario of cases) {
      const run = c.state.createRun(c.conversation);
      await runtime.execute(run, c.conversation, scenario.content, "ar-EG");
      expect(run.status).toBe("completed");
      expect(c.conversation.travelState?.constraints).toEqual(
        scenario.expectedConstraints,
      );
      sequences.push(
        run.toolExecutions.map((t) => `${t.toolName}:${t.status}`),
      );
    }
    expect(search).toHaveBeenCalledTimes(1);
    expect(adapter.inputs).toHaveLength(11);
    expect(sequences[1]).toEqual([
      "propose_travel_constraints:ok",
      "compare_travel_options:rejected",
      "compare_travel_options:ok",
    ]);
    expect(comparisons).toHaveLength(2);
    const budgetCase = cases[1],
      partyCase = cases[2];
    if (!budgetCase || !partyCase) throw new Error("Missing evaluation case");
    expect(comparisonMatches(comparisons[0], budgetCase)).toBe(true);
    expect(comparisonMatches(comparisons[1], partyCase)).toBe(true);
  });

  it("continues worldwide research when the real catalog repository returns no packages", async () => {
    const transport = { call: vi.fn(async () => []), close: async () => {} };
    const cfg = testConfig({
      ENABLE_TRAVEL_RESEARCH: true,
      TAVILY_API_KEY: "TEST-ONLY",
    });
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        results: [
          {
            url: "https://www.japan.travel/en/",
            title: "TEST ONLY guide",
            content: "TEST ONLY destination evidence",
            score: 0.8,
          },
        ],
      }),
    );
    const adapter = new ScriptedAdapter([
      async () => tool("search_company_packages", { destination: "Kyoto" }),
      async () => tool("research_destination", { destination: "Kyoto" }),
      async () =>
        answer(
          "مفيش باكدجات شركة مطابقة. فيه بحث خارجي: [المصدر](https://www.japan.travel/en/). التوفر مش متحقق.",
        ),
    ]);
    const c = setup(adapter, cfg),
      run = c.state.createRun(c.conversation);
    await new AgentRuntime(
      c.router,
      createTools(
        new PersistentCompanyCatalog(transport),
        new TravelIntelligence(cfg, fetcher),
        true,
      ),
      cfg,
    ).execute(
      run,
      c.conversation,
      "ابحثلي عن Kyoto حتى لو مفيش باكدجات شركة",
      "ar-EG",
      { identity: { ownerId: c.ownerId, token: "TEST-ONLY" } },
    );
    expect(run.status).toBe("completed");
    expect(transport.call).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(run.toolExecutions.map((t) => t.status)).toEqual(["ok", "ok"]);
  });
});
