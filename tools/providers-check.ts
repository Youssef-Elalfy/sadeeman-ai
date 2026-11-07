import { randomUUID } from "node:crypto";
import { loadConfig } from "../apps/api/dist/config.js";
import { safeError } from "../apps/api/dist/errors.js";
import {
  createRouter,
  withinDeadline,
} from "../apps/api/dist/providers/router.js";
import { createTools } from "../apps/api/dist/tools/registry.js";

const live = process.argv.includes("--live"),
  synthetic = process.argv.includes("--synthetic");
// Explicit test inputs still use real provider adapters. Never substitute scripted responses.
const config = loadConfig(
    synthetic
      ? {
          ...process.env,
          NODE_ENV: "test",
          ALLOW_SYNTHETIC_PROVIDER_DATA: "true",
        }
      : process.env,
  ),
  router = createRouter(config);
const provider =
  process.argv.find((arg) => arg.startsWith("--provider="))?.slice(11) ??
  config.MODEL_PROVIDER;
if (!live) {
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: "offline_configuration_only",
        providers: router.statuses(),
        realAuthenticatedCalls: 0,
        required: [
          "ENABLE_REAL_PROVIDER",
          "provider API key",
          "explicit supported model ID",
        ],
        syntheticInputs: "explicit_test_environment_only",
      },
      null,
      2,
    )}\n`,
  );
} else if (!synthetic) {
  process.stderr.write(
    "Use --live --synthetic to explicitly authorize the small synthetic provider probe.\n",
  );
  process.exitCode = 2;
} else {
  const adapter = router.adapters.find((a) => a.id === provider);
  if (!adapter) {
    process.stdout.write(
      `${JSON.stringify({
        provider,
        status: "DISCONNECTED",
        realAuthenticatedCalls: 0,
      })}\n`,
    );
    process.exitCode = 2;
  } else {
    const signal = AbortSignal.timeout(config.TURN_TIMEOUT_MS),
      tools = createTools();
    const tool = tools
      .definitions()
      .find((t) => t.name === "estimate_trip_budget");
    if (!tool) throw new Error("Budget tool missing");
    const input = {
      system:
        "Synthetic integration probe. Use the supplied tool exactly once; then state the numeric result and that it is an estimate. Never claim a booking.",
      messages: [
        {
          role: "user" as const,
          content:
            "Call estimate_trip_budget with currency EGP, one item labeled synthetic, unitAmountMinor 100, quantity 2, and assumptions [synthetic test].",
        },
      ],
      tools: [tool],
      maxOutputTokens: Math.min(config.MAX_OUTPUT_TOKENS, 2048),
    };
    let requests = 0,
      deltas = 0;
    try {
      requests++;
      const first = await withinDeadline(
        (s) =>
          adapter.generate(
            { ...input, toolChoice: "required" },
            s,
            config.ENABLE_PROVIDER_STREAMING
              ? () => {
                  deltas++;
                }
              : undefined,
          ),
        signal,
        config.MODEL_TIMEOUT_MS,
      );
      const call = first.toolCalls[0];
      if (first.toolCalls.length !== 1 || call?.name !== "estimate_trip_budget")
        throw new Error("Tool compatibility failed");
      const result = await tools.execute(call, {
        ownerId: randomUUID(),
        conversationId: randomUUID(),
        signal,
      });
      if (result.status !== "ok") throw new Error("Tool execution failed");
      requests++;
      const second = await withinDeadline(
        (s) =>
          adapter.generate(
            {
              ...input,
              messages: [
                ...input.messages,
                {
                  role: "assistant",
                  content: first.text,
                  toolCalls: first.toolCalls,
                  ...(first.native ? { native: first.native } : {}),
                },
                { role: "tool", callId: call.id, name: call.name, result },
              ],
            },
            s,
            config.ENABLE_PROVIDER_STREAMING
              ? () => {
                  deltas++;
                }
              : undefined,
          ),
        signal,
        config.MODEL_TIMEOUT_MS,
      );
      if (!second.text.trim() || second.toolCalls.length)
        throw new Error("Final response missing");
      process.stdout.write(
        `${JSON.stringify(
          {
            provider,
            status: "REAL_AUTHENTICATED_TOOL_ROUNDTRIP_PASSED",
            checkedAt: new Date().toISOString(),
            requests,
            tool: call.name,
            streamChunks: deltas,
            reportedUsage: {
              inputTokens: first.usage.inputTokens + second.usage.inputTokens,
              outputTokens:
                first.usage.outputTokens + second.usage.outputTokens,
            },
            note: "Synthetic probe only. Not a behavioral evaluation or guaranteed free entitlement.",
          },
          null,
          2,
        )}\n`,
      );
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({
          provider,
          status: "FAILED",
          code: safeError(error).code,
          requests,
          streamChunks: deltas,
          completed: false,
        })}\n`,
      );
      process.exitCode = 1;
    }
  }
}
