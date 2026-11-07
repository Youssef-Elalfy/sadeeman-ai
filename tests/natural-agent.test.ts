import { readFile } from "node:fs/promises";
import { TravelState } from "@sadeeman/contracts";
import { describe, expect, it } from "vitest";
import { systemPrompt } from "../apps/api/src/agent/prompt.js";
import { AgentRuntime } from "../apps/api/src/agent/runtime.js";
import { createTools } from "../apps/api/src/tools/registry.js";
import {
  emptyTravelState,
  proposeConstraints,
} from "../apps/api/src/travel/context.js";
import { assessTravel } from "../apps/api/src/travel/decision.js";
import { answer, ScriptedAdapter, setup, testConfig, tool } from "./helpers.js";

const text = "عايز أسافر تركيا 5 أيام، إحنا شخصين وميزانيتنا 30 ألف جنيه.";
describe("natural ASK ACT ANSWER — offline only", () => {
  it("is a general assistant: answers off-topic questions, never CRM", () => {
    const prompt = systemPrompt("ar-EG", true, false, true);
    expect(prompt).toContain("Answer off-topic questions fully");
    expect(prompt).not.toMatch(/CRM|prepare_customer_request/);
  });
  it.each([
    "اشرحلي يعني إيه الذكاء الاصطناعي.",
    "ساعدني أتعلم إنجليزي.",
    "إيه الفرق بين React وNext.js؟",
  ])(
    "completes a general question with a plain answer and no tools: %s",
    async (question) => {
      const adapter = new ScriptedAdapter([
        async () => answer("TEST ONLY scripted general answer"),
      ]);
      const c = setup(adapter, testConfig());
      const run = c.state.createRun(c.conversation);
      await new AgentRuntime(
        c.router,
        createTools(undefined, undefined, true),
        c.config,
      ).execute(run, c.conversation, question, "ar-EG");
      expect(run.status).toBe("completed");
      expect(run.toolExecutions).toEqual([]);
      expect(adapter.inputs[0]?.system).toContain(
        "Answer off-topic questions fully",
      );
    },
  );
  it("has no customer/CRM tool: the assistant cannot create records or contact anyone", () => {
    const registry = createTools(undefined, undefined, true);
    const names = registry.definitions().map((d) => d.name);
    expect(names).not.toContain("prepare_customer_request");
    expect(names.some((n) => /crm|lead|customer|handoff/i.test(n))).toBe(false);
  });
  it("cannot upgrade shared intent with invented confirmation evidence", () => {
    const base = TravelState.parse({
      version: 1,
      options: [],
      constraints: { budgetBasis: "party_total" },
      budgetBasisConfidence: "shared_intent",
    });
    const travel = {
      base,
      draft: structuredClone(base),
      dirty: false,
      userText: "تمام",
    };
    expect(() =>
      proposeConstraints(
        {
          expectedVersion: 1,
          patch: { budgetBasis: "party_total" },
          evidence: [{ field: "budgetBasis", quote: "total" }],
        },
        travel,
      ),
    ).toThrow("CURRENT_USER_EVIDENCE_REQUIRED");
    expect(travel.draft).toEqual(base);
  });
  it.each(["research", "itinerary"] as const)(
    "acts on %s without adult breakdown or flight scope",
    (action) => {
      const s = {
        ...emptyTravelState(),
        constraints: { destination: "تركيا", days: 5, travellers: 2 },
      };
      expect(assessTravel(action, s)).toMatchObject({
        decision: "ACT",
        missingFields: [],
        optionalUnknowns: ["adults", "children", "budgetIncludesFlights"],
      });
    },
  );
  it("asks only the material next question and does not repeat it", () => {
    const s = emptyTravelState();
    const first = assessTravel("itinerary", s);
    expect(first).toMatchObject({
      decision: "ASK",
      missingFields: ["destination", "days"],
      suggestedQuestion: "حابب تسافر فين؟",
    });
    expect(assessTravel("itinerary", s, first.suggestedQuestion)).toMatchObject(
      { decision: "ANSWER", alreadyAsked: true },
    );
  });
  it("requires strong financial basis and flights only for budget-dependent recommendations", () => {
    const s = TravelState.parse({
      version: 1,
      constraints: {
        destination: "تركيا",
        days: 5,
        currency: "EGP",
        budgetMinor: 3000000,
        travellers: 2,
        budgetBasis: "party_total",
      },
      options: [],
      budgetBasisConfidence: "shared_intent",
    });
    expect(assessTravel("itinerary", s).decision).toBe("ACT");
    expect(assessTravel("budget_comparison", s).missingFields).toContain(
      "budgetBasis",
    );
    const confirmed = { ...s, budgetBasisConfidence: "confirmed" as const };
    expect(assessTravel("budget_comparison", confirmed).decision).toBe("ACT");
    expect(
      assessTravel("budget_recommendation", confirmed).missingFields,
    ).toEqual(["budgetIncludesFlights"]);
  });
  // Real live failure (2026-11-05): Gemini guessed adults=2 from "شخصين" and
  // gave budgetBasis without evidence, so strict validation discarded every
  // fact. Now only the ungrounded optional fields are dropped (left unknown) and
  // the grounded core facts survive on the FIRST proposal — no invention.
  it("replays real Gemini failure: keeps grounded core facts, drops guessed optional fields", async () => {
    const raw = JSON.parse(
      await readFile(
        "docs/reports/M3_ARABIC_LIVE_RECHECK_8b235d30-a40a-474f-a069-56707348fbde.json",
        "utf8",
      ),
    ) as { observed: { constraintProposal: Record<string, unknown> }[] };
    const bad = raw.observed[0]?.constraintProposal;
    if (!bad) throw Error("Missing real trace");
    const adapter = new ScriptedAdapter([
      async () => tool("propose_travel_constraints", bad),
      async (input) => {
        expect(input.messages.at(-1)).toMatchObject({
          role: "tool",
          result: { status: "ok" },
        });
        const result = JSON.stringify(input.messages.at(-1));
        expect(result).toContain("droppedFields");
        expect(result).toContain("adults");
        return answer(
          "نقدر نبدأ خطة خمس أيام؛ تفاصيل الأعمار مش لازمة للخطة المبدئية.",
        );
      },
    ]);
    const c = setup(adapter, testConfig());
    c.conversation.travelState = {
      version: 1,
      constraints: { currency: "EGP" },
      options: [],
    };
    const run = c.state.createRun(c.conversation);
    await new AgentRuntime(
      c.router,
      createTools(undefined, undefined, true),
      c.config,
    ).execute(run, c.conversation, text, "ar-EG");
    expect(run.status).toBe("completed");
    expect(run.toolExecutions.map((t) => t.status)).toEqual(["ok"]);
    expect(c.conversation.travelState).toMatchObject({
      constraints: { days: 5, travellers: 2, budgetMinor: 3000000 },
    });
    expect(c.conversation.travelState?.constraints.adults).toBeUndefined();
    expect(c.conversation.travelState?.constraints.children).toBeUndefined();
    expect(c.conversation.travelState?.budgetBasisConfidence).not.toBe(
      "confirmed",
    );
  });
  it("clarifies currency then grounds previously unknown amount from the actual previous user turn", () => {
    const base = {
      version: 1,
      constraints: { destination: "تركيا", days: 5, travellers: 2 },
      options: [],
    };
    const t = {
      base,
      draft: structuredClone(base),
      dirty: false,
      userText: "EGP",
      previousUserText: text,
    };
    proposeConstraints(
      {
        expectedVersion: 1,
        patch: { currency: "EGP", budgetMinor: 3000000 },
        evidence: [
          { field: "currency", quote: "EGP" },
          {
            field: "budgetMinor",
            quote: "30 ألف جنيه",
            source: "previous_user",
          },
        ],
      },
      t,
    );
    expect(t.draft.constraints).toMatchObject({
      budgetMinor: 3000000,
      currency: "EGP",
    });
    const next = {
      base: structuredClone(t.draft),
      draft: structuredClone(t.draft),
      dirty: false,
      userText: "تمام",
      previousUserText: "معايا 20 ألف",
    };
    expect(() =>
      proposeConstraints(
        {
          expectedVersion: 1,
          patch: { budgetMinor: 2000000 },
          evidence: [
            { field: "budgetMinor", quote: "20 ألف", source: "previous_user" },
          ],
        },
        next,
      ),
    ).toThrow("CURRENT_USER_EVIDENCE_REQUIRED");
  });
  it("records explicit ages and flight inclusions without assuming unmentioned details", () => {
    const base = emptyTravelState();
    const t = {
      base,
      draft: structuredClone(base),
      dirty: false,
      userText: "بالغ وطفل، الميزانية مش شاملة الطيران",
    };
    proposeConstraints(
      {
        expectedVersion: 0,
        patch: { adults: 1, children: 1, budgetIncludesFlights: false },
        evidence: [
          { field: "adults", quote: "بالغ" },
          { field: "children", quote: "طفل" },
          { field: "budgetIncludesFlights", quote: "مش شاملة الطيران" },
        ],
      },
      t,
    );
    expect(t.draft.constraints).toEqual({
      adults: 1,
      children: 1,
      budgetIncludesFlights: false,
    });
  });
  it("cannot execute a third correction when the model ignores answer-only mode", async () => {
    const bad = () =>
      Promise.resolve(
        tool("propose_travel_constraints", {
          expectedVersion: 0,
          patch: { travellers: 8 },
          evidence: [],
        }),
      );
    const a = new ScriptedAdapter([bad, bad, bad]);
    const c = setup(a),
      run = c.state.createRun(c.conversation);
    await new AgentRuntime(
      c.router,
      createTools(undefined, undefined, true),
      c.config,
    ).execute(run, c.conversation, "شخصين", "ar-EG");
    expect(a.inputs[2]?.tools).toEqual([]);
    expect(run.toolExecutions).toHaveLength(2);
    expect(run.status).toBe("failed");
    expect(c.conversation.travelState).toBeUndefined();
  });
  it("keeps unrelated discussion and naturally returns to confirmed travel context", async () => {
    const a = new ScriptedAdapter([
      async () => answer("الناتج أربعة."),
      async (input) => {
        expect(input.system).toContain('"days":5');
        return answer("نكمل رحلة تركيا الخمسة أيام.");
      },
    ]);
    const c = setup(a);
    c.conversation.travelState = {
      version: 1,
      constraints: { destination: "تركيا", days: 5 },
      options: [],
    };
    const runtime = new AgentRuntime(
      c.router,
      createTools(undefined, undefined, true),
      c.config,
    );
    for (const question of ["اتنين زائد اتنين؟", "نرجع للرحلة"]) {
      const r = c.state.createRun(c.conversation);
      await runtime.execute(r, c.conversation, question, "ar-EG");
      expect(r.status).toBe("completed");
    }
    expect(c.conversation.messages).toHaveLength(4);
    expect(c.conversation.travelState.version).toBe(1);
  });
  it("never exposes diagnostic output to a customer even if generated as streaming text", async () => {
    const a = new ScriptedAdapter([
      async () => answer("CONSTRAINT_CONFLICT: budgetBasis"),
    ]);
    const c = setup(a),
      r = c.state.createRun(c.conversation);
    await new AgentRuntime(
      c.router,
      createTools(undefined, undefined, true),
      c.config,
    ).execute(r, c.conversation, "أهلا", "ar-EG");
    expect(r.status).toBe("failed");
    expect(r.events.some((e) => e.textDelta?.includes("budgetBasis"))).toBe(
      false,
    );
  });
});
