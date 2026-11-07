import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalDatabase,
  localDatabasePath,
  openLocalPersistence,
  projectRoot,
} from "../apps/api/src/persistence/local.js";
import { Repository } from "../apps/api/src/persistence/repository.js";
import { ModelRouter } from "../apps/api/src/providers/router.js";
import { buildServer } from "../apps/api/src/server.js";
import { answer, ScriptedAdapter, testConfig } from "./helpers.js";

const apps: Awaited<ReturnType<typeof buildServer>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
async function app(
  script: ConstructorParameters<typeof ScriptedAdapter>[0] = [],
) {
  const store = await createLocalDatabase();
  const config = testConfig();
  const model = new ScriptedAdapter(script);
  const server = await buildServer({
    config,
    router: new ModelRouter([model], config),
    persistence: { mode: "local", auth: store, transport: store },
  });
  apps.push(server);
  return { server, store, model };
}
async function guest(server: Awaited<ReturnType<typeof buildServer>>) {
  const result = await server.inject({
    method: "POST",
    url: "/api/v1/auth/guest",
    payload: { acceptSyntheticDataPolicy: true },
  });
  expect(result.statusCode).toBe(201);
  return { authorization: `Bearer ${result.json().token}` };
}
async function conversation(
  server: Awaited<ReturnType<typeof buildServer>>,
  headers: { authorization: string },
) {
  const response = await server.inject({
    method: "POST",
    url: "/api/v1/conversations",
    headers,
    payload: {},
  });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}
describe("persistent API with real PostgreSQL; scripted model only in this automated test", () => {
  it("completes fifteen authenticated turns through SSE and durable commits without losing history or isolation", async () => {
    const { server, model } = await app(
      Array.from({ length: 15 }, (_, i) => async (input) => {
        if (i > 0)
          expect(JSON.stringify(input.messages)).toContain(
            "TEST ONLY original Maldives request",
          );
        return answer(`TEST ONLY persisted response ${i}`);
      }),
    );
    const headers = await guest(server),
      id = await conversation(server, headers);
    for (let i = 0; i < 15; i++) {
      const started = await server.inject({
        method: "POST",
        url: "/api/v1/agent/messages",
        headers,
        payload: {
          conversationId: id,
          clientRequestId: randomUUID(),
          content:
            i === 0
              ? "TEST ONLY original Maldives request"
              : `TEST ONLY follow-up ${i}`,
          locale: "en",
        },
      });
      expect(started.statusCode).toBe(202);
      const events = await server.inject({
        url: `/api/v1/agent/events/${started.json().runId}`,
        headers,
      });
      expect(events.body).toContain("response_completed");
      expect(events.body).not.toContain("run_failed");
      const snapshot = await server.inject({
        url: `/api/v1/agent/runs/${started.json().runId}`,
        headers,
      });
      expect(snapshot.json().status).toBe("completed");
    }
    expect(model.inputs).toHaveLength(15);
    const saved = await server.inject({
      url: `/api/v1/conversations/${id}`,
      headers,
    });
    expect(saved.json().messages).toHaveLength(30);
    expect(saved.json().messages[0].content).toBe(
      "TEST ONLY original Maldives request",
    );
    const other = await guest(server);
    expect(
      (
        await server.inject({
          url: `/api/v1/conversations/${id}`,
          headers: other,
        })
      ).statusCode,
    ).toBe(404);
  }, 30000);
  it("aborts in-flight work when consent is revoked so further rounds cannot reuse removed memory", async () => {
    let release: ((value: ReturnType<typeof answer>) => void) | undefined;
    const { server } = await app([
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    ]);
    const headers = await guest(server),
      id = await conversation(server, headers);
    const consent = (
      await server.inject({
        method: "POST",
        url: "/api/v1/consents",
        headers,
        payload: {
          purpose: "travel_preferences",
          version: "memory-v1",
          accepted: true,
          requestId: randomUUID(),
        },
      })
    ).json();
    const started = await server.inject({
      method: "POST",
      url: "/api/v1/agent/messages",
      headers,
      payload: { conversationId: id, content: "Synthetic in-flight question" },
    });
    expect(started.statusCode).toBe(202);
    expect(
      (
        await server.inject({
          method: "DELETE",
          url: `/api/v1/consents/${consent.id}`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    release?.(answer("Late synthetic answer"));
    const events = await server.inject({
      url: `/api/v1/agent/events/${started.json().runId}`,
      headers,
    });
    expect(events.body).toContain("run_canceled");
    expect(events.body).not.toContain("response_completed");
    expect(
      (
        await server.inject({ url: `/api/v1/conversations/${id}`, headers })
      ).json().messages,
    ).toEqual([]);
  }, 30000);
  it("acknowledges persisted conversations, restores context, and deduplicates a client request", async () => {
    const { server, model } = await app([
      async () => answer("Synthetic response one"),
      async (input) => {
        expect(
          input.messages.some(
            (m) => "content" in m && m.content === "Synthetic response one",
          ),
        ).toBe(true);
        expect(
          input.messages.some(
            (m) =>
              "content" in m &&
              m.content.includes("Synthetic saved preference"),
          ),
        ).toBe(true);
        return answer("Synthetic response two");
      },
    ]);
    const headers = await guest(server),
      id = await conversation(server, headers);
    const consent = await server.inject({
      method: "POST",
      url: "/api/v1/consents",
      headers,
      payload: {
        purpose: "travel_preferences",
        version: "memory-v1",
        accepted: true,
        requestId: randomUUID(),
      },
    });
    expect(consent.statusCode).toBe(201);
    const memory = await server.inject({
      method: "POST",
      url: "/api/v1/memory",
      headers,
      payload: {
        consentId: consent.json().id,
        category: "travel_style",
        content: "Synthetic saved preference",
        sourceConversationId: id,
        requestId: randomUUID(),
      },
    });
    expect(memory.statusCode).toBe(201);
    const requestId = randomUUID(),
      payload = {
        conversationId: id,
        content: "Synthetic question",
        clientRequestId: requestId,
        locale: "en",
      };
    const run = await server.inject({
      method: "POST",
      url: "/api/v1/agent/messages",
      headers,
      payload,
    });
    expect(run.statusCode).toBe(202);
    const events = await server.inject({
      url: `/api/v1/agent/events/${run.json().runId}`,
      headers,
    });
    expect(events.body).toContain("response_completed");
    const saved = await server.inject({
      url: `/api/v1/conversations/${id}`,
      headers,
    });
    expect(saved.json().messages).toHaveLength(2);
    const repeat = await server.inject({
      method: "POST",
      url: "/api/v1/agent/messages",
      headers,
      payload,
    });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().persisted).toBe(true);
    expect(model.inputs).toHaveLength(1);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/api/v1/agent/messages",
          headers,
          payload: { ...payload, content: "Different" },
        })
      ).statusCode,
    ).toBe(409);
    const next = await server.inject({
      method: "POST",
      url: "/api/v1/agent/messages",
      headers,
      payload: { conversationId: id, content: "Synthetic follow-up" },
    });
    expect(
      (
        await server.inject({
          url: `/api/v1/agent/events/${next.json().runId}`,
          headers,
        })
      ).body,
    ).toContain("response_completed");
    expect(model.inputs).toHaveLength(2);
  }, 30000);
  it("rejects missing/forged consent, provides memory correction/deletion, and isolates different users", async () => {
    const { server } = await app();
    const a = await guest(server),
      b = await guest(server);
    const id = await conversation(server, a);
    const input = {
      consentId: randomUUID(),
      category: "travel_style",
      content: "Synthetic preference",
      sourceConversationId: id,
      requestId: randomUUID(),
    };
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/api/v1/memory",
          headers: a,
          payload: { ...input, consentGranted: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/api/v1/memory",
          headers: a,
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
    const consent = (
      await server.inject({
        method: "POST",
        url: "/api/v1/consents",
        headers: a,
        payload: {
          purpose: "travel_preferences",
          version: "memory-v1",
          accepted: true,
          requestId: randomUUID(),
        },
      })
    ).json();
    const memory = await server.inject({
      method: "POST",
      url: "/api/v1/memory",
      headers: a,
      payload: { ...input, consentId: consent.id },
    });
    expect(memory.statusCode).toBe(201);
    expect(
      (await server.inject({ url: "/api/v1/memory", headers: b })).json(),
    ).toEqual([]);
    expect(
      (await server.inject({ url: `/api/v1/conversations/${id}`, headers: b }))
        .statusCode,
    ).toBe(404);
    const updated = await server.inject({
      method: "PATCH",
      url: `/api/v1/memory/${memory.json().id}`,
      headers: a,
      payload: {
        consentId: consent.id,
        category: "travel_style",
        content: "Synthetic corrected preference",
        expectedVersion: 1,
        requestId: randomUUID(),
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);
    expect(
      (
        await server.inject({
          method: "DELETE",
          url: `/api/v1/memory/${memory.json().id}`,
          headers: a,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({ url: "/api/v1/memory", headers: a })).json(),
    ).toEqual([]);
    expect(
      (
        await server.inject({
          method: "DELETE",
          url: "/api/v1/auth/session",
          headers: a,
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await server.inject({ url: "/api/v1/auth/session", headers: a }))
        .statusCode,
    ).toBe(401);
  }, 30000);
  it("never emits completed or stores a successful turn if the database commit fails", async () => {
    const { server, store } = await app([
      async () => answer("Synthetic uncommitted answer"),
    ]);
    const headers = await guest(server),
      id = await conversation(server, headers);
    // Actual PostgreSQL constraint failure in the same commit transaction, not a stubbed database.
    await store.db.exec(
      "alter table public.sadeeman_turns add constraint reject_test_turn check(answer<>'Synthetic uncommitted answer')",
    );
    const run = await server.inject({
      method: "POST",
      url: "/api/v1/agent/messages",
      headers,
      payload: { conversationId: id, content: "Synthetic input" },
    });
    const events = await server.inject({
      url: `/api/v1/agent/events/${run.json().runId}`,
      headers,
    });
    expect(events.body).toContain("run_failed");
    expect(events.body).not.toContain("response_completed");
    expect(
      (
        await server.inject({ url: `/api/v1/conversations/${id}`, headers })
      ).json().messages,
    ).toEqual([]);
  }, 30000);
});
describe("durability across actual database close and re-open", () => {
  it("restores a guest identity, history and consented memory from disk, then honors revocation", async () => {
    const relative = `.private/test-restart-${randomUUID()}`,
      path = localDatabasePath(relative);
    let persistence = await openLocalPersistence(relative);
    try {
      const session = await persistence.auth.guest();
      const principal = await persistence.auth.authenticate(
        `Bearer ${session.token}`,
      );
      let repo = new Repository(persistence.transport, principal);
      const c = await repo.createConversation();
      await repo.commit(
        c.id,
        randomUUID(),
        randomUUID(),
        "Synthetic persistent input",
        "Synthetic persistent output",
        { inputTokens: 1, outputTokens: 1 },
      );
      const consent = await repo.consent({
        accepted: true,
        purpose: "travel_preferences",
        version: "memory-v1",
        requestId: randomUUID(),
      });
      await repo.saveMemory({
        consentId: consent.id,
        category: "language",
        content: "Synthetic English preference",
        sourceConversationId: c.id,
        expiresInDays: 90,
        requestId: randomUUID(),
      });
      await persistence.transport.close();
      persistence = await openLocalPersistence(relative);
      const restored = await persistence.auth.authenticate(
        `Bearer ${session.token}`,
      );
      expect(restored.ownerId).toBe(principal.ownerId);
      repo = new Repository(persistence.transport, restored);
      expect((await repo.conversation(c.id)).messages).toHaveLength(2);
      expect(await repo.memories()).toHaveLength(1);
      await persistence.auth.revoke(restored);
      await persistence.transport.close();
      persistence = await openLocalPersistence(relative);
      await expect(
        persistence.auth.authenticate(`Bearer ${session.token}`),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      await persistence.transport.close();
      const boundary = resolve(projectRoot, ".private") + sep;
      if (path.startsWith(boundary) && path.includes("test-restart-"))
        await rm(path, { recursive: true, force: true });
    }
  }, 30000);
  it("rejects database paths outside the project private directory", () => {
    expect(() => localDatabasePath("../other-project")).toThrow();
  });
});
