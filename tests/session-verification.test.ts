import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createLocalDatabase,
  type LocalDatabase,
  projectRoot,
} from "../apps/api/src/persistence/local.js";

const migration = "20261105154454_session_boundary_hardening.sql";
let db: LocalDatabase, verification: string;
beforeAll(async () => {
  db = await createLocalDatabase();
  verification = await readFile(
    resolve(
      projectRoot,
      "supabase/verification/session_boundary_read_only.sql",
    ),
    "utf8",
  );
  // The embedded test database has a separate checksum ledger. This metadata-only
  // fixture supplies the hosted CLI ledger shape for the read-only report query.
  await db.db.exec(
    "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text)",
  );
}, 30000);
afterAll(async () => db?.close());
const VerificationRow = z.object({
  session_security_verification: z.object({
    checks: z.record(z.string(), z.boolean()),
    functions: z.array(
      z.object({
        signature: z.string(),
        approved_body_matches: z.boolean().nullable(),
      }),
    ),
    cloud_session_probes: z.object({
      status: z.string(),
      baselineActive: z.boolean().optional(),
      missingSessionClaimRejected: z.boolean().optional(),
      expiredClaimRejected: z.boolean().optional(),
      nonexistentSessionRejected: z.boolean().optional(),
      continuityRestored: z.boolean().optional(),
    }),
  }),
});
async function report(sql = verification) {
  const results = await db.db.exec(sql);
  for (const row of results.flatMap((r) => r.rows)) {
    const parsed = VerificationRow.safeParse(row);
    if (parsed.success) return parsed.data.session_security_verification;
  }
  throw new Error("Missing or invalid local verification report");
}
describe("manual deployment tracking and read-only verification — local PostgreSQL only", () => {
  it("tracks one unchanged canonical migration with no duplicate proposal", async () => {
    const source = await readFile(
      resolve(projectRoot, "supabase/migrations", migration),
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "770237ab233569ff25899bb4611f0a62d6c98ebb88b08e95b9d0be6593f47aa0",
    );
    expect(
      await readdir(resolve(projectRoot, "supabase/migrations/proposed")),
    ).not.toContain(migration);
    expect(
      (
        await db.db.query<{ name: string }>(
          "select name from sadeeman_private.migrations order by name",
        )
      ).rows.map((r) => r.name),
    ).toContain(migration);
  });
  it("runs the report in a read-only transaction and matches approved bodies, ACLs and RLS", async () => {
    expect(verification).toContain("read only;");
    expect(verification).not.toMatch(
      /^\s*(create|alter|grant|revoke|insert|update|delete|truncate|drop|call)\b/im,
    );
    const result = await report();
    expect(Object.values(result.checks)).toEqual(
      Array(Object.keys(result.checks).length).fill(true),
    );
    expect(
      result.functions.filter((f) => f.approved_body_matches === true),
    ).toHaveLength(2);
    expect(result.cloud_session_probes.status).toBe(
      "BLOCKED_NO_ACTIVE_TEMPORARY_FIXTURE",
    );
  });
  it("detects deployed body drift and an unintended anonymous EXECUTE grant", async () => {
    const original = (
      await db.db.query<{ sql: string }>(
        "select pg_get_functiondef('public.sadeeman_session_active()'::regprocedure) as sql",
      )
    ).rows[0]?.sql;
    if (!original) throw new Error("Missing original local wrapper");
    try {
      await db.db.exec(
        "create or replace function public.sadeeman_session_active() returns boolean language sql stable security invoker set search_path='' as $$ select false $$; grant execute on function sadeeman_private.current_session_valid() to anon;",
      );
      const result = await report();
      expect(result.checks.approved_bodies_match).toBe(false);
      expect(result.checks.function_contracts_match).toBe(false);
      expect(result.cloud_session_probes.status).toBe(
        "BLOCKED_DEPLOYED_DEFINITION_OR_PERMISSION_DRIFT",
      );
    } finally {
      await db.db.exec(original);
      await db.db.exec(
        "revoke execute on function sadeeman_private.current_session_valid() from anon",
      );
    }
  });
  it("proves missing/expired claims only with a valid temporary baseline and blocks revoked fixtures", async () => {
    const session = await db.guest(),
      identity = await db.authenticate(`Bearer ${session.token}`);
    // Local-only Auth metadata fixture; no Cloud schema or user is modified.
    await db.db.exec(
      "alter table auth.users add column is_anonymous boolean default true",
    );
    const sql = verification.replace(
      /-- TEST_OWNER_ALLOWLIST_START[\s\S]*?-- TEST_OWNER_ALLOWLIST_END/,
      `-- TEST_OWNER_ALLOWLIST_START\n'${identity.ownerId}'::uuid\n-- TEST_OWNER_ALLOWLIST_END`,
    );
    const result = await report(sql);
    expect(result.cloud_session_probes).toMatchObject({
      status: "PASS_CONTROLLED_SQL_CLAIMS",
      baselineActive: true,
      missingSessionClaimRejected: true,
      expiredClaimRejected: true,
      nonexistentSessionRejected: true,
      continuityRestored: true,
    });
    expect(await db.authenticate(`Bearer ${session.token}`)).toEqual(identity);
    await db.revoke(identity);
    expect((await report(sql)).cloud_session_probes.status).toBe(
      "BLOCKED_NO_ACTIVE_TEMPORARY_FIXTURE",
    );
  });
  it("rejects historical schema selection outside automated tests before opening a database", async () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      await expect(
        createLocalDatabase(undefined, { testBeforeMigration: migration }),
      ).rejects.toThrow("Historical schema fixtures are restricted");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
