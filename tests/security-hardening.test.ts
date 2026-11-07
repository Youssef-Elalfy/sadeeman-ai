import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createLocalDatabase,
  type LocalDatabase,
  projectRoot,
} from "../apps/api/src/persistence/local.js";
import { Repository } from "../apps/api/src/persistence/repository.js";
import type {
  Identity,
  Persistence,
} from "../apps/api/src/persistence/types.js";
import { buildServer } from "../apps/api/src/server.js";
import { testConfig } from "./helpers.js";

let baseline: LocalDatabase, hardened: LocalDatabase;
beforeAll(async () => {
  baseline = await createLocalDatabase(undefined, {
    testBeforeMigration: "20261105154454_session_boundary_hardening.sql",
  });
  hardened = await createLocalDatabase(undefined, {
    includeProposed: true,
    allowCatalogDemo: true,
  });
}, 30000);
afterAll(async () => {
  await baseline?.close();
  await hardened?.close();
});
async function principal(db: LocalDatabase) {
  const session = await db.guest(),
    identity = await db.authenticate(`Bearer ${session.token}`);
  const result = await db.db.query<{ session_id: string }>(
    "select session_id from sadeeman_private.sessions where owner_id=$1",
    [identity.ownerId],
  );
  const sid = result.rows[0]?.session_id;
  if (!sid) throw new Error("Missing test session");
  return { identity, sid, repo: new Repository(db, identity) };
}
async function asUser<T>(
  db: LocalDatabase,
  identity: Identity,
  claims: Record<string, unknown>,
  query: string,
  params: unknown[] = [],
) {
  return db.db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query(
      "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [
        identity.ownerId,
        JSON.stringify({
          sub: identity.ownerId,
          exp: Math.floor(Date.now() / 1000) + 3600,
          ...claims,
        }),
      ],
    );
    return tx.query<T>(query, params);
  });
}
describe("security proposals in real local PostgreSQL only — Cloud unchanged", () => {
  it("reproduces sessionless access and verifies the proposed helper fails closed", async () => {
    for (const [db, expected] of [
      [baseline, true],
      [hardened, false],
    ] as const) {
      const a = await principal(db);
      expect(
        (
          await asUser<{ active: boolean }>(
            db,
            a.identity,
            {},
            "select public.sadeeman_session_active() as active",
          )
        ).rows[0]?.active,
      ).toBe(expected);
    }
  });
  it.each([null, "", "not-a-uuid"])(
    "rejects invalid session claim %s without leaking a database error",
    async (session_id) => {
      const a = await principal(hardened);
      expect(
        (
          await asUser<{ active: boolean }>(
            hardened,
            a.identity,
            { session_id },
            "select public.sadeeman_session_active() as active",
          )
        ).rows[0]?.active,
      ).toBe(false);
    },
  );
  it("reproduces cross-session UUID preemption and blocks it with the proposed INSERT check", async () => {
    const a = await principal(baseline),
      b = await principal(baseline);
    await asUser(
      baseline,
      a.identity,
      { session_id: a.sid },
      "insert into public.sadeeman_session_revocations(session_id) values($1)",
      [b.sid],
    );
    // Exercise the old SQL directly: the newly hardened local transport already
    // rejects this preempted session before the vulnerable RPC is reached.
    await asUser(
      baseline,
      b.identity,
      { session_id: b.sid },
      "select public.sadeeman_operation('revoke_session','{}'::jsonb)",
    );
    expect(
      (
        await asUser<{ active: boolean }>(
          baseline,
          b.identity,
          { session_id: b.sid },
          "select public.sadeeman_session_active() as active",
        )
      ).rows[0]?.active,
    ).toBe(true);
    const x = await principal(hardened),
      y = await principal(hardened);
    await expect(
      asUser(
        hardened,
        x.identity,
        { session_id: x.sid },
        "insert into public.sadeeman_session_revocations(session_id) values($1)",
        [y.sid],
      ),
    ).rejects.toThrow();
    await hardened.call(y.identity, "revoke_session", {});
    expect(
      (
        await asUser<{ active: boolean }>(
          hardened,
          y.identity,
          { session_id: y.sid },
          "select public.sadeeman_session_active() as active",
        )
      ).rows[0]?.active,
    ).toBe(false);
  });
  it("keeps consent/memory triggers effective after direct EXECUTE is revoked", async () => {
    const a = await principal(hardened),
      c = await a.repo.createConversation();
    const consent = await a.repo.consent({
      purpose: "travel_preferences",
      version: "memory-v1",
      accepted: true,
      requestId: randomUUID(),
    });
    const m = await a.repo.saveMemory({
      consentId: consent.id,
      category: "language",
      content: "TEST ONLY Arabic",
      sourceConversationId: c.id,
      expiresInDays: 30,
      requestId: randomUUID(),
    });
    expect((await a.repo.memories()).map((p) => p.id)).toContain(m.id);
    const permissions = await hardened.db.query<{ allowed: boolean }>(
      "select has_function_privilege('authenticated','sadeeman_private.guard_memory()','execute') as allowed",
    );
    expect(permissions.rows[0]?.allowed).toBe(false);
    await expect(
      asUser(
        hardened,
        a.identity,
        { session_id: a.sid },
        "update public.sadeeman_consents set accepted=false where id=$1",
        [consent.id],
      ),
    ).rejects.toThrow();
    await a.repo.revokeConsent(consent.id);
    expect(await a.repo.memories()).toEqual([]);
  });
  it("preserves every catalog visibility mode after the policy optimization", async () => {
    const a = await principal(baseline),
      b = await principal(hardened),
      id = randomUUID();
    const p = {
      id,
      code: "TEST-SECURITY-DEMO",
      title: "FICTIONAL DEMO",
      destination: "TEST ONLY",
      description: null,
      nights: null,
      days: 2,
      isDemo: true,
      status: "published",
      price: { amountMinor: null },
      approval: { sourceRef: null, verifiedAt: null },
      departures: [],
      inclusions: [],
      exclusions: [],
      activities: [],
    };
    for (const db of [baseline, hardened])
      await db.db.query(
        "insert into public.sadeeman_company_packages(id,document) values($1,$2::jsonb)",
        [id, JSON.stringify(p)],
      );
    for (const extra of [
      {},
      { user_metadata: { catalog_demo: true } },
      { app_metadata: { catalog_demo: true } },
    ]) {
      const old = await asUser(
        baseline,
        a.identity,
        { session_id: a.sid, ...extra },
        "select id from public.sadeeman_company_packages order by id",
      );
      const next = await asUser(
        hardened,
        b.identity,
        { session_id: b.sid, ...extra },
        "select id from public.sadeeman_company_packages order by id",
      );
      expect(next.rows).toEqual(old.rows);
      expect(next.rows.length).toBe("app_metadata" in extra ? 1 : 0);
    }
  });
  it("adds only the two missing index paths and keeps existing indexes", async () => {
    const result = await hardened.db.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname='public'",
    );
    const names = result.rows.map((p) => p.indexname);
    expect(names).toContain("sadeeman_memories_source_conversation_owner_idx");
    expect(names).toContain("sadeeman_messages_turn_owner_conversation_idx");
    expect(names).toContain("sadeeman_audit_events_owner_id_id_idx");
    expect(names).toContain("sadeeman_session_revocations_owner_id_idx");
    const proposal = await readFile(
      resolve(
        projectRoot,
        "supabase/migrations/proposed/20261105154456_catalog_rls_and_targeted_indexes.sql",
      ),
      "utf8",
    );
    expect(proposal).not.toMatch(/\b(drop|delete|truncate|grant)\b/i);
  });
});

describe("no-cost backend guest defenses — mocked Auth only", () => {
  function mockPersistence() {
    const guest = vi.fn(async () => ({
      token: "TEST-ONLY-TOKEN",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      dataMode: "synthetic_only" as const,
    }));
    const persistence: Persistence = {
      mode: "supabase",
      auth: {
        guest,
        authenticate: async () => {
          throw new Error("Unused");
        },
        revoke: async () => {},
      },
      transport: {
        call: async () => {
          throw new Error("Unused");
        },
        close: async () => {},
      },
    };
    return { persistence, guest };
  }
  it("limits guest account creation per real IP; spoofed forwarding headers do not reset it", async () => {
    const p = mockPersistence(),
      app = await buildServer({
        config: testConfig({ GUEST_RATE_LIMIT_MAX: 2 }),
        persistence: p.persistence,
      });
    try {
      for (let n = 0; n < 3; n++) {
        const result = await app.inject({
          method: "POST",
          url: "/api/v1/auth/guest",
          headers: { "x-forwarded-for": `192.0.2.${n + 1}` },
          payload: { acceptSyntheticDataPolicy: true },
        });
        expect(result.statusCode).toBe(n < 2 ? 201 : 429);
      }
      expect(p.guest).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
  it("requires a nonempty CAPTCHA token only when explicitly configured, forwarding verification to Auth", async () => {
    const p = mockPersistence(),
      app = await buildServer({
        config: testConfig({
          PERSISTENCE_MODE: "supabase",
          REQUIRE_GUEST_CAPTCHA: true,
        }),
        persistence: p.persistence,
      });
    try {
      for (const captchaToken of [undefined, ""])
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/api/v1/auth/guest",
              payload: {
                acceptSyntheticDataPolicy: true,
                ...(captchaToken !== undefined ? { captchaToken } : {}),
              },
            })
          ).statusCode,
        ).toBe(400);
      expect(p.guest).not.toHaveBeenCalled();
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/auth/guest",
            payload: {
              acceptSyntheticDataPolicy: true,
              captchaToken: "TEST-ONLY-CAPTCHA",
            },
          })
        ).statusCode,
      ).toBe(201);
      expect(p.guest).toHaveBeenCalledWith("TEST-ONLY-CAPTCHA");
    } finally {
      await app.close();
    }
  });
});
