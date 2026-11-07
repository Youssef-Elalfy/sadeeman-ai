import { describe, expect, it } from "vitest";
import {
  emptyTravelState,
  proposeConstraints,
  type TravelTurn,
} from "../apps/api/src/travel/context.js";

/**
 * Owner's mandatory multi-turn scenario, driven with the *failure-prone*
 * proposals a live model actually produced (guessed adults, evidence-less
 * budget basis, unchanged fields re-sent with vague quotes). Deterministic and
 * offline: this proves the merge/grounding protocol, not live language quality.
 */
const T1 = "عايز أسافر تركيا 5 أيام، إحنا شخصين وميزانيتنا 30 ألف جنيه.";
const T2 = "طب خلي الميزانية 20 ألف، بس نفس المدة وعدد الأشخاص.";
const T3 = "طب لو بقينا 3 أشخاص؟";

function nextTurn(
  committed: TravelTurn["base"],
  userText: string,
  previousUserText?: string,
): TravelTurn {
  return {
    base: structuredClone(committed),
    draft: structuredClone(committed),
    dirty: false,
    userText,
    ...(previousUserText ? { previousUserText } : {}),
  };
}
/** Mirrors the runtime's commit: version+1 only when the draft changed. */
function commit(turn: TravelTurn): TravelTurn["base"] {
  return turn.dirty
    ? { ...turn.draft, version: turn.base.version + 1 }
    : turn.base;
}

describe("M3 three-turn scenario — Turkey, 5 days, 2→3 people, 30k→20k EGP", () => {
  it("keeps context, applies only the stated changes, never invents the party split", () => {
    let state: TravelTurn["base"] = {
      ...emptyTravelState(),
      constraints: { currency: "EGP" },
    };

    // T1 — the live failure shape: adults guessed from "شخصين", basis w/o evidence.
    const t1 = nextTurn(state, T1);
    const r1 = proposeConstraints(
      {
        expectedVersion: state.version,
        patch: {
          destination: "تركيا",
          days: 5,
          travellers: 2,
          adults: 2,
          budgetMinor: 3000000,
          budgetBasis: "party_total",
        },
        evidence: [
          { field: "destination", quote: "تركيا" },
          { field: "days", quote: "5 أيام" },
          { field: "travellers", quote: "شخصين" },
          { field: "adults", quote: "شخصين" },
          { field: "budgetMinor", quote: "30 ألف جنيه" },
        ],
      },
      t1,
    );
    state = commit(t1);
    expect(state.constraints).toMatchObject({
      destination: "تركيا",
      days: 5,
      travellers: 2,
      budgetMinor: 3000000,
      currency: "EGP",
    });
    expect(state.constraints.adults).toBeUndefined();
    expect(state.constraints.children).toBeUndefined();
    expect(state.constraints.budgetBasis).toBeUndefined();
    expect(r1).toMatchObject({
      droppedFields: expect.arrayContaining([
        expect.objectContaining({ field: "adults" }),
        expect.objectContaining({ field: "budgetBasis" }),
      ]),
    });

    // T2 — new budget; unchanged days/travellers re-sent with vague quotes.
    const t2 = nextTurn(state, T2, T1);
    proposeConstraints(
      {
        expectedVersion: state.version,
        patch: { budgetMinor: 2000000, days: 5, travellers: 2 },
        evidence: [
          { field: "budgetMinor", quote: "20 ألف" },
          { field: "days", quote: "نفس المدة" },
          { field: "travellers", quote: "عدد الأشخاص" },
        ],
      },
      t2,
    );
    state = commit(t2);
    expect(state.constraints).toMatchObject({
      destination: "تركيا",
      days: 5,
      travellers: 2,
      budgetMinor: 2000000,
      currency: "EGP",
    });
    expect(state.constraints.adults).toBeUndefined();

    // T3 — only the head-count changes.
    const t3 = nextTurn(state, T3, T2);
    proposeConstraints(
      {
        expectedVersion: state.version,
        patch: { travellers: 3 },
        evidence: [{ field: "travellers", quote: "3 أشخاص" }],
      },
      t3,
    );
    state = commit(t3);
    expect(state.constraints).toEqual({
      destination: "تركيا",
      days: 5,
      travellers: 3,
      budgetMinor: 2000000,
      currency: "EGP",
    });
    expect(state.budgetBasisConfidence).not.toBe("confirmed");
  });

  it("clears a stale adult/child split when the head-count changes", () => {
    const state = {
      ...emptyTravelState(),
      version: 3,
      constraints: { destination: "تركيا", travellers: 2, adults: 2 },
    };
    const t = nextTurn(state, T3);
    const result = proposeConstraints(
      {
        expectedVersion: 3,
        patch: { travellers: 3 },
        evidence: [{ field: "travellers", quote: "3 أشخاص" }],
      },
      t,
    );
    expect(t.draft.constraints).toEqual({
      destination: "تركيا",
      travellers: 3,
    });
    expect(result).toMatchObject({ clearedFields: ["adults"] });
  });

  it("still rejects an ungrounded CORE field — validation is not weakened", () => {
    const state = { ...emptyTravelState(), constraints: { currency: "EGP" } };
    const t = nextTurn(state, T1);
    expect(() =>
      proposeConstraints(
        {
          expectedVersion: state.version,
          patch: { days: 7, adults: 2 },
          evidence: [
            { field: "days", quote: "5 أيام" },
            { field: "adults", quote: "شخصين" },
          ],
        },
        t,
      ),
    ).toThrow();
    expect(t.draft).toEqual(t.base);
  });

  it("rejects a proposal made only of an ungrounded optional field", () => {
    const state = {
      ...emptyTravelState(),
      constraints: { travellers: 2 },
    };
    const t = nextTurn(state, T1);
    expect(() =>
      proposeConstraints(
        {
          expectedVersion: state.version,
          patch: { adults: 2 },
          evidence: [{ field: "adults", quote: "شخصين" }],
        },
        t,
      ),
    ).toThrow();
    expect(t.draft).toEqual(t.base);
  });
});
