import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLocalDatabase,
  type LocalDatabase,
  projectRoot,
} from "../apps/api/src/persistence/local.js";

let database: LocalDatabase;
let originalAudit: string;
let beforeDefinition: unknown;
type Guest = { id: string; sid: string; conversation: string };
beforeAll(async () => {
  database = await createLocalDatabase();
  // Only the isolated Auth mirror. No Cloud identity or local opaque-token row.
  await database.db.exec(
    "alter table auth.users add column is_anonymous boolean not null default false",
  );
  await database.db.exec(
    "create role supabase_auth_admin nologin nobypassrls; grant usage on schema auth to supabase_auth_admin; grant select,delete on auth.users to supabase_auth_admin",
  );
  const foundation = await readFile(
    resolve(
      projectRoot,
      "supabase/migrations/20261104232715_identity_memory_foundation.sql",
    ),
    "utf8",
  );
  originalAudit =
    foundation.match(
      /create function sadeeman_private\.record_audit\(\)[\s\S]*?\$\$;/,
    )?.[0] ?? "";
  if (!originalAudit) throw new Error("Audit definition not found");
}, 30000);
afterAll(async () => {
  await database?.close();
});

async function asUser<T>(
  guest: Pick<Guest, "id" | "sid">,
  query: string,
  values: unknown[] = [],
  claims: Record<string, unknown> = {},
) {
  return database.db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query(
      "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [
        guest.id,
        JSON.stringify({
          sub: guest.id,
          session_id: guest.sid,
          exp: Math.floor(Date.now() / 1000) + 3600,
          ...claims,
        }),
      ],
    );
    return tx.query<T>(query, values);
  });
}
async function seed(): Promise<Guest> {
  const id = randomUUID(),
    sid = randomUUID();
  await database.db.query(
    "insert into auth.users(id,is_anonymous) values($1,true)",
    [id],
  );
  await database.db.query(
    "insert into auth.sessions(id,user_id) values($1,$2)",
    [sid, id],
  );
  const created = await asUser<{ result: { id: string } }>(
    { id, sid },
    "select public.sadeeman_operation('create_conversation','{}'::jsonb) as result",
  );
  const conversation = created.rows[0]?.result.id;
  if (!conversation) throw new Error("Missing synthetic conversation");
  const guest = { id, sid, conversation };
  for (let i = 0; i < 2; i++)
    await asUser(guest, "select public.sadeeman_commit_turn($1::jsonb)", [
      JSON.stringify({
        conversationId: conversation,
        requestId: randomUUID(),
        runId: randomUUID(),
        input: "SYNTHETIC PUBLIC TEST",
        answer: "SYNTHETIC ANSWER",
        inputHash: createHash("sha256")
          .update("SYNTHETIC PUBLIC TEST")
          .digest("hex"),
        usage: { inputTokens: 1, outputTokens: 1 },
        toolExecutions: [],
      }),
    ]);
  return guest;
}
async function counts(guest: Guest) {
  return (
    await database.db.query(
      "select (select count(*)::int from auth.users where id=$1) as users,(select count(*)::int from auth.sessions where user_id=$1) as sessions,(select count(*)::int from public.sadeeman_conversations where owner_id=$1) as conversations,(select count(*)::int from public.sadeeman_messages where owner_id=$1) as messages,(select count(*)::int from public.sadeeman_audit_events where owner_id=$1) as audits",
      [guest.id],
    )
  ).rows[0];
}
async function administrativeDelete(guest: Guest) {
  return database.db.transaction(async (tx) => {
    await tx.exec("set local role supabase_auth_admin");
    await tx.query(
      "select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true)",
    );
    return tx.query("delete from auth.users where id=$1", [guest.id]);
  });
}
async function metadata() {
  return {
    function: (
      await database.db.query(
        "select oid,proowner::regrole::text,proacl::text,prosecdef,provolatile,proconfig from pg_proc where oid='sadeeman_private.record_audit()'::regprocedure",
      )
    ).rows,
    tables: (
      await database.db.query(
        "select oid,relname,relrowsecurity,relforcerowsecurity,relacl::text from pg_class where relnamespace='public'::regnamespace and relkind='r' order by oid",
      )
    ).rows,
    policies: (
      await database.db.query(
        "select * from pg_policies where schemaname in ('public','auth') order by schemaname,tablename,policyname",
      )
    ).rows,
    triggers: (
      await database.db.query(
        "select oid,tgname,tgenabled,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal order by oid",
      )
    ).rows,
    foreignKeys: (
      await database.db.query(
        "select oid,conname,pg_get_constraintdef(oid) from pg_constraint where contype='f' order by oid",
      )
    ).rows,
  };
}
async function addMemory(guest: Guest) {
  const consent = randomUUID();
  await asUser(
    guest,
    "insert into public.sadeeman_consents(id,purpose,accepted,version) values($1,'travel_preferences',true,'memory-v1')",
    [consent],
  );
  const memory = randomUUID();
  await asUser(
    guest,
    "insert into public.sadeeman_memories(id,consent_id,category,content,source_conversation_id,expires_at) values($1,$2,'language','SYNTHETIC preference',$3,now()+interval '1 day')",
    [memory, consent, guest.conversation],
  );
  return memory;
}
describe("anonymous Auth deletion cascade — isolated PostgreSQL only", () => {
  it("reproduces UNAUTHORIZED inside record_audit and rolls the entire deletion back", async () => {
    const guest = await seed(),
      before = await counts(guest);
    expect(before).toMatchObject({
      users: 1,
      sessions: 1,
      conversations: 1,
      messages: 4,
    });
    await expect(administrativeDelete(guest)).rejects.toMatchObject({
      code: "P0001",
      message: "UNAUTHORIZED",
      where: expect.stringContaining("record_audit"),
    });
    expect(await counts(guest)).toEqual(before);
  });
  it("isolates the second failure: writing an audit for an already deleted Auth parent violates its FK", async () => {
    const guest = await seed(),
      before = await counts(guest);
    // Diagnostic variant ONLY inside a rolled-back transaction: retain owner
    // checks for existing users, but let the missing-parent DELETE reach INSERT.
    const diagnostic = originalAudit
      .replace("create function", "create or replace function")
      .replace(
        "if record_owner is distinct from (select auth.uid()) then",
        "if record_owner is distinct from (select auth.uid()) and exists(select 1 from auth.users where id=record_owner) then",
      );
    await expect(
      database.db.transaction(async (tx) => {
        await tx.exec(diagnostic);
        await tx.exec("set local role supabase_auth_admin");
        await tx.query("delete from auth.users where id=$1", [guest.id]);
      }),
    ).rejects.toMatchObject({
      code: "23503",
      table: "sadeeman_audit_events",
      constraint: "sadeeman_audit_events_owner_id_fkey",
    });
    expect(await counts(guest)).toEqual(before);
  });
  it("allows privileged anonymous-user deletion with persisted conversation/messages while preserving another user", async () => {
    beforeDefinition = await metadata();
    const proposal = await readFile(
      resolve(
        projectRoot,
        "supabase/migrations/proposed/20261107135209_account_deletion_audit_boundary.sql",
      ),
      "utf8",
    );
    await database.db.transaction(async (tx) => {
      await tx.exec(proposal);
    });
    expect(await metadata()).toEqual(beforeDefinition);
    const guest = await seed(),
      other = await seed(),
      before = await counts(other);
    await expect(administrativeDelete(guest)).resolves.toBeDefined();
    expect(await counts(guest)).toEqual({
      users: 0,
      sessions: 0,
      conversations: 0,
      messages: 0,
      audits: 0,
    });
    expect(await counts(other)).toEqual(before);
  });
  it("also cascades consent and memory without resurrecting audit rows or leaving an orphan", async () => {
    const guest = await seed();
    await addMemory(guest);
    await administrativeDelete(guest);
    expect(await counts(guest)).toEqual({
      users: 0,
      sessions: 0,
      conversations: 0,
      messages: 0,
      audits: 0,
    });
    const children = await database.db.query(
      "select (select count(*)::int from public.sadeeman_memories where owner_id=$1) as memories,(select count(*)::int from public.sadeeman_consents where owner_id=$1) as consents,(select count(*)::int from public.sadeeman_turns where owner_id=$1) as turns",
      [guest.id],
    );
    expect(children.rows[0]).toEqual({ memories: 0, consents: 0, turns: 0 });
  });
  it("keeps ordinary owner actions fully audited, including cascaded memory deletion", async () => {
    const guest = await seed();
    const memory = await addMemory(guest);
    await asUser(
      guest,
      "update public.sadeeman_memories set content='SYNTHETIC revised preference',version=version+1 where id=$1",
      [memory],
    );
    await asUser(
      guest,
      "select public.sadeeman_operation('delete_conversation',jsonb_build_object('id',$1::uuid))",
      [guest.conversation],
    );
    const audit = await asUser<{ action: string }>(
      guest,
      "select action from public.sadeeman_audit_events order by id",
    );
    expect(audit.rows.map((row) => row.action).sort()).toEqual(
      [
        "sadeeman_conversations:insert",
        "sadeeman_consents:insert",
        "sadeeman_memories:insert",
        "sadeeman_memories:update",
        "sadeeman_memories:delete",
        "sadeeman_conversations:delete",
      ].sort(),
    );
    expect(await counts(guest)).toMatchObject({
      users: 1,
      sessions: 1,
      conversations: 0,
      messages: 0,
      audits: 6,
    });
  });
  it("still rejects unauthenticated privileged conversation deletion when its owner exists", async () => {
    const guest = await seed(),
      before = await counts(guest);
    await expect(
      database.db.query(
        "delete from public.sadeeman_conversations where id=$1",
        [guest.conversation],
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "UNAUTHORIZED" });
    expect(await counts(guest)).toEqual(before);
  });
  it("does not let the Auth admin directly erase application conversations", async () => {
    const guest = await seed(),
      before = await counts(guest);
    await expect(
      database.db.transaction(async (tx) => {
        await tx.exec("set local role supabase_auth_admin");
        await tx.query(
          "delete from public.sadeeman_conversations where id=$1",
          [guest.conversation],
        );
      }),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await counts(guest)).toEqual(before);
  });
  it("preserves cross-user, missing-claim and nonexistent-session RLS isolation", async () => {
    const a = await seed(),
      b = await seed(),
      before = await counts(a);
    expect(
      (
        await asUser(
          b,
          "delete from public.sadeeman_conversations where id=$1 returning id",
          [a.conversation],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await asUser(
          { ...a, sid: randomUUID() },
          "delete from public.sadeeman_conversations where id=$1 returning id",
          [a.conversation],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await asUser(
          a,
          "delete from public.sadeeman_conversations where id=$1 returning id",
          [a.conversation],
          { exp: 0 },
        )
      ).rows,
    ).toEqual([]);
    await database.db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query(
        "select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true)",
      );
      expect(
        (
          await tx.query(
            "delete from public.sadeeman_conversations where id=$1 returning id",
            [a.conversation],
          )
        ).rows,
      ).toEqual([]);
    });
    expect(await counts(a)).toEqual(before);
    await asUser(
      a,
      "select public.sadeeman_operation('revoke_session','{}'::jsonb)",
    );
    expect(
      (
        await asUser(
          a,
          "delete from public.sadeeman_conversations where id=$1 returning id",
          [a.conversation],
        )
      ).rows,
    ).toEqual([]);
    expect(await counts(a)).toEqual(before);
  });
  it("retains restricted execution and rejects reapplication or unexpected definitions", async () => {
    const privileges = await database.db.query(
      "select has_function_privilege('anon','sadeeman_private.record_audit()','EXECUTE') as anon,has_function_privilege('authenticated','sadeeman_private.record_audit()','EXECUTE') as authenticated",
    );
    expect(privileges.rows[0]).toEqual({ anon: false, authenticated: false });
    expect(await metadata()).toEqual(beforeDefinition);
    const proposal = await readFile(
      resolve(
        projectRoot,
        "supabase/migrations/proposed/20261107135209_account_deletion_audit_boundary.sql",
      ),
      "utf8",
    );
    await expect(
      database.db.transaction(async (tx) => {
        await tx.exec(proposal);
      }),
    ).rejects.toMatchObject({
      code: "P0001",
      message: "AUDIT_DEFINITION_PREREQUISITE",
    });
  });
});
