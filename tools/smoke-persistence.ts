import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { loadConfig } from "../apps/api/dist/config.js";
import {
  localDatabasePath,
  projectRoot,
} from "../apps/api/dist/persistence/local.js";
import { buildServer } from "../apps/api/dist/server.js";

// Dedicated synthetic local database. Never selects a configured hosted target or enables a model.
const relative = `.private/smoke-${randomUUID()}`,
  directory = localDatabasePath(relative);
const config = loadConfig({
  ...process.env,
  NODE_ENV: "test",
  PERSISTENCE_MODE: "local",
  LOCAL_DATABASE_PATH: relative,
  ENABLE_REAL_PROVIDER: "false",
  ALLOW_SYNTHETIC_PROVIDER_DATA: "false",
});
let app = await buildServer({ config });
let base = await app.listen({ host: "127.0.0.1", port: 0 });
async function request(
  path: string,
  method = "GET",
  token?: string,
  payload?: unknown,
) {
  return fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(10000),
  });
}
try {
  const session = await request("/api/v1/auth/guest", "POST", undefined, {
    acceptSyntheticDataPolicy: true,
  });
  assert.equal(session.status, 201);
  const { token } = (await session.json()) as { token: string };
  const c = await request("/api/v1/conversations", "POST", token, {});
  assert.equal(c.status, 201);
  const { id } = (await c.json()) as { id: string };
  const consent = await request("/api/v1/consents", "POST", token, {
    purpose: "travel_preferences",
    accepted: true,
    version: "memory-v1",
    requestId: randomUUID(),
  });
  assert.equal(consent.status, 201);
  const consentId = ((await consent.json()) as { id: string }).id;
  const memory = await request("/api/v1/memory", "POST", token, {
    consentId,
    category: "travel_style",
    content: "Synthetic local smoke preference",
    sourceConversationId: id,
    requestId: randomUUID(),
  });
  assert.equal(memory.status, 201);
  const memoryId = ((await memory.json()) as { id: string }).id;
  await app.close();
  app = await buildServer({ config });
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  assert.equal(
    (await request("/api/v1/auth/session", "GET", token)).status,
    200,
  );
  assert.equal(
    (
      (await (
        await request("/api/v1/memory", "GET", token)
      ).json()) as unknown[]
    ).length,
    1,
  );
  const other = await request("/api/v1/auth/guest", "POST", undefined, {
    acceptSyntheticDataPolicy: true,
  });
  const otherToken = ((await other.json()) as { token: string }).token;
  assert.equal(
    (await request(`/api/v1/conversations/${id}`, "GET", otherToken)).status,
    404,
  );
  assert.deepEqual(
    await (await request("/api/v1/memory", "GET", otherToken)).json(),
    [],
  );
  assert.equal(
    (await request(`/api/v1/memory/${memoryId}`, "DELETE", token)).status,
    200,
  );
  assert.equal(
    (await request(`/api/v1/consents/${consentId}`, "DELETE", token)).status,
    200,
  );
  assert.equal(
    (await request("/api/v1/auth/session", "DELETE", token)).status,
    204,
  );
  await app.close();
  app = await buildServer({ config });
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  assert.equal(
    (await request("/api/v1/auth/session", "GET", token)).status,
    401,
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "PASS",
        transport: "real localhost HTTP",
        database: "real disk-backed PostgreSQL (PGlite)",
        serverRestarts: 2,
        restoredSession: true,
        persistedMemory: true,
        crossUserAccessDenied: true,
        memoryDeleted: true,
        revocationSurvivedRestart: true,
        realModelCalls: 0,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await app.close();
  if (
    directory.startsWith(resolve(projectRoot, ".private") + sep) &&
    directory.includes("smoke-")
  )
    await rm(directory, { recursive: true, force: true });
}
