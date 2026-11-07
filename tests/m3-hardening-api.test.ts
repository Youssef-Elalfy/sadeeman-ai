import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../apps/api/src/config.js";
import { createLocalDatabase } from "../apps/api/src/persistence/local.js";
import { Repository } from "../apps/api/src/persistence/repository.js";
import { SupabaseDatabase } from "../apps/api/src/persistence/supabase.js";
import { CompatibleAdapter } from "../apps/api/src/providers/compatible.js";
import { GeminiAdapter } from "../apps/api/src/providers/gemini.js";
import { ModelRouter } from "../apps/api/src/providers/router.js";
import type { ModelInput } from "../apps/api/src/providers/types.js";
import { buildServer } from "../apps/api/src/server.js";
import { LocalState } from "../apps/api/src/state.js";
import { answer, ScriptedAdapter, testConfig, tool } from "./helpers.js";

const input: ModelInput = {
  system: "TEST ONLY",
  messages: [],
  tools: [],
  maxOutputTokens: 64,
};
describe("M3 hardening integration — no network", () => {
  it.each([
    ["catalog_search", "sadeeman_catalog", "search"],
    ["catalog_get", "sadeeman_catalog", "get"],
    ["travel_profile_get", "sadeeman_travel_profile", "get"],
    ["commit_travel_turn", "sadeeman_commit_travel_turn", null],
  ] as const)(
    "serializes %s through its scoped hosted RPC with the user's JWT (mock only)",
    async (action, rpc, operation) => {
      const ref = "a".repeat(20),
        config = testConfig({
          PERSISTENCE_MODE: "supabase",
          SUPABASE_PROJECT_REF: ref,
          SUPABASE_URL: `https://${ref}.supabase.co`,
          SUPABASE_PUBLISHABLE_KEY: "sb_publishable_TEST_ONLY",
        });
      const fetcher: typeof fetch = async (url, options) => {
        expect(String(url)).toBe(`${config.SUPABASE_URL}/rest/v1/rpc/${rpc}`);
        expect(new Headers(options?.headers).get("authorization")).toBe(
          "Bearer TEST_ONLY_TOKEN",
        );
        expect(JSON.parse(String(options?.body))).toEqual({
          ...(operation ? { p_action: operation } : {}),
          p_payload: { conversationId: "TEST_ONLY" },
        });
        return Response.json(null);
      };
      await new SupabaseDatabase(config, fetcher).call(
        { ownerId: randomUUID(), token: "TEST_ONLY_TOKEN" },
        action,
        { conversationId: "TEST_ONLY" },
      );
    },
  );
  it.each([false, true])(
    "captures actual Gemini adapter quota provenance (stream=%s) without raw SDK errors",
    async (stream) => {
      const fail = async () => {
        throw {
          status: 429,
          message: "TEST_SECRET_BODY",
          headers: { authorization: "TEST_SECRET_HEADER" },
        };
      };
      const adapter = new GeminiAdapter(
        "TEST_ONLY_KEY",
        "TEST_GEMINI_MODEL",
        1000,
        { generateContent: fail, generateContentStream: fail },
      );
      try {
        await adapter.generate(
          input,
          new AbortController().signal,
          stream ? () => {} : undefined,
        );
        throw new Error("Expected quota");
      } catch (error) {
        expect(error).toMatchObject({
          code: "PROVIDER_QUOTA",
          providerFailure: {
            provider: "gemini",
            model: "TEST_GEMINI_MODEL",
            operation: stream ? "generate_stream" : "generate",
            upstreamStatus: 429,
            quotaScope: "unknown",
          },
        });
        expect(JSON.stringify(error)).not.toContain("TEST_SECRET");
      }
    },
  );
  it.each([false, true])(
    "captures actual Groq adapter quota provenance (stream=%s) without response body or headers",
    async (stream) => {
      const adapter = new CompatibleAdapter(
        "groq",
        "TEST_ONLY_KEY",
        "TEST_GROQ_MODEL",
        async () =>
          new Response("TEST_SECRET_BODY", {
            status: 429,
            headers: { "x-private": "TEST_SECRET_HEADER" },
          }),
      );
      try {
        await adapter.generate(
          input,
          new AbortController().signal,
          stream ? () => {} : undefined,
        );
        throw new Error("Expected quota");
      } catch (error) {
        expect(error).toMatchObject({
          code: "PROVIDER_QUOTA",
          providerFailure: {
            provider: "groq",
            model: "TEST_GROQ_MODEL",
            operation: stream ? "generate_stream" : "generate",
            upstreamStatus: 429,
            quotaScope: "unknown",
          },
        });
        expect(JSON.stringify(error)).not.toContain("TEST_SECRET");
      }
    },
  );
  it("wires strict context staging, atomic database commit and state restoration through the API", async () => {
    const db = await createLocalDatabase(undefined, { includeProposed: true }),
      config = testConfig({
        PERSISTENCE_MODE: "local",
        ENABLE_TRAVEL_CONTEXT: true,
        ENABLE_TRAVEL_CONTEXT_PERSISTENCE: true,
        ENABLE_COMPANY_CATALOG: true,
      });
    const session = await db.guest(),
      identity = await db.authenticate(`Bearer ${session.token}`),
      repo = new Repository(db, identity),
      conversation = await repo.createConversation();
    const adapter = new ScriptedAdapter([
      async () =>
        tool("propose_travel_constraints", {
          expectedVersion: 0,
          patch: { destination: "Italy", days: 5, travellers: 2 },
          evidence: [
            { field: "destination", quote: "Italy" },
            { field: "days", quote: "5" },
            { field: "travellers", quote: "2" },
          ],
        }),
      async () => tool("search_company_packages", {}),
      async () =>
        answer(
          "مفيش برامج منشورة في قاعدة الاختبار. محتاجين بيانات برامج معتمدة.",
        ),
      async (input) => {
        expect(input.system).toContain('"travellers":2');
        expect(input.system).toContain('"days":5');
        return tool("propose_travel_constraints", {
          expectedVersion: 1,
          patch: { days: 7 },
          evidence: [{ field: "days", quote: "7" }],
        });
      },
      async () => answer("تمام، 7 أيام وباقي التفاصيل زي ما هي."),
    ]);
    const state = new LocalState(),
      router = new ModelRouter([adapter], config),
      app = await buildServer({
        config,
        router,
        state,
        persistence: { mode: "local", auth: db, transport: db },
      });
    const headers = { authorization: `Bearer ${session.token}` };
    const runTurn = async (content: string) => {
      const accepted = await app.inject({
        method: "POST",
        url: "/api/v1/agent/messages",
        headers,
        payload: {
          conversationId: conversation.id,
          content,
          locale: "ar-EG",
          clientRequestId: randomUUID(),
        },
      });
      expect(accepted.statusCode).toBe(202);
      const stream = await app.inject({
        url: `/api/v1/agent/events/${accepted.json().runId}`,
        headers,
      });
      expect(stream.body).toContain("response_completed");
      return app.inject({
        url: `/api/v1/agent/runs/${accepted.json().runId}`,
        headers,
      });
    };
    try {
      expect(
        (await runTurn("Italy 5 أيام 2 مسافرين")).json().travelContext
          .committed,
      ).toBe(true);
      expect(await repo.travelState(conversation.id)).toMatchObject({
        version: 1,
        constraints: { destination: "Italy", days: 5, travellers: 2 },
      });
      // Clear in-memory conversations to prove the next request restores structured state from SQL.
      state.close();
      await runTurn("خليهم 7 أيام");
      expect(await repo.travelState(conversation.id)).toMatchObject({
        version: 2,
        constraints: { destination: "Italy", days: 7, travellers: 2 },
      });
      const second = await db.guest();
      expect(
        (
          await app.inject({
            url: `/api/v1/conversations/${conversation.id}`,
            headers: { authorization: `Bearer ${second.token}` },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  }, 30000);
  it("refuses demo access in ordinary development", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "development", ALLOW_CATALOG_DEMO: "true" }),
    ).toThrow("NODE_ENV=test");
  });
});
