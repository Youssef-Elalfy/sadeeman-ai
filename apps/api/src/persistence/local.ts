import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { SafeError } from "../errors.js";
import type {
  AuthStore,
  DatabaseAction,
  DatabaseTransport,
  Identity,
  Persistence,
  SessionResult,
} from "./types.js";

export const projectRoot = fileURLToPath(
  new URL("../../../../", import.meta.url),
);
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
interface LocalSessionRow {
  owner_id: string;
  session_id: string;
  token_exp: number;
}
const validLocalSession = `
  select p.owner_id,p.session_id,floor(extract(epoch from p.expires_at))::double precision as token_exp
  from sadeeman_private.sessions p join auth.sessions s on s.id=p.session_id and s.user_id=p.owner_id
  where p.token_hash=$1 and p.revoked_at is null and p.expires_at>statement_timestamp()
    and (s.not_after is null or s.not_after>statement_timestamp())
    and not exists(select 1 from public.sadeeman_session_revocations r where r.session_id=p.session_id)
`;
export function localDatabasePath(path: string): string {
  const absolute = resolve(projectRoot, path);
  const boundary = resolve(projectRoot, ".private");
  if (!absolute.startsWith(`${boundary}${sep}`))
    throw new Error(
      "Local database must be inside this project .private directory",
    );
  return absolute;
}
export function databaseFailure(error: unknown): SafeError {
  if (error instanceof SafeError) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  )
    return new SafeError("CONFLICT", 409);
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? error.message
      : "";
  if (message === "INVALID_REQUEST")
    return new SafeError("INVALID_REQUEST", 400);
  if (message === "NOT_FOUND") return new SafeError("NOT_FOUND", 404);
  if (message === "UNAUTHORIZED") return new SafeError("UNAUTHORIZED", 401);
  if (message === "CONSENT_REQUIRED")
    return new SafeError("CONSENT_REQUIRED", 403);
  if (message === "VERSION_CONFLICT")
    return new SafeError("VERSION_CONFLICT", 409);
  if (message === "IDEMPOTENCY_CONFLICT")
    return new SafeError("IDEMPOTENCY_CONFLICT", 409);
  if (message === "CAPACITY") return new SafeError("CAPACITY", 429);
  return new SafeError("DATABASE_UNAVAILABLE");
}
export async function migrateLocal(
  db: PGlite,
  includeProposed = false,
  testBeforeMigration?: string,
): Promise<void> {
  if (testBeforeMigration && process.env.NODE_ENV !== "test")
    throw new Error(
      "Historical schema fixtures are restricted to automated tests",
    );
  const authRegistry = await db.query<{ present: boolean }>(
    "select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relname='sessions') as present",
  );
  // Only the embedded development database bootstraps an auth namespace. Never ship this to Supabase.
  await db.exec(`
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin nobypassrls; end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin nobypassrls; end if;
    end $$;
    create schema if not exists auth;
    create table if not exists auth.users(id uuid primary key);
    create table if not exists auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,not_after timestamptz);
    alter table auth.sessions enable row level security;
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create schema if not exists sadeeman_private;
    revoke all on schema sadeeman_private from public, anon;
    create table if not exists sadeeman_private.migrations(name text primary key, checksum text not null);
    create table if not exists sadeeman_private.sessions(token_hash text primary key, owner_id uuid not null references auth.users(id), session_id uuid not null, expires_at timestamptz not null, revoked_at timestamptz);
  `);
  if (!authRegistry.rows[0]?.present) {
    // One-time upgrade of the embedded Auth mirror only. Never recreate a removed
    // session on later startup; existing opaque tokens/data remain unchanged.
    await db.exec(`insert into auth.sessions(id,user_id,not_after)
      select session_id,owner_id,expires_at from sadeeman_private.sessions
      where revoked_at is null and expires_at>statement_timestamp()
      on conflict(id) do nothing`);
  }
  const directory = resolve(projectRoot, "supabase/migrations");
  const files = (await readdir(directory))
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();
  const paths = new Map(files.map((name) => [name, resolve(directory, name)]));
  if (includeProposed)
    for (const name of (await readdir(resolve(directory, "proposed")))
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort()) {
      if (paths.has(name)) throw new Error("Duplicate migration source");
      files.push(name);
      paths.set(name, resolve(directory, "proposed", name));
    }
  for (const name of files) {
    if (testBeforeMigration && name >= testBeforeMigration) continue;
    const sql = await readFile(
      paths.get(name) ?? resolve(directory, name),
      "utf8",
    );
    const previous = await db.query<{ checksum: string }>(
      "select checksum from sadeeman_private.migrations where name=$1",
      [name],
    );
    const checksum = digest(sql);
    if (previous.rows[0]) {
      if (previous.rows[0].checksum !== checksum)
        throw new Error("Applied migration checksum mismatch");
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into sadeeman_private.migrations values($1,$2)", [
        name,
        checksum,
      ]);
    });
  }
}
export class LocalDatabase implements AuthStore, DatabaseTransport {
  constructor(
    readonly db: PGlite,
    private readonly allowCatalogDemo = false,
  ) {
    if (allowCatalogDemo && process.env.NODE_ENV !== "test")
      throw new Error("Demo catalog is restricted to automated tests");
  }
  async guest(): Promise<SessionResult> {
    const token = randomBytes(32).toString("base64url");
    const ownerId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const sessionId = randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.query("insert into auth.users(id) values($1)", [ownerId]);
      await tx.query(
        "insert into auth.sessions(id,user_id,not_after) values($1,$2,$3)",
        [sessionId, ownerId, expiresAt],
      );
      await tx.query(
        "insert into sadeeman_private.sessions(token_hash,owner_id,session_id,expires_at) values($1,$2,$3,$4)",
        [digest(token), ownerId, sessionId, expiresAt],
      );
    });
    return { token, expiresAt, dataMode: "synthetic_only" };
  }
  async authenticate(header: string | undefined): Promise<Identity> {
    if (!header?.startsWith("Bearer ") || header.length > 200)
      throw new SafeError("UNAUTHORIZED", 401);
    const token = header.slice(7);
    const rows = await this.db.query<LocalSessionRow>(validLocalSession, [
      digest(token),
    ]);
    if (!rows.rows[0]) throw new SafeError("UNAUTHORIZED", 401);
    return { ownerId: rows.rows[0].owner_id, token };
  }
  async revoke(identity: Identity): Promise<void> {
    await this.call(identity, "revoke_session", {});
    await this.db.query(
      "update sadeeman_private.sessions set revoked_at=now() where token_hash=$1 and owner_id=$2",
      [digest(identity.token), identity.ownerId],
    );
  }
  async call(
    identity: Identity,
    action: DatabaseAction,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.db.transaction(async (tx) => {
        // Resolve the principal from the secret hash again in the same transaction; never trust a caller-supplied owner.
        const sessions = await tx.query<LocalSessionRow>(validLocalSession, [
          digest(identity.token),
        ]);
        const session = sessions.rows[0];
        if (!session || session.owner_id !== identity.ownerId)
          throw new SafeError("UNAUTHORIZED", 401);
        await tx.exec("set local role authenticated");
        await tx.query(
          "select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",
          [
            session.owner_id,
            JSON.stringify({
              sub: session.owner_id,
              session_id: session.session_id,
              exp: session.token_exp,
              ...(this.allowCatalogDemo
                ? { app_metadata: { catalog_demo: true } }
                : {}),
            }),
          ],
        );
        const result =
          action === "catalog_search" || action === "catalog_get"
            ? await tx.query<{ result: unknown }>(
                "select public.sadeeman_catalog($1,$2::jsonb) as result",
                [
                  action === "catalog_search" ? "search" : "get",
                  JSON.stringify(payload),
                ],
              )
            : action === "travel_profile_get"
              ? await tx.query<{ result: unknown }>(
                  "select public.sadeeman_travel_profile('get',$1::jsonb) as result",
                  [JSON.stringify(payload)],
                )
              : action === "commit_travel_turn"
                ? await tx.query<{ result: unknown }>(
                    "select public.sadeeman_commit_travel_turn($1::jsonb) as result",
                    [JSON.stringify(payload)],
                  )
                : action === "commit_turn_with_tools" ||
                    action === "save_tool_executions"
                  ? await tx.query<{ result: unknown }>(
                      action === "commit_turn_with_tools"
                        ? "select public.sadeeman_commit_turn($1::jsonb) as result"
                        : "select public.sadeeman_save_tool_executions($1::jsonb) as result",
                      [JSON.stringify(payload)],
                    )
                  : action === "list_tool_executions"
                    ? await tx.query<{ result: unknown }>(
                        "select public.sadeeman_list_tool_executions($1::uuid) as result",
                        [payload.conversationId],
                      )
                    : await tx.query<{ result: unknown }>(
                        "select public.sadeeman_operation($1,$2::jsonb) as result",
                        [action, JSON.stringify(payload)],
                      );
        return result.rows[0]?.result;
      });
    } catch (error) {
      throw databaseFailure(error);
    }
  }
  async close(): Promise<void> {
    await this.db.close();
  }
}
export async function openLocalPersistence(
  path: string,
  options: { includeProposed?: boolean; allowCatalogDemo?: boolean } = {},
): Promise<Persistence> {
  const dataDir = localDatabasePath(path);
  await mkdir(dataDir, { recursive: true });
  const local = await createLocalDatabase(dataDir, options);
  return { mode: "local", auth: local, transport: local };
}
export async function createLocalDatabase(
  dataDir?: string,
  options: {
    includeProposed?: boolean;
    allowCatalogDemo?: boolean;
    testBeforeMigration?: string;
  } = {},
): Promise<LocalDatabase> {
  if (options.testBeforeMigration && process.env.NODE_ENV !== "test")
    throw new Error(
      "Historical schema fixtures are restricted to automated tests",
    );
  if (options.allowCatalogDemo && process.env.NODE_ENV !== "test")
    throw new Error("Demo catalog is restricted to automated tests");
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const db = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
  try {
    await migrateLocal(
      db,
      options.includeProposed,
      options.testBeforeMigration,
    );
  } catch (error) {
    await db.close();
    throw error;
  }
  return new LocalDatabase(db, options.allowCatalogDemo);
}
