import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLocalDatabase,
  type LocalDatabase,
  migrateLocal,
} from "../apps/api/src/persistence/local.js";
import { Repository } from "../apps/api/src/persistence/repository.js";
import type { Identity } from "../apps/api/src/persistence/types.js";

let store: LocalDatabase;
beforeAll(async () => {
  store = await createLocalDatabase();
}, 30000);
afterAll(async () => {
  await store?.close();
});
async function user() {
  const session = await store.guest();
  const identity = await store.authenticate(`Bearer ${session.token}`);
  return { identity, repo: new Repository(store, identity) };
}
async function asUser(identity: Identity, sql: string, params: unknown[] = []) {
  const session = await store.db.query<{ session_id: string }>(
    "select session_id from sadeeman_private.sessions where owner_id=$1 and revoked_at is null",
    [identity.ownerId],
  );
  const sid = session.rows[0]?.session_id;
  if (!sid) throw new Error("Missing synthetic test session");
  return store.db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query(
      "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [
        identity.ownerId,
        JSON.stringify({
          sub: identity.ownerId,
          session_id: sid,
          exp: Math.floor(Date.now() / 1000) + 3600,
          user_metadata: { role: "admin" },
        }),
      ],
    );
    return tx.query(sql, params);
  });
}
async function memorySetup() {
  const first = await user();
  const conversation = await first.repo.createConversation();
  const consent = await first.repo.consent({
    purpose: "travel_preferences",
    accepted: true,
    version: "memory-v1",
    requestId: randomUUID(),
  });
  const input = {
    consentId: consent.id,
    category: "travel_style" as const,
    content: "Synthetic quiet travel preference",
    sourceConversationId: conversation.id,
    expiresInDays: 90,
    requestId: randomUUID(),
  };
  return { ...first, conversation, consent, input };
}
describe("real embedded PostgreSQL migrations and RLS — no database mocks", () => {
  it("denying consent erases only that customer data and stale acceptance retries stay inactive", async () => {
    const a = await user(),
      b = await memorySetup();
    const c = await a.repo.createConversation(),
      requestId = randomUUID();
    const input = {
      purpose: "travel_preferences" as const,
      version: "memory-v1" as const,
      accepted: true,
      requestId,
    };
    const consent = await a.repo.consent(input);
    await a.repo.saveMemory({
      consentId: consent.id,
      category: "language",
      content: "Synthetic language",
      sourceConversationId: c.id,
      expiresInDays: 90,
      requestId: randomUUID(),
    });
    await b.repo.saveMemory(b.input);
    await a.repo.consent({
      ...input,
      accepted: false,
      requestId: randomUUID(),
    });
    expect(await a.repo.memories()).toEqual([]);
    expect(await b.repo.memories()).toHaveLength(1);
    expect((await a.repo.consent(input)).active).toBe(false);
  });
  it("deleting a conversation physically removes its history and linked memory provenance", async () => {
    const a = await memorySetup();
    const m = await a.repo.saveMemory(a.input);
    await a.repo.commit(
      a.conversation.id,
      randomUUID(),
      randomUUID(),
      "Synthetic deleted input",
      "Synthetic deleted answer",
      { inputTokens: 1, outputTokens: 1 },
    );
    await a.repo.deleteConversation(a.conversation.id);
    await expect(a.repo.conversation(a.conversation.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      (
        await store.db.query(
          "select id from public.sadeeman_memories where id=$1",
          [m.id],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await store.db.query(
          "select id from public.sadeeman_messages where conversation_id=$1",
          [a.conversation.id],
        )
      ).rows,
    ).toEqual([]);
  });
  it("applies a tracked migration, can re-open its ledger, and forces RLS on every customer table", async () => {
    await migrateLocal(store.db);
    const ledger = await store.db.query<{ name: string }>(
      "select name from sadeeman_private.migrations order by name",
    );
    expect(ledger.rows.map((row) => row.name)).toEqual([
      "20261104232715_identity_memory_foundation.sql",
      "20261105001704_tool_execution_records.sql",
      "20261105144113_company_catalog_travel_context.sql",
      "20261105154454_session_boundary_hardening.sql",
    ]);
    const tables = await store.db.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      "select relname,relrowsecurity,relforcerowsecurity from pg_class where relname in ('sadeeman_conversations','sadeeman_messages','sadeeman_memories','sadeeman_consents','sadeeman_audit_events','sadeeman_turns','sadeeman_requests','sadeeman_session_revocations','sadeeman_tool_executions','sadeeman_company_packages','sadeeman_travel_profiles')",
    );
    // The CRM migration was retired (owner scope correction): 11 tables.
    expect(tables.rows).toHaveLength(11);
    expect(
      (
        await store.db.query(
          "select 1 from pg_class where relname like 'sadeeman_crm%'",
        )
      ).rows,
    ).toEqual([]);
    expect(
      tables.rows.every((t) => t.relrowsecurity && t.relforcerowsecurity),
    ).toBe(true);
  });
  it("reads only the authenticated user rows while actually running without bypassrls privileges", async () => {
    const first = await user(),
      second = await user();
    const a = await first.repo.createConversation();
    const b = await second.repo.createConversation();
    const role = await asUser(
      first.identity,
      "select current_user,rolbypassrls from pg_roles where rolname=current_user",
    );
    expect(role.rows).toEqual([
      { current_user: "authenticated", rolbypassrls: false },
    ]);
    const rows = await asUser(
      first.identity,
      "select id from public.sadeeman_conversations",
    );
    expect(rows.rows).toEqual([{ id: a.id }]);
    await expect(second.repo.conversation(a.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(first.repo.conversation(b.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      asUser(
        first.identity,
        "update public.sadeeman_conversations set owner_id=$2,tenant_id=$2 where id=$1",
        [a.id, second.identity.ownerId],
      ),
    ).rejects.toThrow();
  });
  it("blocks anon access and prevents direct writes to private sessions and audit events", async () => {
    await expect(
      store.db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        return tx.query("select * from public.sadeeman_conversations");
      }),
    ).rejects.toThrow();
    const first = await user();
    await expect(
      asUser(first.identity, "select * from sadeeman_private.sessions"),
    ).rejects.toThrow();
    await expect(
      asUser(
        first.identity,
        "insert into public.sadeeman_audit_events(owner_id,tenant_id,action) values($1,$1,'forged')",
        [first.identity.ownerId],
      ),
    ).rejects.toThrow();
  });
  it("commits both messages atomically, restores full history, and deduplicates a repeated turn", async () => {
    const { repo } = await user();
    const c = await repo.createConversation();
    const key = randomUUID(),
      runId = randomUUID();
    await repo.commit(
      c.id,
      key,
      runId,
      "Synthetic user input",
      "Synthetic model answer",
      { inputTokens: 3, outputTokens: 4 },
    );
    await repo.commit(
      c.id,
      key,
      runId,
      "Synthetic user input",
      "Synthetic model answer",
      { inputTokens: 3, outputTokens: 4 },
    );
    expect((await repo.conversation(c.id)).messages).toHaveLength(2);
    await expect(
      repo.commit(c.id, key, randomUUID(), "Changed input", "Changed answer", {
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await repo.turn(c.id, key))?.runId).toBe(runId);
  });
  it("creates an explicitly labeled extractive summary without replacing recent conversation context", async () => {
    const { repo } = await user();
    const c = await repo.createConversation();
    for (let n = 0; n < 22; n++)
      await repo.commit(
        c.id,
        randomUUID(),
        randomUUID(),
        `Synthetic question ${n}`,
        `Synthetic answer ${n}`,
        { inputTokens: 1, outputTokens: 1 },
      );
    const restored = await repo.conversation(c.id);
    expect(restored.summaryKind).toBe("extractive");
    expect(restored.summary).toContain("Synthetic question 0");
    expect(restored.messages).toHaveLength(40);
    expect(restored.messages.at(-1)?.content).toBe("Synthetic answer 21");
  });
  it("requires durable affirmative scoped consent, including for direct SQL memory writes", async () => {
    const { repo, input, identity } = await memorySetup();
    await expect(
      repo.saveMemory({ ...input, consentId: randomUUID() }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    const denied = await repo.consent({
      purpose: "travel_preferences",
      accepted: false,
      version: "memory-v1",
      requestId: randomUUID(),
    });
    await expect(
      repo.saveMemory({ ...input, consentId: denied.id }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await expect(
      asUser(
        identity,
        "insert into public.sadeeman_memories(consent_id,category,content,source_conversation_id,expires_at) values($1,$2,$3,$4,now()+interval '1 day')",
        [denied.id, input.category, input.content, input.sourceConversationId],
      ),
    ).rejects.toThrow();
    expect(await repo.memories()).toEqual([]);
  });
  it("saves once, updates with optimistic version checks, and physically deletes memory idempotently", async () => {
    const { repo, input } = await memorySetup();
    const m = await repo.saveMemory(input);
    expect((await repo.saveMemory(input)).id).toBe(m.id);
    await expect(
      repo.saveMemory({ ...input, content: "Different" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const changed = await repo.updateMemory(m.id, {
      consentId: input.consentId,
      category: input.category,
      content: "Synthetic adventure preference",
      expiresInDays: 90,
      expectedVersion: 1,
      requestId: randomUUID(),
    });
    expect(changed.version).toBe(2);
    await expect(
      repo.updateMemory(m.id, {
        consentId: input.consentId,
        category: input.category,
        content: "Stale",
        expiresInDays: 90,
        expectedVersion: 1,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await repo.deleteMemory(m.id);
    await repo.deleteMemory(m.id);
    const raw = await store.db.query(
      "select id from public.sadeeman_memories where id=$1",
      [m.id],
    );
    expect(raw.rows).toHaveLength(0);
    await expect(repo.saveMemory(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("prevents cross-user consent/provenance theft, reads, updates and deletes", async () => {
    const a = await memorySetup(),
      b = await memorySetup();
    const m = await a.repo.saveMemory(a.input);
    await expect(
      b.repo.saveMemory({ ...b.input, consentId: a.consent.id }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await expect(
      b.repo.saveMemory({
        ...b.input,
        sourceConversationId: a.conversation.id,
      }),
    ).rejects.toThrow();
    await b.repo.deleteMemory(m.id);
    expect(await b.repo.memories()).toEqual([]);
    expect((await a.repo.memories())[0]?.id).toBe(m.id);
    expect(
      (
        await asUser(
          b.identity,
          "select id from public.sadeeman_memories where id=$1",
          [m.id],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("revocation removes saved content and permanently prevents consent reactivation", async () => {
    const a = await memorySetup();
    const m = await a.repo.saveMemory(a.input);
    await a.repo.revokeConsent(a.consent.id);
    expect(await a.repo.memories()).toEqual([]);
    expect(
      (
        await store.db.query(
          "select id from public.sadeeman_memories where id=$1",
          [m.id],
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      a.repo.saveMemory({ ...a.input, requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await expect(
      asUser(
        a.identity,
        "update public.sadeeman_consents set revoked_at=null where id=$1",
        [a.consent.id],
      ),
    ).rejects.toThrow();
  });
  it("expiry blocks retrieval at RLS and explicit deletion removes even expired content", async () => {
    const a = await memorySetup();
    const m = await a.repo.saveMemory(a.input);
    // The audit trigger also protects owner context during privileged maintenance.
    await store.db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        a.identity.ownerId,
      ]);
      await tx.query(
        "update public.sadeeman_memories set expires_at=now()-interval '1 day' where id=$1",
        [m.id],
      );
    });
    expect(await a.repo.memories()).toEqual([]);
    expect(
      (
        await asUser(
          a.identity,
          "select id from public.sadeeman_memories where id=$1",
          [m.id],
        )
      ).rows,
    ).toHaveLength(0);
    await a.repo.deleteMemory(m.id);
    expect(
      (
        await store.db.query(
          "select id from public.sadeeman_memories where id=$1",
          [m.id],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("stores only audit metadata and revokes sessions durably", async () => {
    const a = await memorySetup();
    await a.repo.saveMemory(a.input);
    const audit = await a.repo.audit();
    expect(audit.some((row) => row.action === "sadeeman_memories:insert")).toBe(
      true,
    );
    expect(JSON.stringify(audit)).not.toContain(a.input.content);
    await store.revoke(a.identity);
    await expect(
      store.authenticate(`Bearer ${a.identity.token}`),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(a.repo.listConversations()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
