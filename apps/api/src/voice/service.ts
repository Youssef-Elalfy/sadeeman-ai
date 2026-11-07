import { SpeakRequest, VoiceNote } from "@sadeeman/contracts";
import type { z } from "zod";
import { z as schema } from "zod";
import type { Config } from "../config.js";
import { providerError, SafeError } from "../errors.js";

export function validateAudio(bytes: Buffer, mime: string) {
  if (bytes.length < 12 || bytes.length > 5000000)
    throw new SafeError("INVALID_REQUEST", 400);
  const magic =
    mime === "audio/webm"
      ? bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      : mime === "audio/ogg"
        ? bytes.toString("ascii", 0, 4) === "OggS"
        : mime === "audio/wav"
          ? bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WAVE"
          : mime === "audio/mp4"
            ? bytes.toString("ascii", 4, 8) === "ftyp"
            : mime === "audio/mpeg"
              ? bytes.toString("ascii", 0, 3) === "ID3" ||
                (bytes[0] === 255 && ((bytes[1] ?? 0) & 224) === 224)
              : false;
  if (!magic) throw new SafeError("INVALID_REQUEST", 400);
}
async function boundedBody(response: Response, maximum: number) {
  if (!response.body) throw new SafeError("INVALID_MODEL_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > maximum) throw new SafeError("INVALID_MODEL_RESPONSE");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export function pcmWave(pcm: Buffer) {
  if (pcm.length % 2) throw new SafeError("INVALID_MODEL_RESPONSE");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
export class VoiceService {
  constructor(
    private readonly config: Config,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  capabilities() {
    return {
      recording: "browser_media_recorder",
      transcription:
        this.config.ENABLE_VOICE && Boolean(this.config.GROQ_API_KEY),
      speech: this.config.ENABLE_VOICE && Boolean(this.config.GEMINI_API_KEY),
      languages: ["ar", "en"],
      maxBytes: 5000000,
      maxRecordSeconds: 60,
      transcriptionStreaming: false,
      incrementalTranscription:
        this.config.ENABLE_VOICE && Boolean(this.config.GROQ_API_KEY),
      transcriptionTransport: "bounded_complete_segments",
      maxSegmentsPerTurn: 6,
      agentResponseStreaming: true,
      fullDuplex: false,
      audioRetention: "not_stored",
      liveVerified: false,
    };
  }
  async transcribe(raw: z.infer<typeof VoiceNote>, signal: AbortSignal) {
    const data = VoiceNote.parse(raw);
    if (!this.capabilities().transcription) throw new SafeError("DISCONNECTED");
    const bytes = Buffer.from(data.audioBase64, "base64");
    validateAudio(bytes, data.mime);
    const body = new FormData();
    body.set("model", this.config.GROQ_STT_MODEL);
    body.set(
      "file",
      new Blob([new Uint8Array(bytes)], { type: data.mime }),
      `voice.${data.mime.split("/")[1]}`,
    );
    body.set("response_format", "json");
    if (data.language) body.set("language", data.language);
    try {
      const res = await this.fetcher(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.config.GROQ_API_KEY}` },
          body,
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
          redirect: "error",
        },
      );
      if (!res.ok) {
        await res.body?.cancel();
        throw { status: res.status };
      }
      const result = schema
        .object({ text: schema.string().trim().max(16000) })
        .parse(JSON.parse((await boundedBody(res, 100000)).toString("utf8")));
      return {
        ...result,
        needsReview: true,
        provider: "groq",
        empty: !result.text,
      };
    } catch (error) {
      throw providerError(error, signal, {
        provider: "groq",
        model: this.config.GROQ_STT_MODEL,
        operation: "transcribe",
      });
    }
  }
  async speak(raw: z.infer<typeof SpeakRequest>, signal: AbortSignal) {
    const data = SpeakRequest.parse(raw);
    if (!this.capabilities().speech) throw new SafeError("DISCONNECTED");
    try {
      const res = await this.fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.GEMINI_TTS_MODEL)}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": this.config.GEMINI_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: data.text }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
              },
            },
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
          redirect: "error",
        },
      );
      if (!res.ok) {
        await res.body?.cancel();
        throw { status: res.status };
      }
      const response = schema
        .object({
          candidates: schema
            .array(
              schema.object({
                content: schema.object({
                  parts: schema.array(
                    schema.object({
                      inlineData: schema
                        .object({
                          mimeType: schema.string(),
                          data: schema.string().max(8000000),
                        })
                        .optional(),
                    }),
                  ),
                }),
              }),
            )
            .min(1),
        })
        .parse(JSON.parse((await boundedBody(res, 9000000)).toString("utf8")));
      const audio = response.candidates[0]?.content.parts.find(
        (p) => p.inlineData,
      )?.inlineData;
      if (!audio) throw new SafeError("INVALID_MODEL_RESPONSE");
      const bytes = Buffer.from(audio.data, "base64");
      if (bytes.length > 6000000) throw new SafeError("INVALID_MODEL_RESPONSE");
      if (audio.mimeType === "audio/wav") {
        validateAudio(bytes, "audio/wav");
        return bytes;
      }
      if (
        !/^audio\/(?:l16|pcm)(?:;.*)?$/i.test(audio.mimeType) ||
        (audio.mimeType.includes("rate=") &&
          !audio.mimeType.includes("rate=24000"))
      )
        throw new SafeError("INVALID_MODEL_RESPONSE");
      return pcmWave(bytes);
    } catch (error) {
      throw providerError(error, signal, {
        provider: "gemini",
        model: this.config.GEMINI_TTS_MODEL,
        operation: "synthesize",
      });
    }
  }
}
