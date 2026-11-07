import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadConfig } from "../apps/api/dist/config.js";
import { safeError } from "../apps/api/dist/errors.js";
import { buildServer } from "../apps/api/dist/server.js";

// This is an opt-in, real integration test. No scripted model or mock transport is imported.
const databaseOnly = process.argv.includes("--database-only");
if (!process.argv.includes("--live") || !process.argv.includes("--test-data")) {
  process.stderr.write(
    "Use --live --test-data only after the reviewed Sadeeman cloud migrations are approved and applied.\n",
  );
  process.exitCode = 2;
} else {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    ALLOW_SYNTHETIC_PROVIDER_DATA: "true",
    ...(databaseOnly ? { ENABLE_REAL_PROVIDER: "false" } : {}),
  });
  const target = JSON.parse(
    readFileSync(
      new URL("../config/supabase-target.json", import.meta.url),
      "utf8",
    ),
  ) as { projectRef: string; apiUrl: string };
  const missing = [
    "SUPABASE_URL",
    "SUPABASE_PROJECT_REF",
    "SUPABASE_PUBLISHABLE_KEY",
    ...(!databaseOnly ? ["GEMINI_API_KEY", "GEMINI_MODEL"] : []),
  ].filter(
    (name) => !process.env[name] || process.env[name]?.includes("CHECK_"),
  );
  if (
    missing.length ||
    config.PERSISTENCE_MODE !== "supabase" ||
    (!databaseOnly && !config.ENABLE_REAL_PROVIDER) ||
    !config.ENABLE_SUPABASE_GUEST
  ) {
    process.stdout.write(
      `${JSON.stringify({ status: "BLOCKED_CONFIGURATION", missing, requires: ["PERSISTENCE_MODE=supabase", ...(!databaseOnly ? ["ENABLE_REAL_PROVIDER=true"] : []), "ENABLE_SUPABASE_GUEST=true"], realModelCalls: 0 })}\n`,
    );
    process.exitCode = 2;
  } else if (
    config.SUPABASE_PROJECT_REF !== target.projectRef ||
    config.SUPABASE_URL !== target.apiUrl ||
    (!databaseOnly &&
      (config.MODEL_PROVIDER !== "gemini" || config.FALLBACK_PROVIDERS))
  ) {
    process.stderr.write(
      "Verification accepts only the locked Sadeeman project and Gemini primary with no fallback.\n",
    );
    process.exitCode = 2;
  } else {
    let stage = "start",
      app: Awaited<ReturnType<typeof buildServer>> | undefined,
      base = "";
    let observedDeltaCount = 0,
      createdGuestAccounts = 0;
    let lastHttp: { expectedStatus: number; actualStatus: number } | undefined;
    const results: Record<string, boolean> = {};
    const request = async (
      path: string,
      method = "GET",
      token?: string,
      payload?: unknown,
    ) =>
      fetch(base + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(config.TURN_TIMEOUT_MS + 5000),
      });
    const json = async <T>(response: Response, status: number): Promise<T> => {
      lastHttp = { expectedStatus: status, actualStatus: response.status };
      assert.equal(response.status, status);
      return (await response.json()) as T;
    };
    async function turn(token: string, id: string, content: string) {
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
      const frames = (await response.text())
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map(
          (line) =>
            JSON.parse(line.slice(6)) as {
              type: string;
              textDelta?: string;
              toolName?: string;
            },
        );
      assert.ok(
        !frames.some((e) => ["run_failed", "run_canceled"].includes(e.type)),
      );
      const final = frames.find((e) => e.type === "response_completed");
      assert.ok(final?.textDelta);
      observedDeltaCount += frames.filter(
        (e) => e.type === "response_delta",
      ).length;
      return { runId: run.runId, text: final.textDelta, frames };
    }
    try {
      app = await buildServer({ config });
      base = await app.listen({ host: "127.0.0.1", port: 0 });
      stage = "real_auth_guest_a";
      let a = await json<{ token: string; refreshToken: string }>(
        await request("/api/v1/auth/guest", "POST", undefined, {
          acceptSyntheticDataPolicy: true,
        }),
        201,
      );
      createdGuestAccounts++;
      stage = "real_auth_guest_b";
      const b = await json<{ token: string }>(
        await request("/api/v1/auth/guest", "POST", undefined, {
          acceptSyntheticDataPolicy: true,
        }),
        201,
      );
      createdGuestAccounts++;
      const c = await json<{ id: string }>(
        await request("/api/v1/conversations", "POST", a.token, {}),
        201,
      );
      stage = "direct_postgrest_rls";
      const direct = await fetch(
        `${config.SUPABASE_URL}/rest/v1/sadeeman_conversations?id=eq.${c.id}&select=id`,
        {
          headers: {
            apikey: config.SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${b.token}`,
          },
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        },
      );
      assert.equal(direct.status, 200);
      assert.deepEqual(await direct.json(), []);
      const ownerDirect = await fetch(
        `${config.SUPABASE_URL}/rest/v1/sadeeman_conversations?id=eq.${c.id}&select=id`,
        {
          headers: {
            apikey: config.SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${a.token}`,
          },
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        },
      );
      assert.equal(ownerDirect.status, 200);
      assert.deepEqual(await ownerDirect.json(), [{ id: c.id }]);
      assert.equal(
        (await request(`/api/v1/conversations/${c.id}`, "GET", b.token)).status,
        404,
      );
      results.twoUsersAndRls = true;
      stage = "memory_consent_update_delete";
      const memoryInput = {
        category: "language",
        content: "English (integration test)",
        sourceConversationId: c.id,
        requestId: randomUUID(),
      };
      assert.equal(
        (
          await request("/api/v1/memory", "POST", a.token, {
            ...memoryInput,
            consentId: randomUUID(),
          })
        ).status,
        403,
      );
      const consent = await json<{ id: string }>(
        await request("/api/v1/consents", "POST", a.token, {
          purpose: "travel_preferences",
          accepted: true,
          version: "memory-v1",
          requestId: randomUUID(),
        }),
        201,
      );
      const memory = await json<{ id: string; version: number }>(
        await request("/api/v1/memory", "POST", a.token, {
          ...memoryInput,
          consentId: consent.id,
        }),
        201,
      );
      const update = await json<{ version: number }>(
        await request(`/api/v1/memory/${memory.id}`, "PATCH", a.token, {
          category: "language",
          content: "Arabic (integration test)",
          consentId: consent.id,
          expectedVersion: memory.version,
          requestId: randomUUID(),
        }),
        200,
      );
      assert.equal(update.version, 2);
      assert.deepEqual(
        await json<unknown[]>(
          await request("/api/v1/memory", "GET", b.token),
          200,
        ),
        [],
      );
      stage = "cloud_session_conversation_memory_restart";
      await app.close();
      app = await buildServer({ config });
      base = await app.listen({ host: "127.0.0.1", port: 0 });
      assert.equal(
        (await request("/api/v1/auth/session", "GET", a.token)).status,
        200,
      );
      const restoredConversation = await json<{ id: string }>(
        await request(`/api/v1/conversations/${c.id}`, "GET", a.token),
        200,
      );
      assert.equal(restoredConversation.id, c.id);
      const restoredMemory = await json<
        { id: string; version: number; content: string }[]
      >(await request("/api/v1/memory", "GET", a.token), 200);
      assert.equal(restoredMemory.length, 1);
      assert.equal(restoredMemory[0]?.id, memory.id);
      assert.equal(restoredMemory[0]?.version, 2);
      assert.equal(restoredMemory[0]?.content, "Arabic (integration test)");
      results.cloudSessionConversationAndMemoryAfterRestart = true;
      stage = "memory_explicit_deletion";
      assert.equal(
        (await request(`/api/v1/memory/${memory.id}`, "DELETE", a.token))
          .status,
        200,
      );
      assert.deepEqual(
        await json<unknown[]>(
          await request("/api/v1/memory", "GET", a.token),
          200,
        ),
        [],
      );
      results.memoryConsentCorrectionDeletion = true;
      stage = "consent_revocation_erasure";
      await json(
        await request("/api/v1/memory", "POST", a.token, {
          ...memoryInput,
          requestId: randomUUID(),
          consentId: consent.id,
        }),
        201,
      );
      await json(
        await request(`/api/v1/consents/${consent.id}`, "DELETE", a.token),
        200,
      );
      assert.deepEqual(
        await json(await request("/api/v1/memory", "GET", a.token), 200),
        [],
      );
      results.consentRevocationErasesMemory = true;
      if (!databaseOnly) {
        stage = "gemini_real_first_turn";
        const marker = `travel-marker-${randomUUID()}`;
        const first = await turn(
          a.token,
          c.id,
          `For this integration test, keep this temporary conversation marker: ${marker}. Reply briefly with the marker.`,
        );
        assert.ok(first.text.includes(marker));
        stage = "server_restart_and_real_second_turn";
        await app.close();
        app = await buildServer({ config });
        base = await app.listen({ host: "127.0.0.1", port: 0 });
        assert.equal(
          (await request("/api/v1/auth/session", "GET", a.token)).status,
          200,
        );
        const history = await json<{ messages: unknown[] }>(
          await request(`/api/v1/conversations/${c.id}`, "GET", a.token),
          200,
        );
        assert.equal(history.messages.length, 2);
        const second = await turn(
          a.token,
          c.id,
          "What exact temporary conversation marker did I give you? Reply with it.",
        );
        assert.ok(second.text.includes(marker));
        results.realGeminiContinuityAfterRestart = true;
        stage = "real_model_directed_tool";
        const third = await turn(
          a.token,
          c.id,
          "Use estimate_trip_budget to calculate an explicitly hypothetical arithmetic example: EGP, one line item, unitAmountMinor=100 and quantity=2. Assumptions: integration test only, no live price. Explain the estimate.",
        );
        assert.ok(
          third.frames.some(
            (e) =>
              e.type === "tool_completed" &&
              e.toolName === "estimate_trip_budget",
          ),
        );
        const tools = await json<{ runId: string; toolName: string }[]>(
          await request(`/api/v1/conversations/${c.id}/tools`, "GET", a.token),
          200,
        );
        assert.ok(
          tools.some(
            (t) =>
              t.runId === third.runId && t.toolName === "estimate_trip_budget",
          ),
        );
        results.realStructuredToolAndDurableTrace = true;
        if (config.ENABLE_PROVIDER_STREAMING) {
          assert.ok(observedDeltaCount > 0);
          results.realStreaming = true;
        }
      }
      stage = "conversation_deletion_cascade";
      const cleanupConsent = await json<{ id: string }>(
        await request("/api/v1/consents", "POST", a.token, {
          purpose: "travel_preferences",
          accepted: true,
          version: "memory-v1",
          requestId: randomUUID(),
        }),
        201,
      );
      await json(
        await request("/api/v1/memory", "POST", a.token, {
          ...memoryInput,
          requestId: randomUUID(),
          consentId: cleanupConsent.id,
        }),
        201,
      );
      stage = "refresh_and_application_revocation";
      a = await json<{ token: string; refreshToken: string }>(
        await request("/api/v1/auth/refresh", "POST", undefined, {
          refreshToken: a.refreshToken,
        }),
        200,
      );
      assert.equal(
        (await request("/api/v1/auth/session", "GET", a.token)).status,
        200,
      );
      assert.equal(
        (await request(`/api/v1/conversations/${c.id}`, "DELETE", a.token))
          .status,
        200,
      );
      assert.equal(
        (await request(`/api/v1/conversations/${c.id}`, "GET", a.token)).status,
        404,
      );
      assert.deepEqual(
        await json(await request("/api/v1/memory", "GET", a.token), 200),
        [],
      );
      results.conversationDeletionCascadesToMemory = true;
      assert.equal(
        (await request("/api/v1/auth/session", "DELETE", a.token)).status,
        204,
      );
      assert.equal(
        (await request("/api/v1/auth/session", "GET", a.token)).status,
        401,
      );
      results.refreshAndDurableAppRevocation = true;
      process.stdout.write(
        `${JSON.stringify({ status: databaseOnly ? "REAL_CLOUD_DATABASE_INTEGRATION_PASSED" : "REAL_CLOUD_AND_GEMINI_INTEGRATION_PASSED", ...(databaseOnly ? { realModelCalls: 0 } : {}), projectRef: target.projectRef, checkedAt: new Date().toISOString(), results, observedDeltaCount, createdGuestAccounts, credentialsDisplayed: false, note: "Two non-PII verification guest Auth accounts remain; no privileged Auth deletion was attempted." }, null, 2)}\n`,
      );
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ status: "FAILED_OR_BLOCKED", stage, code: error instanceof assert.AssertionError ? "VERIFICATION_ASSERTION" : safeError(error).code, lastHttp, results, createdGuestAccounts, credentialsDisplayed: false })}\n`,
      );
      process.exitCode = 1;
    } finally {
      await app?.close();
    }
  }
}
