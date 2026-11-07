import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ProviderFailure, TravelState } from "@sadeeman/contracts";
import { z } from "zod";
import { loadConfig } from "../apps/api/dist/config.js";
import {
  ComparisonObservation,
  capEvaluationRequests,
  comparisonMatches,
  TravelDialogueCase,
} from "../apps/api/dist/evals/travel.js";
import { createRouter } from "../apps/api/dist/providers/router.js";
import { TravelIntelligence } from "../apps/api/dist/research/travel.js";
import { buildServer } from "../apps/api/dist/server.js";
import { createTools } from "../apps/api/dist/tools/registry.js";

const Scenario = TravelDialogueCase;
if (
  !process.argv.includes("--live") ||
  !process.argv.includes("--public-test-data") ||
  !process.argv.includes("--quota-ready-confirmed") ||
  !process.argv.includes("--approved-run")
) {
  process.stderr.write(
    "Live calls paused. Require explicit user approval and confirmed quota availability: --live --public-test-data --quota-ready-confirmed --approved-run. At most two basic searches; no Supabase/OpenRouter.\n",
  );
  process.exitCode = 2;
} else {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    PERSISTENCE_MODE: "ephemeral",
    ALLOW_SYNTHETIC_PROVIDER_DATA: "true",
    ENABLE_REAL_PROVIDER: "true",
    ENABLE_TRAVEL_RESEARCH: "true",
    ENABLE_TRAVEL_CONTEXT: "true",
    ENABLE_TRAVEL_CONTEXT_PERSISTENCE: "false",
    ENABLE_COMPANY_CATALOG: "false",
    MODEL_PROVIDER: "gemini",
    FALLBACK_PROVIDERS: "groq",
    ENABLE_OPENROUTER_RUNTIME: "false",
    PROVIDER_RETRIES: "0",
    TURN_TIMEOUT_MS: "120000",
    MAX_TURN_TOKENS: "24000",
    MAX_TOOL_CALLS_PER_TURN: "4",
  });
  const cases = readFileSync(
    new URL("../tests/evals/m3.scenarios.jsonl", import.meta.url),
    "utf8",
  )
    .trim()
    .split(/\r?\n/)
    .map((line) => Scenario.parse(JSON.parse(line)));
  assert.equal(cases.length, 3);
  let currentScenario = cases[0];
  let searchRequests = 0,
    stage = "start",
    lastHttp: number | undefined;
  const liveFetch: typeof fetch = async (...args) => {
    if (String(args[0]) === "https://api.tavily.com/search") {
      if (searchRequests >= 2) throw new Error("EVALUATION_SEARCH_LIMIT");
      searchRequests++;
    }
    return fetch(...args);
  };
  const tools = createTools(
    undefined,
    new TravelIntelligence(config, liveFetch),
    true,
  );
  const observed: {
    tool: string;
    status: string;
    code?: string;
    comparisonVerified?: boolean;
    validationIssues?: {
      path: string;
      code: string;
      expectedType?: string;
      unrecognizedFields?: string[];
    }[];
    constraintFeedback?: { reason?: string; fields?: string[] };
    financialValues?: {
      currency: string;
      travellers: number;
      totalBudgetMinor: number;
      options: {
        destination: string;
        days: number;
        totalMinor: number;
        withinBudget: boolean;
      }[];
    };
  }[] = [];
  const execute = tools.execute.bind(tools);
  // Observe, never replace or modify, genuine model-proposed tool execution.
  tools.execute = async (call, context) => {
    const result = await execute(call, context);
    const row: (typeof observed)[number] = {
      tool: call.name,
      status: result.status,
      ...(result.code ? { code: result.code } : {}),
    };
    if (result.code === "INVALID_TOOL_ARGUMENTS")
      row.validationIssues = z
        .object({
          validationIssues: z.array(
            z.object({
              path: z.string(),
              code: z.string(),
              expectedType: z.string().optional(),
              unrecognizedFields: z.array(z.string()).optional(),
            }),
          ),
        })
        .parse(result.data)
        .validationIssues.map((issue) => ({
          path: issue.path,
          code: issue.code,
          ...(issue.expectedType !== undefined
            ? { expectedType: issue.expectedType }
            : {}),
          ...(issue.unrecognizedFields !== undefined
            ? { unrecognizedFields: issue.unrecognizedFields }
            : {}),
        }));
    if (result.code === "CONSTRAINT_CONFLICT") {
      const feedback = z
        .object({
          reason: z
            .string()
            .regex(/^[A-Z_]{1,80}$/)
            .optional(),
          fields: z
            .array(z.string().regex(/^[a-zA-Z_.]{1,100}$/))
            .max(20)
            .optional(),
        })
        .parse(result.data);
      row.constraintFeedback = {
        ...(feedback.reason !== undefined ? { reason: feedback.reason } : {}),
        ...(feedback.fields !== undefined ? { fields: feedback.fields } : {}),
      };
    }
    if (call.name === "compare_travel_options" && result.status === "ok") {
      const parsed = ComparisonObservation.parse(result.data);
      row.comparisonVerified =
        currentScenario !== undefined &&
        comparisonMatches(parsed, currentScenario);
      row.financialValues = parsed;
    }
    observed.push(row);
    return result;
  };
  const router = createRouter(config),
    generate = router.generate.bind(router);
  assert.deepEqual(
    router.adapters.map((a) => a.id),
    ["gemini", "groq"],
  );
  const providerBudget = capEvaluationRequests(router, 12);
  const feedbackDelivered: { tool: string; code: string; paths: string[] }[] =
    [];
  router.generate = async (...args) => {
    const last = args[0].messages.at(-1);
    if (
      last?.role === "tool" &&
      last.result.code === "INVALID_TOOL_ARGUMENTS"
    ) {
      const data = z
        .object({ validationIssues: z.array(z.object({ path: z.string() })) })
        .parse(last.result.data);
      feedbackDelivered.push({
        tool: last.name,
        code: last.result.code,
        paths: data.validationIssues.map((issue) => issue.path),
      });
    }
    if (last?.role === "tool" && last.result.code === "CONSTRAINT_CONFLICT") {
      const data = z
        .object({ fields: z.array(z.string()).optional() })
        .parse(last.result.data);
      feedbackDelivered.push({
        tool: last.name,
        code: last.result.code,
        paths: data.fields ?? [],
      });
    }
    return generate(...args);
  };
  const app = await buildServer({ config, tools, router });
  const evaluations: Record<string, unknown>[] = [];
  const providerFailures: z.infer<typeof ProviderFailure>[] = [];
  try {
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    const request = async (
      path: string,
      method = "GET",
      token?: string,
      payload?: unknown,
    ) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(125000),
      });
      lastHttp = response.status;
      return response;
    };
    const session = await request("/api/v1/dev/sessions", "POST", undefined, {
      acceptSyntheticDataPolicy: true,
    });
    assert.equal(session.status, 201);
    const { token } = z
      .object({ token: z.string() })
      .parse(await session.json());
    const conversation = await request(
      "/api/v1/conversations",
      "POST",
      token,
      {},
    );
    assert.equal(conversation.status, 201);
    const { id } = z
      .object({ id: z.string() })
      .parse(await conversation.json());
    for (const scenario of cases) {
      currentScenario = scenario;
      stage = scenario.id;
      const searchBefore = searchRequests,
        offset = observed.length,
        feedbackOffset = feedbackDelivered.length;
      const accepted = await request("/api/v1/agent/messages", "POST", token, {
        conversationId: id,
        content: scenario.content,
        locale: "ar-EG",
        clientRequestId: randomUUID(),
      });
      assert.equal(accepted.status, 202);
      const { runId } = z
        .object({ runId: z.string() })
        .parse(await accepted.json());
      const stream = await request(
        `/api/v1/agent/events/${runId}`,
        "GET",
        token,
      );
      assert.equal(stream.status, 200);
      const events = (await stream.text())
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map(
          (l) =>
            JSON.parse(l.slice(6)) as {
              type: string;
              textDelta?: string;
              safeStatus?: string;
            },
        );
      const failure = events.find(
        (e) => e.type === "run_failed" || e.type === "run_canceled",
      );
      const final = events.find((e) => e.type === "response_completed");
      const snapshot = await request(
        `/api/v1/agent/runs/${runId}`,
        "GET",
        token,
      );
      assert.equal(snapshot.status, 200);
      const state = z
        .object({
          providerFailures: z.array(ProviderFailure),
          travelContext: z
            .object({
              before: TravelState,
              proposed: TravelState,
              committed: z.boolean(),
            })
            .nullable(),
          sourceEvidence: z.array(
            z.object({
              url: z.string(),
              retrievedAt: z.string(),
              publicationEstimateAt: z.string().nullable(),
            }),
          ),
          usage: z.object({
            inputTokens: z.number(),
            outputTokens: z.number(),
          }),
        })
        .parse(await snapshot.json());
      providerFailures.push(...state.providerFailures);
      if (failure) throw new Error(failure.safeStatus ?? "RUN_FAILED");
      assert.ok(final?.textDelta);
      assert.ok(state.travelContext?.committed);
      assert.deepEqual(
        state.travelContext.proposed.constraints,
        scenario.expectedConstraints,
      );
      const actual = observed.slice(offset);
      for (const name of scenario.requiredTools)
        assert.ok(actual.some((t) => t.tool === name && t.status === "ok"));
      assert.ok(
        actual.every(
          (t, index) =>
            t.status === "ok" ||
            (t.status === "rejected" &&
              ["INVALID_TOOL_ARGUMENTS", "CONSTRAINT_CONFLICT"].includes(
                t.code ?? "",
              ) &&
              actual
                .slice(index + 1)
                .some((next) => next.tool === t.tool && next.status === "ok")),
        ),
      );
      if (scenario.requiresArabic)
        assert.match(final.textDelta, /[\u0600-\u06ff]/u);
      if (scenario.requiresSources) {
        assert.ok(state.sourceEvidence.length);
        assert.ok(
          state.sourceEvidence.some((s) => final.textDelta?.includes(s.url)),
        );
        assert.ok(searchRequests > searchBefore);
      } else {
        assert.equal(searchRequests, searchBefore);
        assert.ok(actual.some((t) => t.comparisonVerified));
      }
      evaluations.push({
        id: scenario.id,
        status: "PASS",
        actualTools: actual.map((t) => t.tool),
        rejectedProposals: actual.filter((t) => t.status === "rejected").length,
        actualToolSequence: actual,
        feedbackDelivered: feedbackDelivered.slice(feedbackOffset),
        searchRequests: searchRequests - searchBefore,
        sources: state.sourceEvidence,
        usage: state.usage,
        arabicScriptObserved: true,
        actualAnswer: final.textDelta,
        travelContext: state.travelContext,
      });
    }
    const report = {
      status: "REAL_M3_STRUCTURAL_EVALUATIONS_PASSED_PENDING_REVIEW",
      checkedAt: new Date().toISOString(),
      evaluated: cases.length,
      passed: evaluations.length,
      searchRequests,
      persistence: "ephemeral",
      supabaseAccess: false,
      credentialsDisplayed: false,
      providerFailures,
      providerBudget,
      providerFailureHandlingObservation: providerFailures.length
        ? "OBSERVED_REVIEW_TRACE"
        : "NOT_OBSERVED_OFFLINE_ONLY",
      recoveryObservation: feedbackDelivered.length
        ? "OBSERVED_REVIEW_TRACE"
        : "NOT_OBSERVED_OFFLINE_ONLY",
      naturalAnswerReview: "HUMAN_REVIEW_REQUIRED",
      evaluations,
      note: "Structural live checks, not a claim of comprehensive model quality or perfect Egyptian dialect. Search excerpts are untrusted; source publication dates may be unknown.",
    };
    writeFileSync(
      new URL(
        "../docs/reports/M3_HARDENING_LIVE_EVIDENCE.json",
        import.meta.url,
      ),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ ...report, evaluations: evaluations.map(({ actualAnswer, ...result }) => ({ ...result, actualAnswerLength: typeof actualAnswer === "string" ? actualAnswer.length : 0 })) }, null, 2)}\n`,
    );
  } catch (error) {
    const allowed = [
      "UNGROUNDED_RESPONSE",
      "PROVIDER_QUOTA",
      "PROVIDER_AUTH",
      "PROVIDER_TIMEOUT",
      "TURN_BUDGET",
      "SEARCH_QUOTA",
      "SEARCH_AUTH",
    ];
    const failure = {
      status: "FAILED",
      stage,
      lastHttp,
      code:
        error instanceof assert.AssertionError
          ? "EVALUATION_ASSERTION"
          : error instanceof Error && allowed.includes(error.message)
            ? error.message
            : "EVALUATION_FAILURE",
      searchRequests,
      observed,
      evaluated: evaluations.length,
      credentialsDisplayed: false,
      checkedAt: new Date().toISOString(),
      providerFailures,
      providerBudget,
      feedbackDelivered,
    };
    writeFileSync(
      new URL(
        "../docs/reports/M3_HARDENING_LIVE_EVIDENCE.json",
        import.meta.url,
      ),
      `${JSON.stringify({ ...failure, evaluations }, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}
