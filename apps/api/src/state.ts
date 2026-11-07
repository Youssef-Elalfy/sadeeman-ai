import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  AgentEvent,
  ProviderFailure,
  ToolExecution,
  TravelState,
} from "@sadeeman/contracts";
import type { TurnBudgetReason } from "./agent/budget.js";
import { SafeError } from "./errors.js";
import type { ModelMessage } from "./providers/types.js";
import type { ResearchScope } from "./research/scope.js";
import type { TravelTurn } from "./travel/context.js";

export interface Conversation {
  id: string;
  ownerId: string;
  messages: ModelMessage[];
  busy: boolean;
  createdAt: string;
  travelState?: TravelState;
  research?: ResearchScope;
}
export interface Run {
  id: string;
  ownerId: string;
  conversationId: string;
  events: AgentEvent[];
  status: "running" | "completed" | "failed" | "canceled";
  controller: AbortController;
  listeners: Set<(event: AgentEvent) => void>;
  createdAt: number;
  usage: { inputTokens: number; outputTokens: number };
  toolExecutions: ToolExecution[];
  tracePersisted?: boolean;
  research?: ResearchScope;
  providerFailures?: ProviderFailure[];
  travelTurn?: TravelTurn;
  travelArtifacts?: { tool: string; data: unknown }[];
  budgetReason?: TurnBudgetReason;
}
interface Session {
  ownerId: string;
  expiresAt: number;
}
export class LocalState {
  private readonly sessions = new Map<string, Session>();
  private readonly conversations = new Map<string, Conversation>();
  private readonly runs = new Map<string, Run>();
  constructor(private readonly now: () => number = Date.now) {}
  private digest(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
  createSession(): {
    token: string;
    expiresAt: string;
    dataMode: "synthetic_only";
  } {
    this.sweep();
    if (this.sessions.size >= 100) throw new SafeError("CAPACITY", 429);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + 3600000;
    this.sessions.set(this.digest(token), { ownerId: randomUUID(), expiresAt });
    return {
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      dataMode: "synthetic_only",
    };
  }
  authenticate(authorization: string | undefined): string {
    this.sweep();
    if (!authorization?.startsWith("Bearer ") || authorization.length > 200)
      throw new SafeError("UNAUTHORIZED", 401);
    const session = this.sessions.get(this.digest(authorization.slice(7)));
    if (!session) throw new SafeError("UNAUTHORIZED", 401);
    return session.ownerId;
  }
  createConversation(ownerId: string): Conversation {
    if (
      [...this.conversations.values()].filter((c) => c.ownerId === ownerId)
        .length >= 20
    )
      throw new SafeError("CAPACITY", 429);
    const conversation: Conversation = {
      id: randomUUID(),
      ownerId,
      messages: [],
      busy: false,
      createdAt: new Date(this.now()).toISOString(),
    };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }
  restoreConversation(
    record: {
      id: string;
      createdAt: string;
      messages: { role: "user" | "assistant"; content: string }[];
    },
    ownerId: string,
  ): Conversation {
    const existing = this.conversations.get(record.id);
    if (!existing && this.conversations.size >= 1000)
      throw new SafeError("CAPACITY", 429);
    if (existing) {
      if (existing.ownerId !== ownerId) throw new SafeError("NOT_FOUND", 404);
      if (existing.busy) return existing;
    }
    const conversation: Conversation = {
      id: record.id,
      ownerId,
      createdAt: record.createdAt,
      busy: false,
      messages: record.messages.map((m) =>
        m.role === "user"
          ? { role: "user", content: m.content }
          : { role: "assistant", content: m.content, toolCalls: [] },
      ),
      ...(existing?.travelState ? { travelState: existing.travelState } : {}),
      ...(existing?.research ? { research: existing.research } : {}),
    };
    this.conversations.set(record.id, conversation);
    return conversation;
  }
  listConversations(
    ownerId: string,
  ): { id: string; createdAt: string; messageCount: number }[] {
    return [...this.conversations.values()]
      .filter((c) => c.ownerId === ownerId)
      .map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
        messageCount: c.messages.filter((m) => m.role !== "tool").length,
      }));
  }
  conversation(id: string, ownerId: string): Conversation {
    const conversation = this.conversations.get(id);
    if (!conversation || conversation.ownerId !== ownerId)
      throw new SafeError("NOT_FOUND", 404);
    return conversation;
  }
  createRun(conversation: Conversation): Run {
    this.sweep();
    if (conversation.busy) throw new SafeError("CONFLICT", 409);
    if (
      [...this.runs.values()].filter((r) => r.ownerId === conversation.ownerId)
        .length >= 100
    )
      throw new SafeError("CAPACITY", 429);
    conversation.busy = true;
    const run: Run = {
      id: randomUUID(),
      conversationId: conversation.id,
      ownerId: conversation.ownerId,
      events: [],
      status: "running",
      controller: new AbortController(),
      listeners: new Set(),
      createdAt: this.now(),
      usage: { inputTokens: 0, outputTokens: 0 },
      toolExecutions: [],
    };
    this.runs.set(run.id, run);
    return run;
  }
  run(id: string, ownerId: string): Run {
    const run = this.runs.get(id);
    if (!run || run.ownerId !== ownerId) throw new SafeError("NOT_FOUND", 404);
    return run;
  }
  sweep(): void {
    for (const [key, session] of this.sessions) {
      if (session.expiresAt > this.now()) continue;
      for (const [id, run] of this.runs)
        if (run.ownerId === session.ownerId) {
          run.controller.abort();
          this.runs.delete(id);
        }
      for (const [id, conversation] of this.conversations)
        if (conversation.ownerId === session.ownerId)
          this.conversations.delete(id);
      this.sessions.delete(key);
    }
    for (const [id, run] of this.runs)
      if (run.status !== "running" && run.createdAt + 900000 < this.now())
        this.runs.delete(id);
  }
  close(): void {
    for (const run of this.runs.values()) run.controller.abort();
    this.sessions.clear();
    this.runs.clear();
    this.conversations.clear();
  }
  cancelOwner(ownerId: string): void {
    // Used by logout and memory/consent privacy changes. Never retain a
    // derived research query/cache after its contributing consent is removed.
    for (const conversation of this.conversations.values())
      if (conversation.ownerId === ownerId) delete conversation.research;
    for (const run of this.runs.values())
      if (run.ownerId === ownerId && run.status === "running")
        run.controller.abort();
  }
}
