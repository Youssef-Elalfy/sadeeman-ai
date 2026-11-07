import { describe, expect, it } from "vitest";
import { loadConfig } from "../apps/api/src/config.js";
import { ProviderAdmission } from "../apps/api/src/provider-admission.js";
import { ModelRouter } from "../apps/api/src/providers/router.js";
import { buildServer } from "../apps/api/src/server.js";
import { LocalState } from "../apps/api/src/state.js";
import { answer, ScriptedAdapter, testConfig } from "./helpers.js";

const production = {
  NODE_ENV: "production",
  PERSISTENCE_MODE: "supabase",
  SUPABASE_PROJECT_REF: "ujdzysbowngtkwndgoqf",
  SUPABASE_URL: "https://ujdzysbowngtkwndgoqf.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TEST_ONLY",
  WEB_ORIGIN: "https://sadeeman-ai.vercel.app",
  ENABLE_REAL_PROVIDER: "true",
  ENABLE_SUPABASE_GUEST: "true",
  GEMINI_API_KEY: "TEST_ONLY_GEMINI",
  GEMINI_MODEL: "test-gemini",
  GROQ_API_KEY: "TEST_ONLY_GROQ",
  GROQ_MODEL: "test-groq",
  FALLBACK_PROVIDERS: "groq",
  PROVIDER_RETRIES: "0",
};

describe("production release prerequisites", () => {
  it("keeps the production guard closed without durable auth and HTTPS", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
      "Production guard",
    );
    expect(loadConfig(production).PERSISTENCE_MODE).toBe("supabase");
  });
  it.each([
    { WEB_ORIGIN: "http://localhost:3000" },
    { WEB_ORIGIN: "https://sadeeman-ai.vercel.app/path" },
    { PERSISTENCE_MODE: "local" },
    {
      SUPABASE_PROJECT_REF: "aaaaaaaaaaaaaaaaaaaa",
      SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    },
    { SUPABASE_PUBLISHABLE_KEY: "sb_secret_TEST_ONLY" },
    { ENABLE_REAL_PROVIDER: "false" },
    { ENABLE_SUPABASE_GUEST: "false" },
    { GEMINI_API_KEY: "" },
    { GROQ_MODEL: "CHECK_MODEL" },
    { FALLBACK_PROVIDERS: "groq,openrouter" },
    { ENABLE_OPENROUTER_RUNTIME: "true" },
    { ALLOW_SYNTHETIC_PROVIDER_DATA: "true" },
    { ALLOW_CATALOG_DEMO: "true" },
    { PROVIDER_RETRIES: "1" },
    { ENABLE_TRAVEL_RESEARCH: "true", TAVILY_API_KEY: "" },
  ])("rejects unsafe production configuration %j", (override) => {
    expect(() => loadConfig({ ...production, ...override })).toThrow();
  });
});

describe("bounded public provider admission", () => {
  it("denies concurrent API work before locking a second conversation", async () => {
    const config = testConfig({ MAX_CONCURRENT_PROVIDER_OPERATIONS: 1 });
    const state = new LocalState();
    const session = state.createSession();
    const owner = state.authenticate(`Bearer ${session.token}`);
    const first = state.createConversation(owner),
      second = state.createConversation(owner);
    let finish = () => {};
    const adapter = new ScriptedAdapter([
      async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return answer();
      },
    ]);
    const app = await buildServer({
      config,
      state,
      router: new ModelRouter([adapter], config),
    });
    try {
      const send = (conversationId: string) =>
        app.inject({
          method: "POST",
          url: "/api/v1/agent/messages",
          headers: { authorization: `Bearer ${session.token}` },
          payload: {
            conversationId,
            content: "Synthetic test",
            locale: "ar-EG",
          },
        });
      expect((await send(first.id)).statusCode).toBe(202);
      expect((await send(second.id)).statusCode).toBe(429);
      expect(second.busy).toBe(false);
      expect(adapter.inputs).toHaveLength(1);
    } finally {
      finish();
      await app.close();
    }
  });
  it("caps aggregate requests across identities and does not refund failed calls", () => {
    let now = 0;
    const gate = new ProviderAdmission(
      { agent: 2, voice: 1, guest: 1 },
      1,
      () => now,
    );
    const release = gate.acquire("agent");
    expect(() => gate.acquire("agent")).toThrow("CAPACITY");
    release();
    release();
    gate.acquire("agent")();
    expect(() => gate.acquire("agent")).toThrow("CAPACITY");
    gate.acquire("voice")();
    expect(() => gate.acquire("voice")).toThrow("CAPACITY");
    now = 3_600_000;
    expect(() => gate.acquire("agent")()).not.toThrow();
  });
  it("keeps active work bounded even across an hourly reset", () => {
    let now = 0;
    const gate = new ProviderAdmission(
      { agent: 1, voice: 1, guest: 1 },
      1,
      () => now,
    );
    const release = gate.acquire("voice");
    now = 3_600_001;
    expect(() => gate.acquire("agent")).toThrow("CAPACITY");
    release();
    expect(() => gate.acquire("agent")()).not.toThrow();
  });
});
