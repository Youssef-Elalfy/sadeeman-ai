import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLocalDatabase,
  type LocalDatabase,
  migrateLocal,
  projectRoot,
} from "../apps/api/src/persistence/local.js";
import { Repository } from "../apps/api/src/persistence/repository.js";
import type { Identity } from "../apps/api/src/persistence/types.js";

const proposalPath = resolve(
  projectRoot,
  "supabase/migrations/20261105154454_session_boundary_hardening.sql",
);
let db: LocalDatabase;
async function principal(database = db) {
  const session = await database.guest();
  const identity = await database.authenticate(`Bearer ${session.token}`);
  const result = await database.db.query<{ session_id: string }>(
    "select session_id from sadeeman_private.sessions where owner_id=$1",
    [identity.ownerId],
  );
  const sid = result.rows[0]?.session_id;
  if (!sid) throw new Error("Missing synthetic test session");
  return { identity, sid, repo: new Repository(database, identity) };
}
type Principal = Awaited<ReturnType<typeof principal>>;
async function asUser<T>(
  user: Principal,
  query: string,
  params: unknown[] = [],
  override: Record<string, unknown> = {},
) {
  return db.db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query(
      "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [
        user.identity.ownerId,
        JSON.stringify({
          sub: user.identity.ownerId,
          session_id: user.sid,
          exp: Math.floor(Date.now() / 1000) + 3600,
          ...override,
        }),
      ],
    );
    return tx.query<T>(query, params);
  });
}
async function active(user: Principal, claims: Record<string, unknown> = {}) {
  return (
    await asUser<{ active: boolean }>(
      user,
      "select public.sadeeman_session_active() as active",
      [],
      claims,
    )
  ).rows[0]?.active;
}
async function snapshot(database: LocalDatabase) {
  const tables = await database.db.query<{ name: string }>(
    "select tablename as name from pg_tables where schemaname='public' and tablename like 'sadeeman_%' order by tablename",
  );
  const rows: Record<string, unknown> = {};
  for (const { name } of tables.rows) {
    if (!/^sadeeman_[a-z_]+$/.test(name)) throw new Error("Invalid test table");
    rows[name] = (
      await database.db.query(
        `select to_jsonb(t) as row from public.${name} t order by to_jsonb(t)::text`,
      )
    ).rows;
  }
  return {
    rows,
    policies: (
      await database.db.query(
        "select * from pg_policies where schemaname='public' and policyname<>'own_sessions' order by tablename,policyname",
      )
    ).rows,
    tables: (
      await database.db.query(
        "select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname",
      )
    ).rows,
    publicFunctions: (
      await database.db.query(
        "select p.oid,p.oid::regprocedure::text as signature,p.proacl::text,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid",
      )
    ).rows,
    triggers: (
      await database.db.query(
        "select trigger_name,event_manipulation,event_object_table,action_statement from information_schema.triggers where trigger_schema='public' order by trigger_name,event_manipulation",
      )
    ).rows,
    ledger: (
      await database.db.query(
        "select * from sadeeman_private.migrations order by name",
      )
    ).rows,
  };
}
let before: Awaited<ReturnType<typeof snapshot>>,
  after: Awaited<ReturnType<typeof snapshot>>,
  existing: Principal,
  conversationId: string,
  memoryId: string,
  preempted: Principal;
beforeAll(async () => {
  db = await createLocalDatabase(undefined, {
    testBeforeMigration: "20261105154454_session_boundary_hardening.sql",
  });
  existing = await principal();
  conversationId = (await existing.repo.createConversation()).id;
  await existing.repo.commit(
    conversationId,
    randomUUID(),
    randomUUID(),
    "SYNTHETIC TEST input",
    "SYNTHETIC TEST answer",
    { inputTokens: 1, outputTokens: 1 },
  );
  const consent = await existing.repo.consent({
    purpose: "travel_preferences",
    version: "memory-v1",
    accepted: true,
    requestId: randomUUID(),
  });
  memoryId = (
    await existing.repo.saveMemory({
      consentId: consent.id,
      category: "language",
      content: "SYNTHETIC TEST Arabic",
      sourceConversationId: conversationId,
      expiresInDays: 30,
      requestId: randomUUID(),
    })
  ).id;
  // Preserve a legacy UUID-preemption row to prove the new helper fails closed.
  const attacker = await principal();
  preempted = await principal();
  await asUser(
    attacker,
    "insert into public.sadeeman_session_revocations(session_id) values($1)",
    [preempted.sid],
  );
  before = await snapshot(db);
  const sql = await readFile(proposalPath, "utf8");
  await db.db.transaction((tx) => tx.exec(sql));
  after = await snapshot(db);
}, 30000);
afterAll(async () => db?.close());

describe("session hardening proposal — real embedded PostgreSQL, no network", () => {
  it("preserves all eleven tables' rows, unrelated policies, RLS, table grants and applied ledger", () => {
    expect(Object.keys(before.rows)).toHaveLength(11);
    expect(after).toEqual(before);
  });
  it("keeps preexisting conversation history, consent-backed memory and owner isolation", async () => {
    expect(
      (await existing.repo.conversation(conversationId)).messages,
    ).toHaveLength(2);
    expect((await existing.repo.memories()).map((m) => m.id)).toContain(
      memoryId,
    );
    const other = await principal();
    expect(await other.repo.listConversations()).toEqual([]);
    expect(await other.repo.memories()).toEqual([]);
    await expect(other.repo.conversation(conversationId)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
  });
  it.each([true, false])(
    "preserves an owned Auth session with is_anonymous=%s",
    async (is_anonymous) => {
      const user = await principal();
      expect(await active(user, { is_anonymous })).toBe(true);
      expect(await user.repo.createConversation()).toHaveProperty("id");
    },
  );
  it.each([undefined, null, "", "malformed", 42, randomUUID()])(
    "rejects missing, malformed or nonexistent session_id (%s)",
    async (session_id) => {
      const user = await principal();
      expect(await active(user, { session_id })).toBe(false);
      expect(
        (
          await asUser(
            user,
            "select id from public.sadeeman_conversations",
            [],
            { session_id },
          )
        ).rows,
      ).toEqual([]);
    },
  );
  it("rejects a different owner's real session and a mismatched subject", async () => {
    const a = await principal(),
      b = await principal();
    expect(await active(a, { session_id: b.sid })).toBe(false);
    expect(await active(a, { sub: b.identity.ownerId })).toBe(false);
    expect(await active(a, { sub: null })).toBe(false);
  });
  it.each([
    undefined,
    null,
    "9999999999",
    -1,
    0,
    1.5,
    Math.floor(Date.now() / 1000) - 60,
  ])("rejects missing, invalid or expired JWT exp (%s)", async (exp) =>
    expect(await active(await principal(), { exp })).toBe(false),
  );
  it.each(["null", "[]", '"text"', "{invalid"])(
    "fails closed for malformed/non-object JWT claims (%s)",
    async (claims) => {
      const user = await principal();
      const result = await db.db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query(
          "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
          [user.identity.ownerId, claims],
        );
        return tx.query<{ active: boolean }>(
          "select public.sadeeman_session_active() as active",
        );
      });
      expect(result.rows[0]?.active).toBe(false);
    },
  );
  it("rejects expired Auth sessions in SQL and the local token transport", async () => {
    const user = await principal();
    await db.db.query(
      "update auth.sessions set not_after=statement_timestamp()-interval '1 second' where id=$1",
      [user.sid],
    );
    expect(await active(user)).toBe(false);
    await expect(
      db.authenticate(`Bearer ${user.identity.token}`),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(user.repo.createConversation()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("accepts a nullable Auth not_after with a valid JWT and preserves normal future expiry", async () => {
    const user = await principal();
    expect(await active(user)).toBe(true);
    await db.db.query("update auth.sessions set not_after=null where id=$1", [
      user.sid,
    ]);
    expect(await active(user)).toBe(true);
  });
  it("rejects removed Auth sessions despite a future JWT/token expiry", async () => {
    const user = await principal();
    await db.db.query("delete from auth.sessions where id=$1", [user.sid]);
    expect(await active(user)).toBe(false);
    await expect(
      db.authenticate(`Bearer ${user.identity.token}`),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(user.repo.createConversation()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("rejects missing/unknown/expired local credentials and forged owner identities", async () => {
    for (const header of [undefined, "Bearer ", "Bearer SYNTHETIC-NONEXISTENT"])
      await expect(db.authenticate(header)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    const user = await principal();
    const forged: Identity = { ...user.identity, ownerId: randomUUID() };
    await expect(db.call(forged, "identity", {})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await db.db.query(
      "update sadeeman_private.sessions set expires_at=statement_timestamp()-interval '1 second' where session_id=$1",
      [user.sid],
    );
    await expect(
      db.authenticate(`Bearer ${user.identity.token}`),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("denies known other-session UUID preemption and preserves that user's ability to log out", async () => {
    const a = await principal(),
      b = await principal();
    await expect(
      asUser(
        a,
        "insert into public.sadeeman_session_revocations(session_id) values($1)",
        [b.sid],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await active(b)).toBe(true);
    await db.revoke(b.identity);
    expect(await active(b)).toBe(false);
    await expect(
      db.authenticate(`Bearer ${b.identity.token}`),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(
      (await asUser(b, "select * from public.sadeeman_session_revocations"))
        .rows,
    ).toEqual([]);
  });
  it("denies forged revocation owners and expired-session inserts", async () => {
    const a = await principal(),
      b = await principal();
    await expect(
      asUser(
        a,
        "insert into public.sadeeman_session_revocations(session_id,owner_id,tenant_id) values($1,$2,$2)",
        [a.sid, b.identity.ownerId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(
        a,
        "insert into public.sadeeman_session_revocations(session_id) values($1)",
        [a.sid],
        { exp: 1 },
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("fails closed on preserved legacy UUID-preemption rows without rewriting/deleting them", async () => {
    expect(await active(preempted)).toBe(false);
    expect(
      (
        await db.db.query(
          "select session_id from public.sadeeman_session_revocations where session_id=$1",
          [preempted.sid],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("preserves another valid session of the same owner after current-session logout", async () => {
    const first = await principal();
    const secondSid = randomUUID();
    await db.db.query(
      "insert into auth.sessions(id,user_id,not_after) values($1,$2,null)",
      [secondSid, first.identity.ownerId],
    );
    await first.repo.createConversation();
    await db.revoke(first.identity);
    const second = { ...first, sid: secondSid };
    expect(await active(second)).toBe(true);
    expect(
      (await asUser(second, "select id from public.sadeeman_conversations"))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await asUser(
          second,
          "select session_id from public.sadeeman_session_revocations",
        )
      ).rows,
    ).toEqual([{ session_id: first.sid }]);
  });
  it.each([
    "select * from auth.sessions",
    "insert into auth.sessions(id,user_id) values(gen_random_uuid(),auth.uid())",
    "update auth.sessions set not_after=null where user_id=auth.uid()",
    "delete from auth.sessions where user_id=auth.uid()",
    "update public.sadeeman_session_revocations set revoked_at=now() where owner_id=auth.uid()",
    "delete from public.sadeeman_session_revocations where owner_id=auth.uid()",
  ])("denies client Auth access and revocation mutation: %s", async (query) => {
    await expect(asUser(await principal(), query)).rejects.toMatchObject({
      code: "42501",
    });
  });
  it("limits the new private definer to a caller-bound boolean with explicit ACLs and empty search_path", async () => {
    const result = await db.db.query<{
      name: string;
      definer: boolean;
      owner: string;
      args: number;
      result: string;
      settings: string[];
      authenticated: boolean;
      anon: boolean;
    }>(
      "select p.proname as name,p.prosecdef as definer,r.rolname as owner,p.pronargs as args,pg_get_function_result(p.oid) as result,p.proconfig as settings,has_function_privilege('authenticated',p.oid,'execute') as authenticated,has_function_privilege('anon',p.oid,'execute') as anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where (n.nspname='sadeeman_private' and p.proname in ('current_session_valid','guard_consent','guard_memory')) or (n.nspname='public' and p.proname='sadeeman_session_active') order by p.proname",
    );
    expect(
      result.rows.find((p) => p.name === "current_session_valid"),
    ).toMatchObject({
      definer: true,
      owner: "postgres",
      args: 0,
      result: "boolean",
      settings: ['search_path=""'],
      authenticated: true,
      anon: false,
    });
    expect(
      result.rows.find((p) => p.name === "sadeeman_session_active"),
    ).toMatchObject({ definer: false, authenticated: true, anon: false });
    for (const p of result.rows.filter((p) => p.name.startsWith("guard_")))
      expect(p).toMatchObject({ authenticated: false, anon: false });
    await expect(
      db.db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        return tx.query("select sadeeman_private.current_session_valid()");
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("upgrades legacy local sessions once, preserves tokens/data and never resurrects removed sessions", async () => {
    const legacy = await createLocalDatabase();
    try {
      const live = await principal(legacy),
        expired = await principal(legacy),
        revoked = await principal(legacy);
      const conversation = await live.repo.createConversation();
      await legacy.db.query(
        "update sadeeman_private.sessions set expires_at=now()-interval '1 day' where session_id=$1",
        [expired.sid],
      );
      await legacy.db.query(
        "update sadeeman_private.sessions set revoked_at=now() where session_id=$1",
        [revoked.sid],
      );
      // Test-only removal of the newly introduced local mirror simulates the old
      // embedded database version. This is never a Cloud migration or command.
      await legacy.db.exec("drop table auth.sessions");
      await migrateLocal(legacy.db);
      expect(
        (await legacy.db.query("select id from auth.sessions")).rows,
      ).toEqual([{ id: live.sid }]);
      expect(
        await legacy.authenticate(`Bearer ${live.identity.token}`),
      ).toEqual(live.identity);
      expect((await live.repo.listConversations()).map((c) => c.id)).toContain(
        conversation.id,
      );
      await legacy.db.query("delete from auth.sessions where id=$1", [
        live.sid,
      ]);
      await migrateLocal(legacy.db);
      await expect(
        legacy.authenticate(`Bearer ${live.identity.token}`),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(
        (
          await legacy.db.query(
            "select id from public.sadeeman_conversations where id=$1",
            [conversation.id],
          )
        ).rows,
      ).toHaveLength(1);
    } finally {
      await legacy.close();
    }
  }, 30000);
});
