import {
  MemoryConsent,
  ResourceId,
  SaveMemory,
  UpdateMemory,
} from "@sadeeman/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { dataMode, guestPolicy } from "../data-policy.js";
import { SafeError } from "../errors.js";
import type { ProviderAdmission } from "../provider-admission.js";
import { Repository } from "./repository.js";
import type { Identity, Persistence } from "./types.js";

export function registerPersistenceRoutes(
  app: FastifyInstance,
  persistence: Persistence | undefined,
  principal: (header: string | undefined) => Promise<Identity>,
  onPrivacyChange: (ownerId: string) => void,
  config: Config,
  admission?: ProviderAdmission,
) {
  const repo = async (header: string | undefined) => {
    const identity = await principal(header);
    if (!persistence) throw new SafeError("DISCONNECTED");
    return new Repository(persistence.transport, identity);
  };
  app.post(
    "/api/v1/auth/guest",
    {
      config: {
        rateLimit: { max: config.GUEST_RATE_LIMIT_MAX, timeWindow: "1 hour" },
      },
    },
    async (request, reply) => {
      const input = guestPolicy(config).parse(request.body);
      if (
        config.PERSISTENCE_MODE === "supabase" &&
        config.REQUIRE_GUEST_CAPTCHA &&
        !input.captchaToken
      )
        throw new SafeError("INVALID_REQUEST", 400);
      if (!persistence) throw new SafeError("DISCONNECTED");
      const release = admission?.acquire("guest");
      try {
        return reply.code(201).send({
          ...(await persistence.auth.guest(input.captchaToken)),
          dataMode: dataMode(config),
        });
      } finally {
        release?.();
      }
    },
  );
  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request) => {
      const input = z
        .strictObject({
          email: z.email().max(200),
          password: z.string().min(1).max(200),
        })
        .parse(request.body);
      if (!persistence?.auth.signIn) throw new SafeError("DISCONNECTED");
      return persistence.auth.signIn(input.email, input.password);
    },
  );
  app.get("/api/v1/auth/session", async (request) => {
    const identity = await principal(request.headers.authorization);
    return {
      ownerId: identity.ownerId,
      persistence: persistence?.mode ?? "ephemeral",
      dataMode: dataMode(config),
    };
  });
  app.delete("/api/v1/auth/session", async (request, reply) => {
    const identity = await principal(request.headers.authorization);
    if (!persistence) throw new SafeError("DISCONNECTED");
    await persistence.auth.revoke(identity);
    onPrivacyChange(identity.ownerId);
    return reply.code(204).send();
  });
  app.post("/api/v1/auth/refresh", async (request) => {
    const input = z
      .strictObject({ refreshToken: z.string().min(1).max(12000) })
      .parse(request.body);
    if (!persistence?.auth.refresh) throw new SafeError("DISCONNECTED");
    return persistence.auth.refresh(input.refreshToken);
  });
  app.post("/api/v1/consents", async (request, reply) => {
    const repository = await repo(request.headers.authorization),
      input = MemoryConsent.parse(request.body);
    const result = await repository.consent(input);
    if (!input.accepted) onPrivacyChange(repository.identity.ownerId);
    return reply.code(201).send(result);
  });
  app.delete("/api/v1/consents/:id", async (request) => {
    const repository = await repo(request.headers.authorization);
    const result = await repository.revokeConsent(
      ResourceId.parse(request.params).id,
    );
    onPrivacyChange(repository.identity.ownerId);
    return result;
  });
  app.get("/api/v1/memory", async (request) =>
    (await repo(request.headers.authorization)).memories(),
  );
  app.post("/api/v1/memory", async (request, reply) =>
    reply
      .code(201)
      .send(
        await (await repo(request.headers.authorization)).saveMemory(
          SaveMemory.parse(request.body),
        ),
      ),
  );
  app.patch("/api/v1/memory/:id", async (request) => {
    const repository = await repo(request.headers.authorization);
    const result = await repository.updateMemory(
      ResourceId.parse(request.params).id,
      UpdateMemory.parse(request.body),
    );
    onPrivacyChange(repository.identity.ownerId);
    return result;
  });
  app.delete("/api/v1/memory/:id", async (request) => {
    const repository = await repo(request.headers.authorization);
    const result = await repository.deleteMemory(
      ResourceId.parse(request.params).id,
    );
    onPrivacyChange(repository.identity.ownerId);
    return result;
  });
  app.get("/api/v1/audit", async (request) =>
    (await repo(request.headers.authorization)).audit(),
  );
  app.get("/api/v1/conversations/:id/tools", async (request) =>
    (await repo(request.headers.authorization)).tools(
      ResourceId.parse(request.params).id,
    ),
  );
  app.delete("/api/v1/conversations/:id", async (request) => {
    const repository = await repo(request.headers.authorization);
    const result = await repository.deleteConversation(
      ResourceId.parse(request.params).id,
    );
    onPrivacyChange(repository.identity.ownerId);
    return result;
  });
}
