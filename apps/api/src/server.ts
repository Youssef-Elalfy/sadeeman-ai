import { createHash, randomUUID } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import { AgentEvent, ResourceId, SendMessage } from "@sadeeman/contracts";
import Fastify from "fastify";
import { z } from "zod";
import { AgentRuntime } from "./agent/runtime.js";
import { type Config, loadConfig } from "./config.js";
import { dataMode, guestPolicy } from "./data-policy.js";
import { SafeError } from "./errors.js";
import { Repository } from "./persistence/repository.js";
import { registerPersistenceRoutes } from "./persistence/routes.js";
import { createPersistence } from "./persistence/supabase.js";
import type { Identity, Persistence } from "./persistence/types.js";
import { ProviderAdmission } from "./provider-admission.js";
import { createRouter, type ModelRouter } from "./providers/router.js";
import { TravelIntelligence } from "./research/travel.js";
import { LocalState } from "./state.js";
import { createTools, type ToolRegistry } from "./tools/registry.js";
import { PersistentCompanyCatalog } from "./travel/catalog.js";
import { emptyTravelState } from "./travel/context.js";
import { registerVoice } from "./voice/routes.js";
import { VoiceService } from "./voice/service.js";

/**
 * Exact configured origin, plus its loopback twin. `next dev --hostname 127.0.0.1`
 * prints http://127.0.0.1:3000 while WEB_ORIGIN commonly says localhost:3000; the
 * browser only sends Origin on POST/PATCH/DELETE, so a mismatch broke every write
 * (guest entry first) while GET /health still looked healthy. Only the same scheme
 * and port on a loopback host are added — never a wildcard or a remote host.
 */
export function trustedOrigins(configured: string): Set<string> {
  const origins = new Set([configured]);
  const url = new URL(configured);
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  if (loopback.includes(url.hostname))
    for (const host of loopback)
      origins.add(`${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`);
  return origins;
}

export async function buildServer(
  options: {
    config?: Config;
    router?: ModelRouter;
    tools?: ToolRegistry;
    state?: LocalState;
    persistence?: Persistence;
  } = {},
) {
  const config = options.config ?? loadConfig();
  const state = options.state ?? new LocalState();
  const admission = new ProviderAdmission(
    {
      agent: config.MAX_AGENT_REQUESTS_PER_HOUR,
      voice: config.MAX_VOICE_REQUESTS_PER_HOUR,
      guest: config.MAX_GUESTS_PER_HOUR,
    },
    config.MAX_CONCURRENT_PROVIDER_OPERATIONS,
  );
  const persistence = options.persistence ?? (await createPersistence(config));
  const runtime = new AgentRuntime(
    options.router ?? createRouter(config),
    options.tools ??
      createTools(
        config.ENABLE_COMPANY_CATALOG && persistence
          ? new PersistentCompanyCatalog(persistence.transport)
          : undefined,
        config.ENABLE_TRAVEL_RESEARCH
          ? new TravelIntelligence(config)
          : undefined,
        config.ENABLE_TRAVEL_CONTEXT,
      ),
    config,
  );
  // No request, authorization header, body, prompt or raw provider error logging.
  const app = Fastify({
    logger: false,
    // Only the attachment/voice routes need their explicit larger limits.
    // Keep auth, consent and ordinary JSON endpoints small by default.
    bodyLimit: 64000,
    requestTimeout: 10000,
    routerOptions: { maxParamLength: 100 },
    // Deliberately false: forwarded headers are spoofable, and the guest/login
    // limits must not be resettable. Behind a real proxy in production, key the
    // limiter on a verified client address instead (tracked in KNOWN_ISSUES).
    trustProxy: false,
  });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
  });
  const sweep = setInterval(() => state.sweep(), 60000);
  sweep.unref();
  app.addHook("onClose", async () => {
    clearInterval(sweep);
    state.close();
    await persistence?.transport.close();
  });
  const allowedOrigins = trustedOrigins(config.WEB_ORIGIN);
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin))
      throw new SafeError("FORBIDDEN_ORIGIN", 403);
    if (origin) {
      reply
        .header("Access-Control-Allow-Origin", origin)
        .header("Vary", "Origin");
      reply.header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, Last-Event-ID",
      );
      reply.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, DELETE, OPTIONS",
      );
    }
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    if (request.method === "OPTIONS") return reply.code(204).send();
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SafeError)
      return reply.code(error.status).send({ error: error.code });
    if (error instanceof z.ZodError)
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    const status =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    return reply.code(status >= 400 && status < 500 ? status : 500).send({
      error:
        status === 429
          ? "RATE_LIMITED"
          : status === 413
            ? "REQUEST_TOO_LARGE"
            : status < 500
              ? "INVALID_REQUEST"
              : "INTERNAL_ERROR",
    });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: "NOT_FOUND" }),
  );
  const principal = async (
    authorization: string | undefined,
  ): Promise<Identity> =>
    persistence
      ? persistence.auth.authenticate(authorization)
      : {
          ownerId: state.authenticate(authorization),
          token: authorization?.slice(7) ?? "",
        };
  const owner = async (authorization: string | undefined) =>
    (await principal(authorization)).ownerId;
  registerPersistenceRoutes(
    app,
    persistence,
    principal,
    (ownerId) => state.cancelOwner(ownerId),
    config,
    admission,
  );
  registerVoice(app, new VoiceService(config), principal, admission);
  app.get("/api/v1/providers", async (request) => {
    await principal(request.headers.authorization);
    return runtime.providerStatuses();
  });

  app.get("/api/v1/health", async () => ({
    service: "SADEEMAN AI",
    status: "ok",
    model: runtime.configured ? "configured_not_verified" : "disconnected",
    persistence: persistence?.mode ?? "ephemeral",
    catalog:
      config.ENABLE_COMPANY_CATALOG && persistence
        ? "database_connected_not_inventory_verified"
        : "unavailable",
    travelContext: config.ENABLE_TRAVEL_CONTEXT
      ? config.ENABLE_TRAVEL_CONTEXT_PERSISTENCE && persistence
        ? "durable"
        : "session_only"
      : "disabled",
    research:
      config.ENABLE_TRAVEL_RESEARCH && config.TAVILY_API_KEY
        ? "configured_not_verified"
        : "disconnected",
    voice: config.ENABLE_VOICE,
    realtimeVoice: false,
    dataMode: dataMode(config),
  }));
  app.post("/api/v1/dev/sessions", async (request, reply) => {
    if (config.NODE_ENV === "production") throw new SafeError("NOT_FOUND", 404);
    // This entrypoint grants local synthetic dev access, never a production identity.
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip))
      throw new SafeError("UNAUTHORIZED", 403);
    const host = request.headers.host ?? "";
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(host))
      throw new SafeError("UNAUTHORIZED", 403);
    guestPolicy(config).parse(request.body);
    if (persistence?.mode === "supabase") throw new SafeError("DISCONNECTED");
    return reply.code(201).send({
      ...(persistence ? await persistence.auth.guest() : state.createSession()),
      dataMode: dataMode(config),
    });
  });
  app.post("/api/v1/conversations", async (request, reply) => {
    const identity = await principal(request.headers.authorization);
    const ownerId = identity.ownerId;
    z.strictObject({}).parse(request.body ?? {});
    if (persistence) {
      const conversation = await new Repository(
        persistence.transport,
        identity,
      ).createConversation();
      return reply
        .code(201)
        .send({ id: conversation.id, persistence: persistence.mode });
    }
    const conversation = state.createConversation(ownerId);
    return reply
      .code(201)
      .send({ id: conversation.id, persistence: "ephemeral" });
  });
  app.get("/api/v1/conversations", async (request) => {
    const identity = await principal(request.headers.authorization);
    return persistence
      ? new Repository(persistence.transport, identity).listConversations()
      : state.listConversations(identity.ownerId);
  });
  app.get("/api/v1/conversations/:id", async (request) => {
    const identity = await principal(request.headers.authorization);
    const ownerId = identity.ownerId;
    const { id } = ResourceId.parse(request.params);
    if (persistence)
      return {
        ...(await new Repository(persistence.transport, identity).conversation(
          id,
        )),
        persistence: persistence.mode,
      };
    const conversation = state.conversation(id, ownerId);
    return {
      id,
      persistence: "ephemeral",
      messages: conversation.messages
        .filter((m) => m.role !== "tool")
        .map((m) => ({
          role: m.role,
          content: "content" in m ? m.content : "",
        })),
    };
  });
  app.post(
    "/api/v1/agent/messages",
    { bodyLimit: 6000000 },
    async (request, reply) => {
      const identity = await principal(request.headers.authorization);
      const ownerId = identity.ownerId;
      const body = SendMessage.parse(request.body);
      const attachments = (body.attachments ?? []).map((file) => {
        const bytes = Buffer.from(file.dataBase64, "base64");
        // Trust the actual bytes, not the declared type or the file name.
        const head = bytes.subarray(0, 12);
        const real = head
          .subarray(0, 4)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
          ? "image/png"
          : head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
            ? "image/jpeg"
            : head.subarray(0, 4).toString("latin1") === "RIFF" &&
                head.subarray(8, 12).toString("latin1") === "WEBP"
              ? "image/webp"
              : head.subarray(0, 5).toString("latin1") === "%PDF-"
                ? "application/pdf"
                : "";
        if (!real || real !== file.mime || bytes.length > 4000000)
          throw new SafeError("INVALID_REQUEST", 400);
        return { mime: real, data: file.dataBase64 };
      });
      const repository = persistence
        ? new Repository(persistence.transport, identity)
        : undefined;
      const record = await repository?.conversation(body.conversationId);
      const conversation = record
        ? state.restoreConversation(record, ownerId)
        : state.conversation(body.conversationId, ownerId);
      if (
        config.ENABLE_TRAVEL_CONTEXT_PERSISTENCE &&
        repository &&
        !conversation.busy
      )
        conversation.travelState =
          (await repository.travelState(body.conversationId)) ??
          emptyTravelState();
      const requestId = body.clientRequestId ?? randomUUID();
      if (repository && body.clientRequestId) {
        const previous = await repository.turn(body.conversationId, requestId);
        if (previous) {
          if (
            previous.inputHash !==
            createHash("sha256").update(body.content).digest("hex")
          )
            throw new SafeError("IDEMPOTENCY_CONFLICT", 409);
          return reply.send({
            status: "already_completed",
            runId: previous.runId,
            answer: previous.answer,
            persisted: true,
          });
        }
      }
      if (!runtime.configured)
        return reply.code(503).send({ error: "DISCONNECTED", retryable: true });
      // All errors become safe terminal events inside runtime; no synthetic replies.
      const memories = await repository?.memories();
      const release = admission.acquire("agent");
      let run: ReturnType<LocalState["createRun"]>;
      try {
        run = state.createRun(conversation);
      } catch (error) {
        release();
        throw error;
      }
      const context = record
        ? JSON.stringify({
            summaryKind: record.summaryKind,
            summary: record.summary,
            optedInPreferences: memories ?? [],
          }).slice(0, 6000)
        : undefined;
      void runtime
        .execute(
          run,
          conversation,
          body.content,
          body.locale,
          repository
            ? {
                persistent: true,
                identity,
                beforeComplete: async (answer) => {
                  await repository.commit(
                    conversation.id,
                    requestId,
                    run.id,
                    body.content,
                    answer,
                    run.usage,
                    run.toolExecutions,
                    config.ENABLE_TRAVEL_CONTEXT_PERSISTENCE &&
                      run.travelTurn?.dirty
                      ? {
                          state: {
                            ...run.travelTurn.draft,
                            version: run.travelTurn.base.version + 1,
                          },
                          expectedVersion: run.travelTurn.base.version,
                        }
                      : undefined,
                  );
                  run.tracePersisted = true;
                },
                afterFailure: async () => {
                  await repository.saveTools(
                    conversation.id,
                    run.id,
                    run.toolExecutions,
                  );
                },
                ...(context ? { context } : {}),
                ...(attachments.length ? { attachments } : {}),
              }
            : { identity, ...(attachments.length ? { attachments } : {}) },
        )
        .finally(release);
      return reply.code(202).send({
        runId: run.id,
        conversationId: conversation.id,
        status: "accepted",
        clientRequestId: requestId,
      });
    },
  );
  app.get("/api/v1/agent/runs/:id", async (request) => {
    const ownerId = await owner(request.headers.authorization);
    const { id } = ResourceId.parse(request.params);
    const run = state.run(id, ownerId);
    return {
      id: run.id,
      status: run.status,
      events: run.events,
      usage: run.usage,
      budgetReason: run.budgetReason ?? null,
      tracePersisted: run.tracePersisted ?? false,
      providerFailures: run.providerFailures ?? [],
      travelContext: run.travelTurn
        ? {
            before: run.travelTurn.base,
            proposed: run.travelTurn.draft,
            committed: run.status === "completed" && run.travelTurn.dirty,
          }
        : null,
      travelArtifacts:
        run.status === "completed" ? (run.travelArtifacts ?? []) : [],
      sourceEvidence: run.research ? [...run.research.sources.values()] : [],
    };
  });
  app.delete("/api/v1/agent/runs/:id", async (request, reply) => {
    const ownerId = await owner(request.headers.authorization);
    const { id } = ResourceId.parse(request.params);
    const run = state.run(id, ownerId);
    if (run.status !== "running") throw new SafeError("CONFLICT", 409);
    run.controller.abort();
    return reply.code(202).send({ status: "cancel_requested" });
  });
  app.get("/api/v1/agent/events/:id", async (request, reply) => {
    const ownerId = await owner(request.headers.authorization);
    const { id } = ResourceId.parse(request.params);
    const run = state.run(id, ownerId);
    if (run.listeners.size >= 2) throw new SafeError("CAPACITY", 429);
    const last = request.headers["last-event-id"];
    if (
      last &&
      (typeof last !== "string" ||
        !run.events.some((event) => event.eventId === last))
    )
      throw new SafeError("INVALID_REQUEST", 400);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(request.headers.origin && allowedOrigins.has(request.headers.origin)
        ? {
            "Access-Control-Allow-Origin": request.headers.origin,
            Vary: "Origin",
          }
        : {}),
    });
    const terminal = (event: AgentEvent) =>
      ["response_completed", "run_failed", "run_canceled"].includes(event.type);
    const send = (raw: AgentEvent) => {
      const event = AgentEvent.parse(raw);
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      if (reply.raw.writableLength > 64000) {
        reply.raw.destroy();
        return;
      }
      reply.raw.write(
        `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
      if (terminal(event)) reply.raw.end();
    };
    const after = last
      ? run.events.findIndex((event) => event.eventId === last) + 1
      : 0;
    // Replay + subscribe is synchronous: no event may fall between these steps.
    for (const event of run.events.slice(after)) send(event);
    if (run.status !== "running") {
      reply.raw.end();
      return;
    }
    run.listeners.add(send);
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(": keepalive\n\n");
    }, 15000);
    const timeout = setTimeout(
      () => reply.raw.end(),
      config.TURN_TIMEOUT_MS + 1000,
    );
    reply.raw.on("close", () => {
      run.listeners.delete(send);
      clearInterval(heartbeat);
      clearTimeout(timeout);
    });
  });
  return app;
}
