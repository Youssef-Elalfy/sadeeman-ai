import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { loadConfig } from "../apps/api/dist/config.js";
import {
  classifyAuthCleanup,
  expectedSignedOutDenial,
} from "../apps/api/dist/evals/session.js";
import { projectRoot } from "../apps/api/dist/persistence/local.js";
import { Repository } from "../apps/api/dist/persistence/repository.js";
import { SupabaseDatabase } from "../apps/api/dist/persistence/supabase.js";

// Existing authenticated transport/repository, real Cloud only. No model/search
// imports, administrator keys, arbitrary SQL, migration or history operations.
const required = ["--live", "--test-data", "--database-only"];
if (!required.every((flag) => process.argv.includes(flag))) {
  process.stdout.write(
    "Use --live --test-data --database-only for an approved bounded session regression.\n",
  );
  process.exitCode = 2;
} else {
  let stage = "configuration",
    networkRequests = 0,
    createdGuests = 0,
    halted = false;
  const startedAt = Date.now(),
    deadline = AbortSignal.timeout(120000);
  const sequence: {
    stage: string;
    route: string;
    method: string;
    status: number;
  }[] = [];
  const checks: Record<string, boolean> = {};
  const pending: string[] = [
    "Expired signed JWT and Auth not_after expiry: no controlled expired fixture was supplied or exercised; no TTL, Auth row or clock was altered.",
    "Valid signed JWT with missing session_id: requires an approved controlled SQL/JWT fixture; not fabricated here.",
  ];
  let unexpectedHttp: { stage: string; route: string; status: number } | null =
    null;
  const runId = randomUUID();
  const privateDirectory = resolve(
    projectRoot,
    ".private",
    `session-cloud-${runId}`,
  );
  const fixtureIds: {
    label: string;
    ownerId: string;
    sessionId: string;
    conversationId?: string;
  }[] = [];
  const TokenClaims = z.object({
    sub: z.uuid(),
    session_id: z.uuid(),
    exp: z.number().int(),
    is_anonymous: z.literal(true),
  });
  const claims = (token: string) =>
    TokenClaims.parse(
      JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
      ),
    );
  let expectedStatus = new Set<number>();
  let status = "FAILED_OR_BLOCKED";
  try {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: "test",
      PERSISTENCE_MODE: "supabase",
      ENABLE_REAL_PROVIDER: "false",
      ENABLE_TRAVEL_RESEARCH: "false",
      ENABLE_OPENROUTER_RUNTIME: "false",
    });
    const target = z
      .object({
        projectRef: z.literal("ujdzysbowngtkwndgoqf"),
        apiUrl: z.literal("https://ujdzysbowngtkwndgoqf.supabase.co"),
      })
      .parse(
        JSON.parse(
          await readFile(
            resolve(projectRoot, "config/supabase-target.json"),
            "utf8",
          ),
        ),
      );
    assert.equal(config.SUPABASE_PROJECT_REF, target.projectRef);
    assert.equal(config.SUPABASE_URL, target.apiUrl);
    const fetcher: typeof fetch = async (input, options) => {
      if (halted || deadline.aborted || networkRequests >= 48)
        throw new Error("BOUNDED_RUN_STOPPED");
      const url = new URL(String(input)),
        method = options?.method ?? "GET";
      assert.equal(url.origin, target.apiUrl);
      const routes: Record<string, string[]> = {
        "/auth/v1/signup": ["POST"],
        "/auth/v1/user": ["GET"],
        "/auth/v1/token": ["POST"],
        "/auth/v1/logout": ["POST"],
        "/rest/v1/rpc/sadeeman_operation": ["POST"],
        "/rest/v1/rpc/sadeeman_session_active": ["POST"],
        "/rest/v1/sadeeman_conversations": ["GET"],
        "/rest/v1/sadeeman_session_revocations": ["POST"],
      };
      assert.ok(routes[url.pathname]?.includes(method), "UNAPPROVED_ROUTE");
      networkRequests++;
      try {
        const response = await fetch(input, {
          ...options,
          redirect: "error",
          signal: AbortSignal.any([
            deadline,
            ...(options?.signal ? [options.signal] : []),
            AbortSignal.timeout(10000),
          ]),
        });
        sequence.push({
          stage,
          route: url.pathname,
          method,
          status: response.status,
        });
        if (
          !response.ok &&
          !expectedStatus.has(response.status) &&
          !expectedSignedOutDenial(stage, url.pathname, response.status)
        ) {
          unexpectedHttp = {
            stage,
            route: url.pathname,
            status: response.status,
          };
          halted = true;
          await response.body?.cancel();
          throw new Error("UNEXPECTED_HTTP_STATUS");
        }
        return response;
      } catch {
        halted = true; // SDK retries cannot generate another network request.
        throw new Error("CLOUD_REQUEST_STOPPED");
      }
    };
    const db = new SupabaseDatabase(config, fetcher);
    const direct = (
      token: string,
      path: string,
      method = "POST",
      body?: unknown,
    ) =>
      fetcher(target.apiUrl + path, {
        method,
        headers: {
          apikey: config.SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    stage = "create_and_authenticate_two_guests";
    const sessionA = await db.guest();
    createdGuests++;
    const sessionB = await db.guest();
    createdGuests++;
    let a = await db.authenticate(`Bearer ${sessionA.token}`);
    const b = await db.authenticate(`Bearer ${sessionB.token}`);
    assert.notEqual(a.ownerId, b.ownerId);
    // Decoding occurs AFTER real Auth verification; it is only test metadata,
    // never an authorization decision or evidence that a JWT signature is valid.
    const aClaims = claims(a.token),
      bClaims = claims(b.token);
    assert.equal(aClaims.sub, a.ownerId);
    assert.equal(bClaims.sub, b.ownerId);
    assert.notEqual(aClaims.session_id, bClaims.session_id);
    fixtureIds.push(
      { label: "A", ownerId: a.ownerId, sessionId: aClaims.session_id },
      { label: "B", ownerId: b.ownerId, sessionId: bClaims.session_id },
    );
    checks.twoDistinctAuthenticatedGuests = true;
    stage = "create_owned_synthetic_conversations";
    let repoA = new Repository(db, a);
    const repoB = new Repository(db, b);
    const ca = await repoA.createConversation(),
      cb = await repoB.createConversation();
    const fixtureA = fixtureIds[0],
      fixtureB = fixtureIds[1];
    if (!fixtureA || !fixtureB) throw new Error("MISSING_TEST_FIXTURES");
    fixtureA.conversationId = ca.id;
    fixtureB.conversationId = cb.id;
    await mkdir(privateDirectory, { recursive: true });
    await writeFile(
      resolve(privateDirectory, "test-ids.json"),
      JSON.stringify({
        runId,
        fixtures: fixtureIds,
        containsCredentials: false,
      }),
    );
    stage = "owner_reads_and_two_user_isolation";
    assert.equal((await repoA.conversation(ca.id)).id, ca.id);
    assert.equal((await repoB.conversation(cb.id)).id, cb.id);
    for (const [identity, id] of [
      [a, cb.id],
      [b, ca.id],
    ] as const) {
      const response = await direct(
        identity.token,
        `/rest/v1/sadeeman_conversations?select=id&id=eq.${id}`,
        "GET",
      );
      assert.deepEqual(
        z.array(z.object({ id: z.uuid() })).parse(await response.json()),
        [],
      );
    }
    checks.ownedConversationsAndCrossUserRls = true;
    stage = "deny_cross_user_session_revocation";
    expectedStatus = new Set([403]);
    const denial = await direct(
      a.token,
      "/rest/v1/sadeeman_session_revocations",
      "POST",
      { session_id: bClaims.session_id },
    );
    assert.equal(denial.status, 403);
    assert.equal(
      z.object({ code: z.literal("42501") }).parse(await denial.json()).code,
      "42501",
    );
    expectedStatus.clear();
    assert.equal(
      (await db.authenticate(`Bearer ${b.token}`)).ownerId,
      b.ownerId,
    );
    checks.crossUserRevocationDeniedAndVictimStillActive = true;
    stage = "refresh_and_reopen_legitimate_session";
    if (!sessionA.refreshToken) throw new Error("MISSING_TEST_REFRESH");
    const refreshed = await db.refresh(sessionA.refreshToken);
    a = await db.authenticate(`Bearer ${refreshed.token}`);
    assert.equal(a.ownerId, aClaims.sub);
    assert.equal(claims(a.token).session_id, aClaims.session_id);
    repoA = new Repository(new SupabaseDatabase(config, fetcher), a);
    assert.equal((await repoA.conversation(ca.id)).id, ca.id);
    assert.equal((await repoB.conversation(cb.id)).id, cb.id);
    checks.refreshAndRecreatedClientContinuity = true;
    stage = "remove_only_this_runs_two_test_conversations";
    await repoA.deleteConversation(ca.id);
    await repoB.deleteConversation(cb.id);
    checks.testConversationCleanup = true;
    stage = "application_revocation_rejected";
    await db.revoke(b);
    assert.equal(
      z
        .boolean()
        .parse(
          await (
            await direct(
              b.token,
              "/rest/v1/rpc/sadeeman_session_active",
              "POST",
              {},
            )
          ).json(),
        ),
      false,
    );
    expectedStatus = new Set([400, 401]);
    await assert.rejects(
      db.authenticate(`Bearer ${b.token}`),
      (e: unknown) =>
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        e.code === "UNAUTHORIZED",
    );
    expectedStatus.clear();
    checks.revokedSessionRejected = true;
    stage = "other_user_remains_active_after_victim_logout";
    assert.equal(
      (await db.authenticate(`Bearer ${a.token}`)).ownerId,
      a.ownerId,
    );
    checks.otherUserUnaffectedByLogout = true;
    stage = "auth_signout_removes_session_and_rejects_unexpired_jwt";
    const signoutA = await direct(a.token, "/auth/v1/logout?scope=local");
    assert.equal(signoutA.status, 204);
    assert.ok(claims(a.token).exp > Math.floor(Date.now() / 1000));
    // Auth may return 403 for a signed-out session. The adapter must still map
    // this denial to UNAUTHORIZED; accepting it here permits no successful access.
    expectedStatus = new Set([400]);
    const missing = await direct(
      a.token,
      "/rest/v1/rpc/sadeeman_session_active",
      "POST",
      {},
    );
    if (missing.status === 200)
      assert.equal(z.boolean().parse(await missing.json()), false);
    else {
      assert.ok(
        expectedSignedOutDenial(
          stage,
          "/rest/v1/rpc/sadeeman_session_active",
          missing.status,
        ),
      );
      await missing.body?.cancel();
    }
    await assert.rejects(
      db.authenticate(`Bearer ${a.token}`),
      (e: unknown) =>
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        e.code === "UNAUTHORIZED",
    );
    checks.signedUnexpiredJwtWithRemovedAuthSessionRejected = true;
    stage = "cleanup_second_auth_session";
    expectedStatus.clear();
    const signoutB = await direct(b.token, "/auth/v1/logout?scope=local");
    const cleanup = classifyAuthCleanup(signoutB.status);
    assert.notEqual(cleanup, "UNEXPECTED");
    await signoutB.body?.cancel();
    checks.authSessionCleanup = cleanup === "CONFIRMED_SIGNOUT";
    if (cleanup === "DENIED_UNCONFIRMED")
      pending.push(
        "B Auth sign-out was denied; this does not confirm Auth-session removal. Review the scoped fixture with authorized administrative access.",
      );
    // Neither tampering with a JWT nor revocation proves expiry rejection. The
    // pending fixtures above cannot be silently converted into a Cloud pass.
    status = "TWO_USER_CHECKS_PASSED_ACCEPTANCE_INCOMPLETE";
    stage = "complete";
  } catch {
    process.exitCode = 1;
    pending.push(
      "Run stopped at the recorded stage; inspect scoped test cleanup before any further live attempt.",
    );
  } finally {
    const evidence = {
      runId,
      status,
      stage,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      projectRef: "ujdzysbowngtkwndgoqf",
      limits: {
        maxRequests: 48,
        maxDurationMs: 120000,
        retries: 0,
        maxGuests: 2,
      },
      networkRequests,
      createdGuests,
      checks,
      pending,
      unexpectedHttp,
      sequence,
      migrationExecutions: 0,
      historyChanges: 0,
      authConfigurationChanges: 0,
      realModelOrSearchCalls: 0,
      credentialsDisplayed: false,
      note: "Two test-only guest Auth accounts remain; no privileged user deletion was attempted.",
    };
    await writeFile(
      resolve(projectRoot, `docs/reports/SESSION_CLOUD_TWO_USER_${runId}.json`),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { flag: "wx" },
    );
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  }
}
