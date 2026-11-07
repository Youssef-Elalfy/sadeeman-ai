import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Config } from "../config.js";
import { dataMode } from "../data-policy.js";
import { SafeError } from "../errors.js";
import { databaseFailure } from "./local.js";
import type {
  AuthStore,
  DatabaseAction,
  DatabaseTransport,
  Identity,
  Persistence,
  SessionResult,
} from "./types.js";

// Publishable key + verified user JWT for every data operation. No service-role client exists.
export class SupabaseDatabase implements AuthStore, DatabaseTransport {
  constructor(
    private readonly config: Config,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private client(token?: string): SupabaseClient {
    return createClient(
      this.config.SUPABASE_URL,
      this.config.SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          fetch: (url, options) =>
            this.fetcher(url, {
              ...options,
              redirect: "error",
              signal: AbortSignal.any([
                ...(options?.signal ? [options.signal] : []),
                AbortSignal.timeout(10000),
              ]),
            }),
        },
      },
    );
  }
  async authenticate(header: string | undefined): Promise<Identity> {
    if (!header?.startsWith("Bearer ") || header.length > 12000)
      throw new SafeError("UNAUTHORIZED", 401);
    const token = header.slice(7);
    const { data, error } = await this.client().auth.getUser(token);
    if (error || !data.user) throw new SafeError("UNAUTHORIZED", 401);
    const identity = { ownerId: z.uuid().parse(data.user.id), token };
    // Database checks durable application-session revocation, including refreshed tokens with the same session_id.
    const record = z
      .object({ ownerId: z.uuid() })
      .safeParse(await this.call(identity, "identity", {}));
    if (!record.success || record.data.ownerId !== identity.ownerId)
      throw new SafeError("UNAUTHORIZED", 401);
    return identity;
  }
  private session(
    session: {
      access_token: string;
      refresh_token: string;
      expires_at?: number;
    } | null,
  ): SessionResult {
    if (!session?.expires_at) throw new SafeError("UNAUTHORIZED", 401);
    return {
      token: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: new Date(session.expires_at * 1000).toISOString(),
      dataMode: dataMode(this.config),
    };
  }
  async guest(captchaToken?: string): Promise<SessionResult> {
    if (!this.config.ENABLE_SUPABASE_GUEST) throw new SafeError("DISCONNECTED");
    const { data, error } = await this.client().auth.signInAnonymously(
      captchaToken ? { options: { captchaToken } } : {},
    );
    if (error) throw new SafeError("PROVIDER_UNAVAILABLE");
    return this.session(data.session);
  }
  async signIn(email: string, password: string): Promise<SessionResult> {
    const { data, error } = await this.client().auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw new SafeError("UNAUTHORIZED", 401);
    return this.session(data.session);
  }
  async refresh(token: string): Promise<SessionResult> {
    const { data, error } = await this.client().auth.refreshSession({
      refresh_token: token,
    });
    if (error) throw new SafeError("UNAUTHORIZED", 401);
    const session = this.session(data.session);
    await this.authenticate(`Bearer ${session.token}`);
    return session;
  }
  async revoke(identity: Identity): Promise<void> {
    await this.call(identity, "revoke_session", {});
  }
  async call(
    identity: Identity,
    action: DatabaseAction,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const rpc =
      action === "catalog_get" || action === "catalog_search"
        ? "sadeeman_catalog"
        : action === "travel_profile_get"
          ? "sadeeman_travel_profile"
          : action === "commit_travel_turn"
            ? "sadeeman_commit_travel_turn"
            : action === "commit_turn_with_tools"
              ? "sadeeman_commit_turn"
              : action === "save_tool_executions"
                ? "sadeeman_save_tool_executions"
                : action === "list_tool_executions"
                  ? "sadeeman_list_tool_executions"
                  : "sadeeman_operation";
    const parameters =
      action === "catalog_get" || action === "catalog_search"
        ? {
            p_action: action === "catalog_get" ? "get" : "search",
            p_payload: payload,
          }
        : action === "travel_profile_get"
          ? { p_action: "get", p_payload: payload }
          : action === "commit_travel_turn"
            ? { p_payload: payload }
            : action === "list_tool_executions"
              ? { p_conversation_id: payload.conversationId }
              : action === "commit_turn_with_tools" ||
                  action === "save_tool_executions"
                ? { p_payload: payload }
                : { p_action: action, p_payload: payload };
    const { data, error } = await this.client(identity.token).rpc(
      rpc,
      parameters,
    );
    if (error) throw databaseFailure(error);
    return data;
  }
  async close(): Promise<void> {}
}
export async function createPersistence(
  config: Config,
): Promise<Persistence | undefined> {
  if (config.PERSISTENCE_MODE === "ephemeral") return undefined;
  if (config.PERSISTENCE_MODE === "local") {
    const { openLocalPersistence } = await import("./local.js");
    return openLocalPersistence(config.LOCAL_DATABASE_PATH, {
      // Approved catalog/context schema is in the root migration list now.
      // Starting the app must never apply unapproved proposals, even locally.
      includeProposed: false,
      allowCatalogDemo: config.ALLOW_CATALOG_DEMO,
    });
  }
  const store = new SupabaseDatabase(config);
  return { mode: "supabase", auth: store, transport: store };
}
