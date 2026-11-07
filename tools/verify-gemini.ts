import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { loadConfig } from "../apps/api/dist/config.js";
import { safeError } from "../apps/api/dist/errors.js";
import {
  localDatabasePath,
  projectRoot,
} from "../apps/api/dist/persistence/local.js";
import { buildServer } from "../apps/api/dist/server.js";

// Actual Gemini + actual disk PostgreSQL; deliberately independent of pending cloud DDL approval.
// Only the inputs are test data. No model double or scripted response is imported.
if (!process.argv.includes("--live") || !process.argv.includes("--test-data")) {
  process.stderr.write(
    "Use --live --test-data to authorize the small genuine Gemini verification.\n",
  );
  process.exitCode = 2;
} else if (
  !process.env.GEMINI_API_KEY ||
  !process.env.GEMINI_MODEL ||
  process.env.GEMINI_MODEL.includes("CHECK_")
) {
  process.stdout.write(
    "BLOCKED_CONFIGURATION: Gemini key and exact model ID are required locally. No model request sent.\n",
  );
  process.exitCode = 2;
} else {
  const relative = `.private/gemini-verify-${randomUUID()}`;
  const directory = localDatabasePath(relative);
  const boundary = resolve(projectRoot, ".private") + sep;
  if (!directory.startsWith(boundary))
    throw new Error("Unsafe verification cleanup path");
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    PERSISTENCE_MODE: "local",
    LOCAL_DATABASE_PATH: relative,
    MODEL_PROVIDER: "gemini",
    FALLBACK_PROVIDERS: "",
    ENABLE_REAL_PROVIDER: "true",
    ENABLE_PROVIDER_STREAMING: "true",
    ALLOW_SYNTHETIC_PROVIDER_DATA: "true",
    PROVIDER_RETRIES: "0",
  });
  let app: Awaited<ReturnType<typeof buildServer>> | undefined,
    base = "",
    stage = "start",
    streamChunks = 0;
  const results: Record<string, boolean> = {};
  async function start(timeoutMs = config.MODEL_TIMEOUT_MS) {
    app = await buildServer({
      config: { ...config, MODEL_TIMEOUT_MS: timeoutMs },
    });
    base = await app.listen({ host: "127.0.0.1", port: 0 });
  }
  async function restart(timeoutMs = config.MODEL_TIMEOUT_MS) {
    await app?.close();
    app = undefined;
    await start(timeoutMs);
  }
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
      signal: AbortSignal.timeout(config.TURN_TIMEOUT_MS + 5000),
    });
  }
  async function json<T>(response: Response, status: number): Promise<T> {
    assert.equal(response.status, status);
    return (await response.json()) as T;
  }
  async function turn(
    token: string,
    id: string,
    content: string,
    expectTimeout = false,
  ) {
    const run = await json<{ runId: string }>(
      await request("/api/v1/agent/messages", "POST", token, {
        conversationId: id,
        content,
        locale: "en",
        clientRequestId: randomUUID(),
      }),
      202,
    );
    const response = await request(
      `/api/v1/agent/events/${run.runId}`,
      "GET",
      token,
    );
    assert.equal(response.status, 200);
    const events = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map(
        (line) =>
          JSON.parse(line.slice(6)) as {
            type: string;
            textDelta?: string;
            toolName?: string;
            safeStatus?: string;
          },
      );
    if (expectTimeout) {
      const failure = events.find((e) => e.type === "run_failed");
      assert.ok(failure);
      assert.equal(failure.safeStatus, "PROVIDER_TIMEOUT");
      assert.ok(!events.some((e) => e.type === "response_completed"));
      return { runId: run.runId, text: "", events };
    }
    assert.ok(
      !events.some((e) => ["run_failed", "run_canceled"].includes(e.type)),
    );
    const final = events.find((e) => e.type === "response_completed");
    assert.ok(final?.textDelta);
    streamChunks += events.filter((e) => e.type === "response_delta").length;
    return { runId: run.runId, text: final.textDelta, events };
  }
  try {
    await start();
    const { token } = await json<{ token: string }>(
      await request("/api/v1/auth/guest", "POST", undefined, {
        acceptSyntheticDataPolicy: true,
      }),
      201,
    );
    const { id } = await json<{ id: string }>(
      await request("/api/v1/conversations", "POST", token, {}),
      201,
    );
    const marker = `verification-${randomUUID()}`;
    stage = "real_generation";
    const first = await turn(
      token,
      id,
      `Temporary integration test marker: ${marker}. Reply briefly with the exact marker.`,
    );
    assert.ok(first.text.includes(marker));
    results.realGeneration = true;
    stage = "restart_and_multiturn";
    await restart();
    const history = await json<{ messages: unknown[] }>(
      await request(`/api/v1/conversations/${id}`, "GET", token),
      200,
    );
    assert.equal(history.messages.length, 2);
    const second = await turn(
      token,
      id,
      "Repeat the exact temporary marker I gave you previously.",
    );
    assert.ok(second.text.includes(marker));
    results.realContinuityAfterLocalRestart = true;
    stage = "real_tool_execution";
    const toolTurn = await turn(
      token,
      id,
      "Use estimate_trip_budget for a hypothetical arithmetic test: currency EGP; one item labeled test with unitAmountMinor 100 and quantity 2; assumptions [integration test only, no live price]. Briefly state the estimate.",
    );
    assert.ok(
      toolTurn.events.some(
        (e) =>
          e.type === "tool_completed" && e.toolName === "estimate_trip_budget",
      ),
    );
    const traces = await json<{ runId: string; toolName: string }[]>(
      await request(`/api/v1/conversations/${id}/tools`, "GET", token),
      200,
    );
    assert.ok(
      traces.some(
        (t) =>
          t.runId === toolTurn.runId && t.toolName === "estimate_trip_budget",
      ),
    );
    results.realToolAndLocalDurableTrace = true;
    stage = "controlled_real_transport_deadline";
    await restart(50);
    await turn(
      token,
      id,
      "Repeat my exact temporary marker with a brief explanation.",
      true,
    );
    const afterFailure = await json<{ messages: unknown[] }>(
      await request(`/api/v1/conversations/${id}`, "GET", token),
      200,
    );
    assert.equal(afterFailure.messages.length, 6);
    results.realDeadlineFailurePreservesHistory = true;
    stage = "recovery_with_normal_deadline";
    await restart();
    const recovered = await turn(
      token,
      id,
      "Repeat my exact temporary marker from the start of this conversation.",
    );
    assert.ok(recovered.text.includes(marker));
    results.realRecoveryAndContext = true;
    assert.ok(streamChunks > 0);
    results.realStreaming = true;
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "REAL_GEMINI_LOCAL_E2E_PASSED",
          model: config.GEMINI_MODEL,
          checkedAt: new Date().toISOString(),
          results,
          streamChunks,
          cloudVerified: false,
          note: "Controlled 50ms real-request deadline followed by a successful normal-deadline request; not evidence of a naturally occurring provider outage. Test inputs only; temporary local database removed.",
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ status: "FAILED", stage, code: safeError(error).code, results, cloudVerified: false })}\n`,
    );
    process.exitCode = 1;
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
