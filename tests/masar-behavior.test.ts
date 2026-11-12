import { describe, expect, it, vi } from "vitest";
import { systemPrompt } from "../apps/api/src/agent/prompt.js";
import { AgentRuntime } from "../apps/api/src/agent/runtime.js";
import { replyLanguage, styleIssues } from "../apps/api/src/agent/style.js";
import { TravelIntelligence } from "../apps/api/src/research/travel.js";
import { createTools } from "../apps/api/src/tools/registry.js";
import { emptyTravelState } from "../apps/api/src/travel/context.js";
import { assessTravel } from "../apps/api/src/travel/decision.js";
import { answer, ScriptedAdapter, setup, testConfig, tool } from "./helpers.js";

// Offline only: scripted adapters, no provider or network calls.
async function turn(question: string, script: ScriptedAdapter) {
  const c = setup(script, testConfig({ ENABLE_STYLE_GUARD: true }));
  const run = c.state.createRun(c.conversation);
  await new AgentRuntime(
    c.router,
    createTools(undefined, undefined, true),
    c.config,
  ).execute(run, c.conversation, question, "ar-EG");
  return { run, conversation: c.conversation };
}

describe("MASAR-aligned agent behavior — offline", () => {
  it("prompt is a general-purpose, answer-first assistant with travel expertise", () => {
    const prompt = systemPrompt("ar-EG", true, false, true);
    expect(prompt).toContain("general-purpose AI assistant");
    expect(prompt).toContain("make a reasonable assumption");
    expect(prompt).toContain("programming (with working code");
    expect(prompt).toContain("never say you only handle travel");
    expect(prompt).toContain("masculine singular");
    expect(prompt).not.toMatch(/customer-data processing terms|milestone/);
  });

  it("adds the per-turn reply-language rule from the latest message", () => {
    expect(replyLanguage("What is the difference between TCP and UDP?")).toBe(
      "english",
    );
    expect(replyLanguage("عايز أعرف إزاي أتعلم بايثون بسرعة")).toBe("egyptian");
    expect(systemPrompt("ar-EG", false, false, false, "english")).toContain(
      "answer in English",
    );
  });

  it.each([
    ["coding", "Write a TypeScript function that reverses a string."],
    ["general", "اشرحلي إزاي الطيارة بتطير؟"],
    ["education", "ما هو الفرق بين الخلية النباتية والحيوانية؟"],
  ])(
    "answers %s questions directly in one turn, with no tools",
    async (_k, q) => {
      const reply = q.startsWith("Write")
        ? "Here it is:\n```ts\nconst reverse = (s: string) => [...s].reverse().join('');\n```"
        : q.startsWith("ما")
          ? "الخلية النباتية لها جدار خلوي وبلاستيدات خضراء، أما الحيوانية فلا."
          : "الطيارة بتطير عشان شكل الجناح بيخلي الضغط تحته أعلى من فوقه.";
      const adapter = new ScriptedAdapter([async () => answer(reply)]);
      const { run } = await turn(q, adapter);
      expect(run.status).toBe("completed");
      expect(run.toolExecutions).toEqual([]);
      expect(adapter.inputs).toHaveLength(1);
    },
  );

  it("rewrites once when the reply language does not match the user", async () => {
    const adapter = new ScriptedAdapter([
      async () => answer("Sure, here is a short explanation of recursion."),
      async () =>
        answer("أكيد، الريكيرجن يعني الدالة بتنادي نفسها لحد شرط توقف."),
    ]);
    const { run, conversation } = await turn(
      "اشرحلي يعني إيه recursion في البرمجة",
      adapter,
    );
    expect(run.status).toBe("completed");
    expect(adapter.inputs).toHaveLength(2);
    expect(adapter.inputs[1]?.system).toContain("REWRITE REQUIRED");
    expect(adapter.inputs[1]?.tools).toEqual([]);
    const last = conversation.messages.at(-1);
    expect(last?.role === "assistant" ? last.content : "").toContain("الدالة");
  });

  it("never blocks the answer on a second style miss", async () => {
    const adapter = new ScriptedAdapter([
      async () => answer("Hello, I can explain arrays in programming."),
      async () => answer("Arrays store ordered values in memory slots."),
    ]);
    const { run } = await turn("اشرحلي يعني إيه array في البرمجة", adapter);
    expect(run.status).toBe("completed");
    expect(adapter.inputs).toHaveLength(2);
  });

  it("detects feminine self-reference, pet names and unprompted meta talk", () => {
    expect(
      styleIssues("أنا متأكدة إن ده هيعجبك", "ينفع أسافر الغردقة؟"),
    ).toContain("self_gender");
    expect(styleIssues("أكيد يا حبيبي هنظبطها", "عايز رحلة")).toContain(
      "pet_name",
    );
    expect(
      styleIssues("This is a graduation project demo.", "Plan a trip to Rome"),
    ).toContain("meta_project_mention");
    expect(
      styleIssues("Rome in 3 days: day 1 ...", "Plan a trip to Rome"),
    ).toEqual([]);
  });

  it("acts on an itinerary with only a destination (assumes duration, no question loop)", () => {
    const s = {
      ...emptyTravelState(),
      constraints: { destination: "اليابان" },
    };
    const decision = assessTravel("itinerary", s);
    expect(decision.decision).toBe("ACT");
    expect(decision.guidance).toContain("assume a typical duration");
  });

  it("plans worldwide travel with a real tool round, cited answer and no extra style call", async () => {
    const url = "https://www.japan.travel/en/";
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        results: [
          {
            url,
            title: "TEST ONLY Japan source",
            content: "TEST ONLY public Japan travel guidance.",
            score: 0.9,
          },
        ],
      }),
    );
    const cfg = testConfig({
      ENABLE_STYLE_GUARD: true,
      ENABLE_TRAVEL_RESEARCH: true,
      TAVILY_API_KEY: "TEST ONLY",
      ENABLE_TRAVEL_CONTEXT: true,
    });
    const adapter = new ScriptedAdapter([
      async () => tool("research_destination", { destination: "Japan" }),
      async () =>
        answer(
          `خطة تقديرية لليابان ٧ أيام (افترضت أسبوع، تقدر تعدّلها): طوكيو ثم كيوتو. [المصدر](${url})`,
        ),
    ]);
    const c = setup(adapter, cfg);
    const run = c.state.createRun(c.conversation);
    await new AgentRuntime(
      c.router,
      createTools(undefined, new TravelIntelligence(cfg, fetcher), true),
      cfg,
    ).execute(run, c.conversation, "عايز خطة رحلة لليابان", "ar-EG");
    expect(run.status).toBe("completed");
    expect(run.toolExecutions.map((t) => t.toolName)).toEqual([
      "research_destination",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // One tool round + one answer: the style guard adds no model call on a clean reply.
    expect(adapter.inputs).toHaveLength(2);
    expect(adapter.inputs[0]?.tools.map((t) => t.name)).toContain(
      "build_itinerary",
    );
  });
});
