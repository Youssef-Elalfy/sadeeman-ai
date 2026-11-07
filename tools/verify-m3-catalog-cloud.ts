import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CompanyPackage, TravelState } from "@sadeeman/contracts";
import { z } from "zod";
import { loadConfig } from "../apps/api/dist/config.js";
import { safeError } from "../apps/api/dist/errors.js";
import { projectRoot } from "../apps/api/dist/persistence/local.js";
import { Repository } from "../apps/api/dist/persistence/repository.js";
import { SupabaseDatabase } from "../apps/api/dist/persistence/supabase.js";
import { createTools } from "../apps/api/dist/tools/registry.js";
import { PersistentCompanyCatalog } from "../apps/api/dist/travel/catalog.js";

// Explicit automated Cloud test. No model adapter, Tavily client, service-role key or fixture runtime is enabled.
// A/B tokens and refresh tokens stay in process memory. Only non-secret setup IDs go into .private/.
const required = ["--live", "--test-data", "--database-only"];
if (!required.every((flag) => process.argv.includes(flag))) {
  process.stderr.write(
    "Use --live --test-data --database-only after the exact M3 Cloud migration has been approved/applied.\n",
  );
  process.exitCode = 2;
} else {
  let stage = "configuration",
    requestCount = 0,
    lastHttp: number | null = null;
  const runId = randomUUID(),
    results: Record<string, boolean> = {};
  const directory = resolve(projectRoot, ".private", `m3-cloud-${runId}`);
  const reportPath = resolve(
    projectRoot,
    "docs/reports/M3_CLOUD_INTEGRATION_2026-11-05.json",
  );
  const publish = (value: Record<string, unknown>) =>
    process.stdout.write(`${JSON.stringify(value)}\n`);
  try {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: "test",
      PERSISTENCE_MODE: "supabase",
      ENABLE_REAL_PROVIDER: "false",
      ENABLE_TRAVEL_RESEARCH: "false",
      ENABLE_OPENROUTER_RUNTIME: "false",
      ENABLE_COMPANY_CATALOG: "true",
      ENABLE_TRAVEL_CONTEXT: "true",
      ENABLE_TRAVEL_CONTEXT_PERSISTENCE: "true",
      ALLOW_CATALOG_DEMO: "true",
    });
    assert.equal(config.SUPABASE_PROJECT_REF, "ujdzysbowngtkwndgoqf");
    assert.equal(
      config.SUPABASE_URL,
      "https://ujdzysbowngtkwndgoqf.supabase.co",
    );
    const fetcher: typeof fetch = async (input, options) => {
      const url = new URL(String(input));
      assert.equal(url.origin, config.SUPABASE_URL);
      assert.ok(
        url.pathname.startsWith("/auth/v1/") ||
          url.pathname.startsWith("/rest/v1/"),
      );
      assert.ok(++requestCount <= 80, "DATABASE_REQUEST_LIMIT");
      const response = await fetch(input, {
        ...options,
        redirect: "error",
        signal: AbortSignal.any([
          ...(options?.signal ? [options.signal] : []),
          AbortSignal.timeout(15000),
        ]),
      });
      lastHttp = response.status;
      return response;
    };
    const db = new SupabaseDatabase(config, fetcher);
    stage = "create_two_test_identities";
    const firstSession = await db.guest(),
      secondSession = await db.guest();
    assert.ok(firstSession.refreshToken && secondSession.refreshToken);
    let first = await db.authenticate(`Bearer ${firstSession.token}`);
    const second = await db.authenticate(`Bearer ${secondSession.token}`);
    assert.notEqual(first.ownerId, second.ownerId);
    results.twoDistinctAuthenticatedUsers = true;
    stage = "prepare_fictional_test_records";
    const fixture = z
      .object({
        packages: z
          .array(
            z.object({
              nameAr: z.string(),
              destination: z.string(),
              days: z.number(),
              nights: z.number(),
              currency: z.string(),
              pricePerAdult: z.number(),
              inclusions: z.array(z.string()),
              exclusions: z.array(z.string()),
            }),
          )
          .min(2),
      })
      .parse(
        JSON.parse(
          await readFile(
            resolve(projectRoot, "fixtures/company_packages.DEMO_ONLY.json"),
            "utf8",
          ),
        ),
      );
    const programs = fixture.packages.slice(0, 2).map((p, index) =>
      CompanyPackage.parse({
        id: randomUUID(),
        code: `M3-TEST-${runId}-${index + 1}`,
        title: `FICTIONAL DEMO — ${p.nameAr}`,
        destination: p.destination,
        aliases: [],
        description: "AUTOMATED VERIFICATION ONLY — NOT A COMMERCIAL OFFER",
        days: p.days,
        nights: p.nights,
        price: {
          amountMinor: p.pricePerAdult * 100,
          currency: p.currency,
          basis: "per_adult",
          forTravellers: null,
          verifiedAt: null,
        },
        departures: [],
        inclusions: p.inclusions,
        exclusions: p.exclusions,
        activities: [],
        isDemo: true,
        status: "published",
        approval: { sourceRef: null, verifiedAt: null },
      }),
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, "setup.json"),
      JSON.stringify(
        {
          runId,
          firstOwnerId: first.ownerId,
          secondOwnerId: second.ownerId,
          programs,
          setupPurpose: "ISOLATED_AUTOMATED_TEST_ONLY",
          containsCredentials: false,
        },
        null,
        2,
      ),
    );
    publish({
      status: "AWAITING_SCOPED_TEST_SETUP",
      directory,
      runId,
      testUsers: 2,
      fixtureRecords: 2,
      modelCalls: 0,
      searchCalls: 0,
    });
    stage = "wait_for_scoped_setup";
    const deadline = Date.now() + 240000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const signal = z
          .object({ runId: z.uuid(), ready: z.literal(true) })
          .parse(
            JSON.parse(
              await readFile(resolve(directory, "ready.json"), "utf8"),
            ),
          );
        assert.equal(signal.runId, runId);
        ready = true;
        break;
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
      }
      await delay(500);
    }
    assert.ok(ready, "TEST_SETUP_TIMEOUT");
    stage = "refresh_authorized_demo_test_session";
    const refreshed = await db.refresh(firstSession.refreshToken);
    first = await db.authenticate(`Bearer ${refreshed.token}`);
    const request = async (
      identity: typeof first,
      path: string,
      method = "GET",
      body?: unknown,
    ) =>
      fetcher(config.SUPABASE_URL + path, {
        method,
        headers: {
          apikey: config.SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${identity.token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    stage = "catalog_search_and_comparison";
    const registry = createTools(
      new PersistentCompanyCatalog(db),
      undefined,
      true,
    );
    const travel = {
      base: TravelState.parse({
        version: 0,
        constraints: {
          travellers: 2,
          adults: 2,
          currency: "EGP",
          budgetMinor: 1600000,
          budgetBasis: "party_total",
        },
        options: [],
      }),
      draft: TravelState.parse({
        version: 0,
        constraints: {
          travellers: 2,
          adults: 2,
          currency: "EGP",
          budgetMinor: 1600000,
          budgetBasis: "party_total",
        },
        options: [],
      }),
      userText: "AUTOMATED PUBLIC TEST",
      dirty: false,
    };
    const context = {
      identity: first,
      ownerId: first.ownerId,
      conversationId: randomUUID(),
      signal: AbortSignal.timeout(90000),
      travel,
    };
    const execute = (name: string, args: Record<string, unknown>) =>
      registry.execute({ id: randomUUID(), name, arguments: args }, context);
    const searched = await execute("search_company_packages", {
      currency: "EGP",
    });
    assert.equal(searched.status, "ok");
    assert.equal(searched.evidence, "company_demo");
    const summary = z.object({
      packages: z.array(
        z.object({
          id: z.uuid(),
          label: z.literal("FICTIONAL DEMO"),
          classification: z.literal("company_demo"),
          bookable: z.literal(false),
          liveInventory: z.literal(false),
          partyTotalMinor: z.number(),
          budgetStatus: z.enum(["within_budget", "over_budget"]),
        }),
      ),
    });
    const matches = summary.parse(searched.data).packages;
    assert.deepEqual(
      new Set(matches.map((p) => p.id)),
      new Set(programs.map((p) => p.id)),
    );
    results.persistedCatalogSearch = true;
    const compared = await execute("compare_company_packages", {
      ids: programs.map((p) => p.id),
    });
    assert.equal(compared.status, "ok");
    const comparedRows = summary.parse(compared.data).packages;
    assert.deepEqual(
      comparedRows.map((p) => p.partyTotalMinor),
      [1380000, 1780000],
    );
    assert.deepEqual(
      comparedRows.map((p) => p.budgetStatus),
      ["within_budget", "over_budget"],
    );
    results.persistedCatalogComparison = true;
    results.fictionalNotVerifiedOrBookable = true;
    const details = await execute("get_company_package", { optionNumber: 2 });
    assert.equal(details.status, "ok");
    assert.deepEqual(
      z
        .object({
          packages: z.array(
            z.object({
              id: z.uuid(),
              departures: z.array(z.unknown()),
              activities: z.array(z.unknown()),
            }),
          ),
        })
        .parse(details.data)
        .packages.map((p) => ({
          id: p.id,
          departures: p.departures,
          activities: p.activities,
        })),
      [{ id: travel.draft.options[1]?.id, departures: [], activities: [] }],
    );
    results.ordinalDetailsAndUnknownSchedules = true;
    const reopened = new SupabaseDatabase(config, fetcher);
    assert.equal(
      CompanyPackage.parse(
        await reopened.call(first, "catalog_get", { id: programs[0]?.id }),
      ).id,
      programs[0]?.id,
    );
    results.catalogPersistsAcrossClientRestart = true;
    stage = "normal_user_demo_isolation_and_write_protection";
    assert.deepEqual(await db.call(second, "catalog_search", {}), []);
    const spoof = await request(second, "/auth/v1/user", "PUT", {
      data: { catalog_demo: true },
    });
    assert.equal(spoof.status, 200);
    await spoof.body?.cancel();
    assert.deepEqual(await db.call(second, "catalog_search", {}), []);
    results.userMetadataCannotRevealDemo = true;
    const attemptedId = randomUUID();
    const deniedInsert = await request(
      second,
      "/rest/v1/sadeeman_company_packages",
      "POST",
      {
        id: attemptedId,
        document: {
          ...programs[0],
          id: attemptedId,
          code: `M3-DENIED-${runId}`,
        },
      },
    );
    assert.equal(deniedInsert.status, 403);
    await deniedInsert.body?.cancel();
    const deniedUpdate = await request(
      first,
      `/rest/v1/sadeeman_company_packages?id=eq.${programs[0]?.id}`,
      "PATCH",
      { document: programs[0] },
    );
    assert.equal(deniedUpdate.status, 403);
    await deniedUpdate.body?.cancel();
    results.catalogInsertAndUpdateDenied = true;
    stage = "two_user_profile_persistence_and_isolation";
    const a = new Repository(db, first),
      b = new Repository(db, second),
      ca = await a.createConversation(),
      cb = await b.createConversation();
    const profileA = TravelState.parse({
        version: 1,
        constraints: { destination: "Italy", days: 7, travellers: 3 },
        options: [],
      }),
      profileB = TravelState.parse({
        version: 1,
        constraints: { destination: "Japan", days: 5, travellers: 2 },
        options: [],
      });
    await a.commit(
      ca.id,
      randomUUID(),
      randomUUID(),
      "PUBLIC AUTOMATED TEST A",
      "TEST A CONTEXT STORED",
      { inputTokens: 0, outputTokens: 0 },
      [],
      { state: profileA, expectedVersion: 0 },
    );
    await b.commit(
      cb.id,
      randomUUID(),
      randomUUID(),
      "PUBLIC AUTOMATED TEST B",
      "TEST B CONTEXT STORED",
      { inputTokens: 0, outputTokens: 0 },
      [],
      { state: profileB, expectedVersion: 0 },
    );
    assert.deepEqual(
      await new Repository(reopened, first).travelState(ca.id),
      profileA,
    );
    assert.deepEqual(
      await new Repository(reopened, second).travelState(cb.id),
      profileB,
    );
    await assert.rejects(
      b.travelState(ca.id),
      (error) => safeError(error).code === "NOT_FOUND",
    );
    await assert.rejects(
      a.travelState(cb.id),
      (error) => safeError(error).code === "NOT_FOUND",
    );
    const crossPatch = await request(
      second,
      `/rest/v1/sadeeman_travel_profiles?conversation_id=eq.${ca.id}`,
      "PATCH",
      { version: 2, state: { ...profileA, version: 2 } },
    );
    assert.equal(crossPatch.status, 200);
    assert.deepEqual(await crossPatch.json(), []);
    assert.deepEqual(await a.travelState(ca.id), profileA);
    results.twoUserProfileIsolation = true;
    results.contextAndMessagesPersist = true;
    const beforeCount = (await a.conversation(ca.id)).messages.length;
    await assert.rejects(
      a.commit(
        ca.id,
        randomUUID(),
        randomUUID(),
        "SHOULD ROLL BACK",
        "SHOULD ROLL BACK",
        { inputTokens: 0, outputTokens: 0 },
        [],
        { state: { ...profileA, version: 3 }, expectedVersion: 2 },
      ),
      (error) => safeError(error).code === "VERSION_CONFLICT",
    );
    assert.equal((await a.conversation(ca.id)).messages.length, beforeCount);
    assert.deepEqual(await a.travelState(ca.id), profileA);
    results.atomicVersionConflictRollback = true;
    stage = "scoped_conversation_cleanup_and_session_revocation";
    await a.deleteConversation(ca.id);
    await b.deleteConversation(cb.id);
    await assert.rejects(
      a.travelState(ca.id),
      (error) => safeError(error).code === "NOT_FOUND",
    );
    await assert.rejects(
      b.travelState(cb.id),
      (error) => safeError(error).code === "NOT_FOUND",
    );
    results.conversationDeletionRemovesProfile = true;
    await db.revoke(first);
    await db.revoke(second);
    await assert.rejects(
      db.call(first, "catalog_search", {}),
      (error) => safeError(error).code === "UNAUTHORIZED",
    );
    results.testSessionsRevoked = true;
    const report = {
      status: "M3_CLOUD_DATABASE_TESTS_PASSED",
      checkedAt: new Date().toISOString(),
      runId,
      projectRef: config.SUPABASE_PROJECT_REF,
      requestCount,
      createdTestUsers: 2,
      fixtureRecords: 2,
      fixtureLabel: "FICTIONAL DEMO — TEST ONLY",
      fixtureCleanup: "PENDING_SCOPED_SQL_CLEANUP",
      results,
      modelCalls: 0,
      searchCalls: 0,
      openRouterCalls: 0,
      credentialsDisplayed: false,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    publish(report);
  } catch (error) {
    const failure = {
      status: "FAILED",
      stage,
      runId,
      requestCount,
      lastHttp,
      category:
        error instanceof assert.AssertionError
          ? "DATABASE_TEST_ASSERTION"
          : safeError(error).code,
      results,
      modelCalls: 0,
      searchCalls: 0,
      credentialsDisplayed: false,
    };
    await writeFile(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    publish(failure);
    process.exitCode = 1;
  }
}
