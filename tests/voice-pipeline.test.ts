import { SpeakRequest, VoiceNote } from "@sadeeman/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  pcmWave,
  VoiceService,
  validateAudio,
} from "../apps/api/src/voice/service.js";
import { testConfig } from "./helpers.js";

const wav = pcmWave(Buffer.alloc(240));
describe("voice pipeline — provider transport mocked, no live accuracy claim", () => {
  it("validates MIME magic, payload limits and explicit consent", () => {
    expect(() =>
      validateAudio(Buffer.from("not an audio container"), "audio/wav"),
    ).toThrow();
    expect(() => validateAudio(wav, "audio/webm")).toThrow();
    expect(() => validateAudio(wav, "audio/wav")).not.toThrow();
    expect(() => validateAudio(Buffer.alloc(5000001), "audio/wav")).toThrow();
    expect(
      VoiceNote.safeParse({
        audioBase64: wav.toString("base64"),
        mime: "audio/wav",
        consent: false,
      }).success,
    ).toBe(false);
    expect(
      SpeakRequest.safeParse({
        text: "مرحبا",
        language: "ar",
        consent: true,
        apiKey: "NO",
      }).success,
    ).toBe(false);
  });
  it("sends bounded real Groq-compatible multipart shape and requires transcript review", async () => {
    const transport = vi.fn<typeof fetch>(async (url, options) => {
      expect(String(url)).toBe(
        "https://api.groq.com/openai/v1/audio/transcriptions",
      );
      expect(options?.body).toBeInstanceOf(FormData);
      const form = options?.body as FormData;
      expect(form.get("language")).toBe("ar");
      expect(form.get("model")).toBe("whisper-large-v3-turbo");
      return Response.json({ text: "عايز أسافر تركيا" });
    });
    const voice = new VoiceService(
      testConfig({ ENABLE_VOICE: true, GROQ_API_KEY: "TEST_ONLY" }),
      transport,
    );
    expect(
      await voice.transcribe(
        {
          audioBase64: wav.toString("base64"),
          mime: "audio/wav",
          language: "ar",
          consent: true,
        },
        new AbortController().signal,
      ),
    ).toMatchObject({ text: "عايز أسافر تركيا", needsReview: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("wraps actual PCM response bytes in a playable WAV container", async () => {
    const voice = new VoiceService(
      testConfig({ ENABLE_VOICE: true, GEMINI_API_KEY: "TEST_ONLY" }),
      async () =>
        Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/L16;rate=24000",
                      data: Buffer.alloc(100).toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
        }),
    );
    const audio = await voice.speak(
      { text: "أهلا بيك", language: "ar", consent: true },
      new AbortController().signal,
    );
    expect(audio.toString("ascii", 0, 4)).toBe("RIFF");
    expect(audio.readUInt32LE(24)).toBe(24000);
    expect(audio.length).toBe(144);
  });
  it("does not consume quota when disabled and reports unavailable features honestly", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const voice = new VoiceService(testConfig(), fetcher);
    await expect(
      voice.transcribe(
        {
          audioBase64: wav.toString("base64"),
          mime: "audio/wav",
          consent: true,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "DISCONNECTED" });
    expect(voice.capabilities()).toMatchObject({
      transcription: false,
      speech: false,
      transcriptionStreaming: false,
      fullDuplex: false,
      liveVerified: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500])(
    "categorizes provider HTTP %i without retry or leaking a response body",
    async (status) => {
      const f = vi.fn<typeof fetch>(
        async () => new Response("SECRET TEST BODY", { status }),
      );
      const v = new VoiceService(
        testConfig({ ENABLE_VOICE: true, GROQ_API_KEY: "TEST_ONLY" }),
        f,
      );
      await expect(
        v.transcribe(
          {
            audioBase64: wav.toString("base64"),
            mime: "audio/wav",
            consent: true,
          },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code:
          status === 401
            ? "PROVIDER_AUTH"
            : status === 429
              ? "PROVIDER_QUOTA"
              : "PROVIDER_UNAVAILABLE",
      });
      expect(f).toHaveBeenCalledTimes(1);
    },
  );
  it("passes cancellation through to the external request", async () => {
    const c = new AbortController();
    c.abort();
    let aborted = false;
    const v = new VoiceService(
      testConfig({ ENABLE_VOICE: true, GROQ_API_KEY: "TEST_ONLY" }),
      async (_, init) => {
        aborted = Boolean(init?.signal?.aborted);
        throw new Error("CANCELLED");
      },
    );
    await expect(
      v.transcribe(
        {
          audioBase64: wav.toString("base64"),
          mime: "audio/wav",
          consent: true,
        },
        c.signal,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(aborted).toBe(true);
  });
});
