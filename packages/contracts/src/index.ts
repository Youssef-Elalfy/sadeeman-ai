import { z } from "zod";

export * from "./company.js";
export * from "./diagnostics.js";
export * from "./travel.js";

export const Locale = z.enum(["ar-EG", "ar", "en"]);
export const SendMessage = z.strictObject({
  clientRequestId: z.uuid().optional(),
  conversationId: z.uuid(),
  content: z.string().trim().min(1).max(16000),
  locale: Locale.default("ar-EG"),
  /** One image or PDF per turn, base64 (≤ 4 MB decoded); never persisted. */
  attachments: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(200),
        mime: z.enum([
          "image/png",
          "image/jpeg",
          "image/webp",
          "application/pdf",
        ]),
        dataBase64: z
          .string()
          .min(8)
          .max(5600000)
          .regex(/^[A-Za-z0-9+/]+=*$/),
      }),
    )
    .max(1)
    .optional(),
});
export const ResourceId = z.strictObject({ id: z.uuid() });
export const Evidence = z.enum([
  "company_demo",
  "company_verified",
  "external_listing",
  "supplier_live_inventory",
  "estimated_itinerary",
  "general_information",
  "unavailable",
]);
export const AgentEvent = z.strictObject({
  eventId: z.uuid(),
  runId: z.uuid(),
  conversationId: z.uuid(),
  occurredAt: z.iso.datetime(),
  type: z.enum([
    "run_started",
    "model_processing",
    "tool_started",
    "tool_completed",
    "tool_failed",
    "response_completed",
    "response_delta",
    "run_failed",
    "run_canceled",
  ]),
  toolName: z.string().max(80).optional(),
  safeStatus: z.string().max(120).optional(),
  textDelta: z.string().max(24000).optional(),
});

export const MemoryCategory = z.enum([
  "travel_style",
  "destination",
  "accessibility",
  "budget",
  "language",
]);
export const MemoryConsent = z.strictObject({
  purpose: z.literal("travel_preferences"),
  accepted: z.boolean(),
  version: z.literal("memory-v1"),
  requestId: z.uuid(),
});
export const SaveMemory = z.strictObject({
  consentId: z.uuid(),
  category: MemoryCategory,
  content: z.string().trim().min(1).max(500),
  sourceConversationId: z.uuid(),
  expiresInDays: z.number().int().min(1).max(365).default(90),
  requestId: z.uuid(),
});
export const UpdateMemory = SaveMemory.omit({
  sourceConversationId: true,
}).extend({
  expectedVersion: z.number().int().min(1),
});
export const StoredMemory = z.object({
  id: z.uuid(),
  consentId: z.uuid(),
  category: MemoryCategory,
  content: z.string().max(500),
  sourceConversationId: z.uuid(),
  expiresAt: z.string(),
  version: z.number().int(),
});
export const StoredConversation = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  summary: z.string().max(4000),
  summaryKind: z.literal("extractive"),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(24000),
      }),
    )
    .max(40),
});
export type AgentEvent = z.infer<typeof AgentEvent>;
export const ToolCall = z.strictObject({
  id: z.string().min(1).max(160),
  name: z.string().regex(/^[a-z_]{1,80}$/),
  arguments: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCall>;
export const ToolResult = z.strictObject({
  status: z.enum(["ok", "unavailable", "rejected", "failed"]),
  evidence: Evidence,
  data: z.unknown().optional(),
  code: z.string().max(80).optional(),
});
export type ToolResult = z.infer<typeof ToolResult>;
export const ToolExecution = z.strictObject({
  callId: z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/),
  toolName: z.string().regex(/^[a-z_]{1,80}$/),
  status: z.enum(["ok", "unavailable", "rejected", "failed"]),
  resultCode: z
    .string()
    .regex(/^[A-Z_]{1,80}$/)
    .nullable(),
  durationMs: z.number().int().min(0).max(120000),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type ToolExecution = z.infer<typeof ToolExecution>;
export const ModelOutput = z.strictObject({
  text: z.string().max(24000),
  toolCalls: z.array(ToolCall).max(4),
  usage: z.strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});
export type ModelOutput = z.infer<typeof ModelOutput>;
export const PackageQuery = z.strictObject({
  cheaperThanOption: z.number().int().min(1).max(20).optional(),
  destination: z.string().trim().min(1).max(120).optional(),
  days: z.number().int().min(1).max(90).optional(),
  maxPricePerAdult: z.number().nonnegative().max(10000000).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
});
export const BudgetInput = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  items: z
    .array(
      z.strictObject({
        label: z.string().trim().min(1).max(100),
        unitAmountMinor: z.number().int().min(0).max(1000000000),
        quantity: z.number().int().min(1).max(1000),
      }),
    )
    .min(1)
    .max(30),
  assumptions: z.array(z.string().max(200)).min(1).max(10),
});

export * from "./voice.js";
