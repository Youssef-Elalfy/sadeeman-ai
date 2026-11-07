import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../apps/api/src/config.js";
import { ModelRouter } from "../apps/api/src/providers/router.js";
import { buildServer } from "../apps/api/src/server.js";
import { LocalState } from "../apps/api/src/state.js";
import { answer, ScriptedAdapter, testConfig } from "./helpers.js";

const apps: Awaited<ReturnType<typeof buildServer>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function server(router?: ModelRouter, config = testConfig()) {
  const app = await buildServer({ config, ...(router ? { router } : {}) });
  apps.push(app);
  return app;
}
async function session(app: Awaited<ReturnType<typeof server>>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/dev/sessions",
    payload: { acceptSyntheticDataPolicy: true },
  });
  expect(response.statusCode).toBe(201);
  return { authorization: `Bearer ${response.json().token}` };
}
async function conversation(
  app: Awaited<ReturnType<typeof server>>,
  headers: { authorization: string },
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/conversations",
    headers,
    payload: {},
  });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}

describe("API integration and session isolation", () => {
  it("reports honest disconnected capabilities without exposing environment", async () => {
    const app = await server();
    const response = await app.inject("/api/v1/health");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      model: "disconnected",
      persistence: "ephemeral",
      catalog: "unavailable",
      voice: false,
    });
    expect(response.body).not.toMatch(/API_KEY|JWT|token|secret/i);
  });
  it("requires an acknowledged synthetic-only local session", async () => {
    const app = await server();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/dev/sessions",
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject("/api/v1/conversations")).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/dev/sessions",
          remoteAddress: "10.0.0.2",
          payload: { acceptSyntheticDataPolicy: true },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("blocks an untrusted Origin and DNS rebinding Host", async () => {
    const app = await server();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/dev/sessions",
          headers: { origin: "https://evil.example" },
          payload: { acceptSyntheticDataPolicy: true },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/dev/sessions",
          headers: { host: "evil.example:4000" },
          payload: { acceptSyntheticDataPolicy: true },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("accepts exact configured CORS origin only", async () => {
    const app = await server();
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/conversations",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "POST",
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
  });
  // Regression: owner's manual guest entry failed because `next dev` serves
  // http://127.0.0.1:3000 while WEB_ORIGIN=http://localhost:3000. GET /health has
  // no Origin header and passed; the guest POST carried Origin and got 403.
  it("accepts the loopback twin of WEB_ORIGIN on a guest POST, rejects other ports/hosts", async () => {
    const app = await server();
    const post = (origin: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/dev/sessions",
        headers: { origin },
        payload: { acceptSyntheticDataPolicy: true },
      });
    const twin = await post("http://127.0.0.1:3000");
    expect(twin.statusCode).toBe(201);
    expect(twin.headers["access-control-allow-origin"]).toBe(
      "http://127.0.0.1:3000",
    );
    for (const origin of [
      "http://127.0.0.1:3001",
      "https://127.0.0.1:3000",
      "http://localhost.evil.example:3000",
      "null",
    ]) {
      const denied = await post(origin);
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual({ error: "FORBIDDEN_ORIGIN" });
    }
  });
  it("returns 503 with no fake answer and no stored user turn when disconnected", async () => {
    const app = await server();
    const headers = await session(app);
    const id = await conversation(app, headers);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/agent/messages",
      headers,
      payload: { conversationId: id, content: "عايز أسافر" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "DISCONNECTED", retryable: true });
    expect(
      (await app.inject({ url: `/api/v1/conversations/${id}`, headers })).json()
        .messages,
    ).toEqual([]);
  });
  it("rejects cross-session reads, runs, streams and sends", async () => {
    const app = await server();
    const first = await session(app);
    const second = await session(app);
    const id = await conversation(app, first);
    expect(
      (
        await app.inject({
          url: `/api/v1/conversations/${id}`,
          headers: second,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/agent/messages",
          headers: second,
          payload: { conversationId: id, content: "x" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({ url: "/api/v1/conversations", headers: second })
      ).json(),
    ).toEqual([]);
  });
  it("rejects forged identity/consent fields and invalid request bodies", async () => {
    const app = await server();
    const headers = await session(app);
    const id = await conversation(app, headers);
    for (const payload of [
      { conversationId: id, content: "x", ownerId: "forged" },
      { conversationId: id, content: "x", consentGranted: true },
      { conversationId: id, content: " " },
      { conversationId: id, content: "x".repeat(16001) },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/agent/messages",
            headers,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/agent/messages",
          headers: { ...headers, "content-type": "application/json" },
          payload: "{broken",
        })
      ).statusCode,
    ).toBe(400);
  });
  it("rejects oversized requests without returning body content or stack traces", async () => {
    const app = await server();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/dev/sessions",
      payload: { data: "private-marker".repeat(6000) },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: "REQUEST_TOO_LARGE" });
  });
  it("provides actual replayable SSE terminal events and prevents cross-owner access", async () => {
    const config = testConfig();
    const router = new ModelRouter(
      [new ScriptedAdapter([async () => answer("Synthetic test response")])],
      config,
    );
    const app = await server(router, config);
    const headers = await session(app);
    const id = await conversation(app, headers);
    const start = await app.inject({
      method: "POST",
      url: "/api/v1/agent/messages",
      headers,
      payload: {
        conversationId: id,
        content: "Synthetic prompt",
        locale: "en",
      },
    });
    expect(start.statusCode).toBe(202);
    const { runId } = start.json();
    const events = await app.inject({
      url: `/api/v1/agent/events/${runId}`,
      headers,
    });
    expect(events.statusCode).toBe(200);
    expect(events.headers["content-type"]).toContain("text/event-stream");
    expect(events.body).toContain("event: response_completed");
    expect(events.body).toContain("Synthetic test response");
    expect(events.body).not.toContain("response_delta");
    const snapshot = (
      await app.inject({ url: `/api/v1/agent/runs/${runId}`, headers })
    ).json();
    expect(snapshot.status).toBe("completed");
    const other = await session(app);
    for (const url of [
      `/api/v1/agent/runs/${runId}`,
      `/api/v1/agent/events/${runId}`,
    ])
      expect((await app.inject({ url, headers: other })).statusCode).toBe(404);
    const resume = await app.inject({
      url: `/api/v1/agent/events/${runId}`,
      headers: { ...headers, "last-event-id": snapshot.events[0].eventId },
    });
    expect(resume.body).not.toContain("event: run_started");
    expect(resume.body).toContain("event: response_completed");
  });
  it("rejects overlapping turns and supports cancellation", async () => {
    const config = testConfig();
    const router = new ModelRouter(
      [new ScriptedAdapter([async () => new Promise(() => {})])],
      config,
    );
    const app = await server(router, config);
    const headers = await session(app);
    const id = await conversation(app, headers);
    const payload = { conversationId: id, content: "test" };
    const start = await app.inject({
      method: "POST",
      url: "/api/v1/agent/messages",
      headers,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/agent/messages",
      headers,
      payload,
    });
    expect(second.statusCode).toBe(409);
    const { runId } = start.json();
    const cancel = await app.inject({
      method: "DELETE",
      url: `/api/v1/agent/runs/${runId}`,
      headers,
    });
    expect(cancel.statusCode).toBe(202);
    const events = await app.inject({
      url: `/api/v1/agent/events/${runId}`,
      headers,
    });
    expect(events.body).toContain("event: run_canceled");
  });
  it("rate-limits request floods with safe errors", async () => {
    const app = await server(undefined, testConfig({ RATE_LIMIT_MAX: 2 }));
    await app.inject("/api/v1/health");
    await app.inject("/api/v1/health");
    const response = await app.inject("/api/v1/health");
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: "RATE_LIMITED" });
  });
});
describe("session lifecycle and local-only config", () => {
  it("expires sessions and deletes their state", () => {
    let now = 0;
    const state = new LocalState(() => now);
    const session = state.createSession();
    const owner = state.authenticate(`Bearer ${session.token}`);
    const conversation = state.createConversation(owner);
    now = 3600001;
    expect(() => state.authenticate(`Bearer ${session.token}`)).toThrow(
      "UNAUTHORIZED",
    );
    expect(() => state.conversation(conversation.id, owner)).toThrow(
      "NOT_FOUND",
    );
  });
  it("fails closed in production and sanitizes invalid environment errors", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
      "Production guard",
    );
    expect(() => loadConfig({ PORT: "secret-marker" })).toThrow(
      "Invalid environment fields: PORT",
    );
    expect(() => loadConfig({ ENABLE_REAL_PROVIDER: "False" })).toThrow(
      "ENABLE_REAL_PROVIDER",
    );
  });
});
