import { createHash } from "node:crypto";
import {
  StoredConversation,
  StoredMemory,
  ToolExecution,
  TravelState,
} from "@sadeeman/contracts";
import { z } from "zod";
import { SafeError } from "../errors.js";
import type {
  ConsentInput,
  DatabaseAction,
  DatabaseTransport,
  Identity,
  MemoryInput,
  MemoryUpdate,
} from "./types.js";

export class Repository {
  constructor(
    private readonly transport: DatabaseTransport,
    readonly identity: Identity,
  ) {}
  private async call<T>(
    action: DatabaseAction,
    payload: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const raw = await this.transport.call(this.identity, action, payload);
    const result = schema.safeParse(raw);
    if (!result.success) throw new SafeError("DATABASE_UNAVAILABLE");
    return result.data;
  }
  createConversation() {
    return this.call("create_conversation", {}, z.object({ id: z.uuid() }));
  }
  listConversations() {
    return this.call(
      "list_conversations",
      {},
      z
        .array(
          z.object({
            id: z.uuid(),
            createdAt: z.string(),
            messageCount: z.number().int(),
          }),
        )
        .max(100),
    );
  }
  conversation(id: string) {
    return this.call("get_conversation", { id }, StoredConversation);
  }
  travelState(conversationId: string) {
    return this.call(
      "travel_profile_get",
      { conversationId },
      TravelState.nullable(),
    );
  }
  deleteConversation(id: string) {
    return this.call(
      "delete_conversation",
      { id },
      z.object({ deleted: z.literal(true) }),
    );
  }
  turn(conversationId: string, requestId: string) {
    return this.call(
      "get_turn",
      { conversationId, requestId },
      z
        .object({ runId: z.uuid(), answer: z.string(), inputHash: z.string() })
        .nullable(),
    );
  }
  commit(
    conversationId: string,
    requestId: string,
    runId: string,
    input: string,
    answer: string,
    usage: { inputTokens: number; outputTokens: number },
    toolExecutions: ToolExecution[] = [],
    travel?: { state: TravelState; expectedVersion: number },
  ) {
    return this.call(
      travel ? "commit_travel_turn" : "commit_turn_with_tools",
      {
        conversationId,
        requestId,
        runId,
        input,
        answer,
        usage,
        toolExecutions: z.array(ToolExecution).max(20).parse(toolExecutions),
        inputHash: createHash("sha256").update(input).digest("hex"),
        ...(travel
          ? {
              travelState: TravelState.parse(travel.state),
              expectedTravelVersion: travel.expectedVersion,
            }
          : {}),
      },
      z.object({ persisted: z.literal(true) }),
    );
  }
  saveTools(
    conversationId: string,
    runId: string,
    toolExecutions: ToolExecution[],
  ) {
    return this.call(
      "save_tool_executions",
      {
        conversationId,
        runId,
        toolExecutions: z.array(ToolExecution).max(20).parse(toolExecutions),
      },
      z.object({ persisted: z.literal(true) }),
    );
  }
  tools(conversationId: string) {
    return this.call(
      "list_tool_executions",
      { conversationId },
      z.array(ToolExecution.extend({ runId: z.uuid() })).max(200),
    );
  }
  consent(input: ConsentInput) {
    return this.call(
      "record_consent",
      input,
      z.object({
        id: z.uuid(),
        accepted: z.boolean(),
        active: z.boolean(),
        version: z.literal("memory-v1"),
      }),
    );
  }
  revokeConsent(id: string) {
    return this.call(
      "revoke_consent",
      { id },
      z.object({ revoked: z.literal(true) }),
    );
  }
  memories() {
    return this.call("list_memories", {}, z.array(StoredMemory).max(100));
  }
  saveMemory(input: MemoryInput) {
    return this.call("save_memory", input, StoredMemory);
  }
  updateMemory(id: string, input: MemoryUpdate) {
    return this.call("update_memory", { id, ...input }, StoredMemory);
  }
  deleteMemory(id: string) {
    return this.call(
      "delete_memory",
      { id },
      z.object({ deleted: z.literal(true) }),
    );
  }
  audit() {
    return this.call(
      "audit",
      {},
      z
        .array(
          z.object({
            action: z.string(),
            resourceId: z.uuid().nullable(),
            occurredAt: z.string(),
          }),
        )
        .max(100),
    );
  }
}
