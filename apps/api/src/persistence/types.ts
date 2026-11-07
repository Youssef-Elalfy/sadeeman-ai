import type {
  MemoryConsent,
  SaveMemory,
  StoredConversation,
  StoredMemory,
  UpdateMemory,
} from "@sadeeman/contracts";
import type { z } from "zod";

export interface Identity {
  ownerId: string;
  token: string;
}
export interface SessionResult {
  token: string;
  expiresAt: string;
  dataMode: "synthetic_only" | "public_only";
  refreshToken?: string;
}
export interface AuthStore {
  authenticate(header: string | undefined): Promise<Identity>;
  guest(captchaToken?: string): Promise<SessionResult>;
  revoke(identity: Identity): Promise<void>;
  signIn?(email: string, password: string): Promise<SessionResult>;
  refresh?(token: string): Promise<SessionResult>;
}
export type DatabaseAction =
  | "catalog_search"
  | "catalog_get"
  | "travel_profile_get"
  | "commit_travel_turn"
  | "identity"
  | "revoke_session"
  | "create_conversation"
  | "list_conversations"
  | "get_conversation"
  | "delete_conversation"
  | "commit_turn"
  | "commit_turn_with_tools"
  | "save_tool_executions"
  | "list_tool_executions"
  | "get_turn"
  | "record_consent"
  | "revoke_consent"
  | "list_memories"
  | "save_memory"
  | "update_memory"
  | "delete_memory"
  | "audit";
export interface DatabaseTransport {
  call(
    identity: Identity,
    action: DatabaseAction,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
  close(): Promise<void>;
}
export type ConversationRecord = z.infer<typeof StoredConversation>;
export type MemoryRecord = z.infer<typeof StoredMemory>;
export type ConsentInput = z.infer<typeof MemoryConsent>;
export type MemoryInput = z.infer<typeof SaveMemory>;
export type MemoryUpdate = z.infer<typeof UpdateMemory>;
export interface Persistence {
  mode: "local" | "supabase";
  auth: AuthStore;
  transport: DatabaseTransport;
}
