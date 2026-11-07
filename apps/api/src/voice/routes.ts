import { SpeakRequest, VoiceNote } from "@sadeeman/contracts";
import type { FastifyInstance } from "fastify";
import type { Identity } from "../persistence/types.js";
import type { VoiceService } from "./service.js";
export function registerVoice(
  app: FastifyInstance,
  voice: VoiceService,
  principal: (header: string | undefined) => Promise<Identity>,
) {
  app.get("/api/v1/voice/capabilities", async (req) => {
    await principal(req.headers.authorization);
    return voice.capabilities();
  });
  app.post(
    "/api/v1/voice/transcribe",
    {
      bodyLimit: 7500000,
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      await principal(req.headers.authorization);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      req.raw.once("aborted", cancel);
      reply.raw.once("close", cancel);
      try {
        return await voice.transcribe(
          VoiceNote.parse(req.body),
          controller.signal,
        );
      } finally {
        req.raw.off("aborted", cancel);
        reply.raw.off("close", cancel);
      }
    },
  );
  app.post(
    "/api/v1/voice/speak",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (req, reply) => {
      await principal(req.headers.authorization);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      req.raw.once("aborted", cancel);
      reply.raw.once("close", cancel);
      try {
        const audio = await voice.speak(
          SpeakRequest.parse(req.body),
          controller.signal,
        );
        return reply
          .header("Cache-Control", "no-store")
          .header("Content-Disposition", 'inline; filename="sadeeman.wav"')
          .type("audio/wav")
          .send(audio);
      } finally {
        req.raw.off("aborted", cancel);
        reply.raw.off("close", cancel);
      }
    },
  );
}
