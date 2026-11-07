import { z } from "zod";
export const VoiceNote = z.strictObject({
  audioBase64: z
    .string()
    .min(16)
    .max(7000000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  mime: z.enum([
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/mpeg",
    "audio/mp4",
  ]),
  language: z.enum(["ar", "en"]).optional(),
  consent: z.literal(true),
});
export const SpeakRequest = z.strictObject({
  text: z.string().trim().min(1).max(3000),
  language: z.enum(["ar", "en"]),
  consent: z.literal(true),
});
