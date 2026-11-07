import type { TravelConstraints } from "@sadeeman/contracts";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../apps/api/src/agent/runtime.js";
import { createTools } from "../apps/api/src/tools/registry.js";
import {
  emptyTravelState,
  proposeConstraints,
  type TravelTurn,
} from "../apps/api/src/travel/context.js";
import { numberSpans, sourceSpan } from "../apps/api/src/travel/grounding.js";
import { answer, ScriptedAdapter, setup, testConfig, tool } from "./helpers.js";

const opening = "عايز أسافر تركيا 5 أيام، إحنا شخصين وميزانيتنا 30 ألف جنيه.";
function turn(text: string, previous: TravelConstraints = {}): TravelTurn {
  const base = { ...emptyTravelState(), constraints: previous };
  return { base, draft: structuredClone(base), userText: text, dirty: false };
}
function proposal(t: TravelTurn, patch: TravelConstraints, quote = t.userText) {
  return {
    expectedVersion: t.base.version,
    patch,
    evidence: Object.keys(patch).map((field) => ({
      field: field as keyof TravelConstraints,
      quote,
    })),
  };
}
describe("Arabic constraint grounding — offline, no provider calls", () => {
  it.each([
    ["30 ألف", 30000],
    ["٣٠ ألف", 30000],
    ["۳۰ ألف", 30000],
    ["ثلاثين ألف", 30000],
    ["تلاتين ألف", 30000],
    ["خمسة وعشرين ألف", 25000],
    ["خمسةوعشرين ألف", 25000],
    ["ثلاثة آلاف", 3000],
    ["ألفين", 2000],
    ["ألفين وخمسمية", 2500],
    ["مليون ومئتين ألف", 1200000],
    ["1.5 ألف", 1500],
    ["١٫٥ ألف", 1500],
    ["٣٠٬٠٠٠", 30000],
    ["30,000", 30000],
    ["معايا عشرين ألف", 20000],
    ["في حدود عشرين ألف", 20000],
    ["ميزانيتي ألفين", 2000],
    ["ألفين و خمسمية", 2500],
    ["ثلاثة عشر ألف", 13000],
    ["0 ألف", 0],
  ])("normalizes %s into %i major units", (text, amount) => {
    const t = turn(text, { currency: "EGP" });
    const result = proposeConstraints(
      proposal(t, { budgetMinor: Number(amount) * 100 }),
      t,
    );
    expect(t.draft.constraints.budgetMinor).toBe(Number(amount) * 100);
    expect(result.grounding[0]).toMatchObject({
      source: "current_user",
      quote: text,
      normalizedValue: Number(amount) * 100,
      start: 0,
      end: String(text).length,
    });
  });
  it.each([
    ["شخصين", "travellers", 2],
    ["شخصان", "travellers", 2],
    ["فردين", "travellers", 2],
    ["اتنين", "travellers", 2],
    ["ثلاثة أشخاص", "travellers", 3],
    ["٣ مسافرين", "travellers", 3],
    ["يومين", "days", 2],
    ["خمسة أيام", "days", 5],
    ["٥ أيام", "days", 5],
    ["بالغين اتنين", "adults", 2],
  ])("grounds %s in its own dimension", (text, field, value) => {
    const t = turn(String(text));
    proposeConstraints(proposal(t, { [field]: value }), t);
    expect(t.draft.constraints).toEqual({ [field]: value });
  });
  it.each([
    ["EGP", "EGP"],
    ["جنيه مصري", "EGP"],
    ["USD", "USD"],
    ["دولار أمريكي", "USD"],
    ["يورو", "EUR"],
  ])("grounds explicit currency %s", (quote, currency) => {
    const t = turn(quote);
    proposeConstraints(proposal(t, { currency }), t);
    expect(t.draft.constraints.currency).toBe(currency);
  });
  it.each(["جنيه", "دولار"])(
    "preserves ambiguity for %s, without inferring from locale",
    async (quote) => {
      const t = turn(quote);
      const registry = createTools(undefined, undefined, true);
      const response = await registry.execute(
        {
          id: "test",
          name: "propose_travel_constraints",
          arguments: proposal(t, {
            currency: quote === "جنيه" ? "EGP" : "USD",
          }),
        },
        {
          ownerId: "TEST",
          conversationId: "TEST",
          travel: t,
          signal: new AbortController().signal,
        },
      );
      expect(response).toMatchObject({
        status: "rejected",
        data: {
          reason: "CURRENCY_AMBIGUOUS",
          fields: ["currency"],
          correction: expect.stringContaining("Ask"),
        },
      });
      expect(t.draft).toEqual(t.base);
    },
  );
  it("accepts grounded Egyptian context or confirmed currency, not nationality/dialect guesses", () => {
    for (const text of [
      "إحنا من مصر وميزانيتنا 30 ألف جنيه",
      "أنا في مصر ومعايا 30 ألف جنيه",
    ]) {
      const t = turn(text);
      proposeConstraints(
        proposal(t, { currency: "EGP", budgetMinor: 3000000 }),
        t,
      );
      expect(t.draft.constraints.currency).toBe("EGP");
    }
    const t = turn("معايا 30 ألف جنيه", { currency: "EGP" });
    proposeConstraints(proposal(t, { budgetMinor: 3000000 }), t);
    expect(t.draft.constraints.budgetMinor).toBe(3000000);
    const usd = turn("دولار", { currency: "USD" });
    proposeConstraints(proposal(usd, { currency: "USD" }), usd);
  });
  it("preserves exact source spans across digit normalization and diacritics", () => {
    const text = "عايز ٥ أيام بس",
      t = turn(text);
    const r = proposeConstraints(proposal(t, { days: 5 }, "5 أيام"), t);
    expect(r.grounding[0]).toMatchObject({
      quote: "٥ أيام",
      start: 5,
      end: 11,
      normalizedValue: 5,
    });
    expect(sourceSpan("خَمْسة أيام", "خمسة أيام")?.quote).toBe("خَمْسة أيام");
  });
  it.each([
    ["5 أيام و3 أشخاص", { travellers: 5 }],
    ["5 أيام و3 أشخاص", { days: 3 }],
    ["30 ألف", { budgetMinor: 3000 }],
    ["أقل", { budgetMinor: 2000000 }],
    ["نفس المدة", { days: 7 }],
    ["نفس العدد", { travellers: 5 }],
    ["بدل 30 ألف خلي 20 ألف", { budgetMinor: 3000000 }],
    ["مش شخصين", { travellers: 2 }],
    ["2027-01-10", { days: 10 }],
    ["3 دولار", { travellers: 3 }],
    ["معايا 300 USD", { budgetMinor: 30000 }],
    ["جنيه سوداني", { currency: "EGP" }],
    ["دولار كندي", { currency: "USD" }],
    ["ميزانيتي 3000", { budgetBasis: "party_total" }],
  ] as [string, TravelConstraints][])(
    "rejects unsupported or cross-field values in %s",
    (text, patch) => {
      const t = turn(text, {
        currency: patch.currency === "EGP" ? "USD" : "EGP",
        travellers: 4,
      });
      expect(() => proposeConstraints(proposal(t, patch), t)).toThrow();
      expect(t.draft).toEqual(t.base);
    },
  );
  it("grounds replacement amounts and preserves same-duration references without reset", () => {
    const t = turn("بدل 30 ألف خلي 20 ألف، نفس المدة ونفس العدد", {
      currency: "EGP",
      budgetMinor: 3000000,
      days: 5,
      travellers: 2,
    });
    const result = proposeConstraints(
      proposal(t, { budgetMinor: 2000000, days: 5, travellers: 2 }),
      t,
    );
    expect(t.draft.constraints).toEqual({
      ...t.base.constraints,
      budgetMinor: 2000000,
    });
    expect(
      result.grounding.filter((g) => g.source === "confirmed_context"),
    ).toHaveLength(2);
  });
  it("replays the exact failed conversation through the real agent loop with confirmed currency, dates, and one correction", async () => {
    const patch1: TravelConstraints = {
      destination: "تركيا",
      days: 5,
      travellers: 2,
      currency: "EGP",
      budgetMinor: 3000000,
      budgetBasis: "party_total",
    };
    const first = turn(opening, { currency: "EGP" });
    const adapter = new ScriptedAdapter([
      async () =>
        tool(
          "propose_travel_constraints",
          proposal(first, { ...patch1, budgetMinor: 3000 }),
        ),
      async (input) => {
        expect(input.messages.at(-1)).toMatchObject({
          role: "tool",
          result: {
            data: {
              reason: "CONSTRAINT_VALUE_NOT_EXPLICIT",
              fields: ["budgetMinor"],
            },
          },
        });
        return tool("propose_travel_constraints", proposal(first, patch1));
      },
      async () =>
        answer(
          "تركيا خمسة أيام لشخصين، ميزانيتنا 30 ألف جنيه مصري، الأسعار محتاجة تحقق.",
        ),
      async () =>
        tool("propose_travel_constraints", {
          expectedVersion: 2,
          patch: { budgetMinor: 2000000 },
          evidence: [{ field: "budgetMinor", quote: "20 ألف" }],
        }),
      async () => answer("تمام 20 ألف ونفس المدة والعدد."),
      async () =>
        tool("propose_travel_constraints", {
          expectedVersion: 3,
          patch: { travellers: 3 },
          evidence: [{ field: "travellers", quote: "3 أشخاص" }],
        }),
      async () =>
        answer(
          "بقينا ثلاثة، الميزانية الإجمالية لسه 20 ألف. مفيش أسعار أو حجز مؤكد.",
        ),
    ]);
    const c = setup(adapter, testConfig());
    c.conversation.travelState = {
      ...emptyTravelState(),
      version: 1,
      constraints: {
        currency: "EGP",
        startsOn: "2027-01-10",
        endsOn: "2027-01-14",
      },
    };
    first.base.version = 1;
    const runtime = new AgentRuntime(
      c.router,
      createTools(undefined, undefined, true),
      c.config,
    );
    for (const text of [
      opening,
      "طب خلي الميزانية 20 ألف، بس نفس المدة وعدد الأشخاص.",
      "طب لو بقينا 3 أشخاص؟",
    ]) {
      const run = c.state.createRun(c.conversation);
      await runtime.execute(run, c.conversation, text, "ar-EG");
      expect(run.status).toBe("completed");
    }
    expect(c.conversation.travelState?.constraints).toEqual({
      ...patch1,
      travellers: 3,
      budgetMinor: 2000000,
      startsOn: "2027-01-10",
      endsOn: "2027-01-14",
    });
    expect(adapter.inputs).toHaveLength(7);
  });
  it("rejects malicious extra fields, invented quotes and values outside numeric bounds", () => {
    const t = turn("3 أشخاص");
    const malicious = {
      ...proposal(t, { travellers: 3 }),
      patch: { travellers: 3, admin: true },
    };
    expect(() => proposeConstraints(malicious, t)).toThrow();
    expect(() =>
      proposeConstraints(proposal(t, { travellers: 3 }, "موافقة 3"), t),
    ).toThrow("CURRENT_USER_EVIDENCE_REQUIRED");
    expect(() =>
      proposeConstraints(proposal(t, { travellers: 101 }), t),
    ).toThrow();
    expect(() =>
      proposeConstraints(proposal(t, { budgetMinor: 1e13 }), t),
    ).toThrow();
    expect(numberSpans("ألفين ألف")).toEqual([]);
  });
  it.each([
    ["30 ألف", "30", { budgetMinor: 3000 }],
    ["30 ألف", "3", { travellers: 3 }],
    ["300000 قرش", "300000 قرش", { budgetMinor: 30000000 }],
    ["-30 ألف", "30 ألف", { budgetMinor: 3000000 }],
    ["30%", "30", { budgetMinor: 3000 }],
    ["بدل 30 ألف خلي 20 ألف", "30 ألف", { budgetMinor: 3000000 }],
    ["مش 3 أشخاص، إحنا اتنين", "3 أشخاص", { travellers: 3 }],
    ["مش شخصين", "شخصين", { travellers: 2 }],
    ["3 أشخاص و2 أطفال", "2 أطفال", { travellers: 2 }],
    ["جنيه سوداني", "جنيه", { currency: "EGP", budgetMinor: 100 }],
  ] as [string, string, TravelConstraints][])(
    "cannot strip units or qualifications from %s",
    (text, quote, patch) => {
      const t = turn(text, { currency: "USD" });
      expect(() => proposeConstraints(proposal(t, patch, quote), t)).toThrow();
      expect(t.draft).toEqual(t.base);
    },
  );
  it("does not convert a minor-unit quote into major units", () => {
    const t = turn("معايا 300000 قرش", { currency: "EGP" });
    proposeConstraints(proposal(t, { budgetMinor: 300000 }), t);
    expect(t.draft.constraints.budgetMinor).toBe(300000);
  });
  it("asks for currency clarification in the exact opening when no currency is confirmed", async () => {
    const t = turn(opening),
      registry = createTools(undefined, undefined, true);
    const r = await registry.execute(
      {
        id: "clarify",
        name: "propose_travel_constraints",
        arguments: proposal(t, { currency: "EGP" }),
      },
      {
        ownerId: "TEST",
        conversationId: "TEST",
        travel: t,
        signal: new AbortController().signal,
      },
    );
    expect(r).toMatchObject({
      status: "rejected",
      data: { reason: "CURRENCY_AMBIGUOUS", fields: ["currency"] },
    });
    expect(t.draft.constraints).toEqual({});
  });
});
