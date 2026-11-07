import { z } from "zod";
import type { Config } from "./config.js";

export type DataMode = "public_only" | "synthetic_only";
export function dataMode(config: Config): DataMode {
  return config.NODE_ENV === "test" ? "synthetic_only" : "public_only";
}
export function guestPolicy(config: Config) {
  const captcha = {
    captchaToken: z.string().trim().min(1).max(4000).optional(),
  };
  return config.NODE_ENV === "test"
    ? z.strictObject({ acceptSyntheticDataPolicy: z.literal(true), ...captcha })
    : z.strictObject({ acceptPublicDataPolicy: z.literal(true), ...captcha });
}
