import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { CompanyPackage, type TravelState } from "@sadeeman/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createLocalDatabase,
  LocalDatabase,
  projectRoot,
} from "../apps/api/src/persistence/local.js";
import { Repository } from "../apps/api/src/persistence/repository.js";
import type { Identity } from "../apps/api/src/persistence/types.js";
import { createTools } from "../apps/api/src/tools/registry.js";
import {
  PersistentCompanyCatalog,
  packageCost,
} from "../apps/api/src/travel/catalog.js";
import { emptyTravelState } from "../apps/api/src/travel/context.js";
import { tool } from "./helpers.js";

// All inserts below are TEST ONLY. No application module imports fixture data.
let store: LocalDatabase, identity: Identity, other: Identity;
let setupPromise: Promise<void> | undefined;
let rows: CompanyPackage[];
const path = resolve(projectRoot, `.private/tests/catalog-${randomUUID()}`);
const state: TravelState = emptyTravelState();
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}
const context = () => ({
  ownerId: identity.ownerId,
  identity,
  conversationId: randomUUID(),
  signal: new AbortController().signal,
  travel: {
    base: structuredClone(state),
    draft: structuredClone(state),
    userText: "TEST ONLY",
    dirty: false,
  },
});
async function insert(p: CompanyPackage) {
  const checked = CompanyPackage.parse(p);
  await store.db.query(
    "insert into public.sadeeman_company_packages(id,document) values($1,$2::jsonb)",
    [checked.id, JSON.stringify(checked)],
  );
}
async function userSql(sql: string, claims: Record<string, unknown> = {}) {
  const session = await store.db.query<{ session_id: string }>(
    "select session_id from sadeeman_private.sessions where owner_id=$1 and revoked_at is null",
    [identity.ownerId],
  );
  const sid = session.rows[0]?.session_id;
  if (!sid) throw new Error("Missing test session");
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
          ...claims,
        }),
      ],
    );
    return tx.query(sql);
  });
}
beforeAll(() => {
  setupPromise = (async () => {
    await mkdir(path, { recursive: true });
    store = await createLocalDatabase(path, {
      includeProposed: true,
      allowCatalogDemo: true,
    });
    identity = await store.authenticate(
      `Bearer ${(await store.guest()).token}`,
    );
    other = await store.authenticate(`Bearer ${(await store.guest()).token}`);
    const source = z
      .object({
        packages: z.array(
          z.object({
            id: z.string(),
            nameAr: z.string(),
            destination: z.string(),
            days: z.number(),
            nights: z.number(),
            currency: z.string(),
            pricePerAdult: z.number(),
            inclusions: z.array(z.string()),
            exclusions: z.array(z.string()),
          }),
        ),
      })
      .parse(
        JSON.parse(
          await readFile(
            resolve(projectRoot, "fixtures/company_packages.DEMO_ONLY.json"),
            "utf8",
          ),
        ),
      );
    rows = source.packages.map((p) =>
      CompanyPackage.parse({
        id: randomUUID(),
        code: p.id,
        title: p.nameAr,
        destination: p.destination,
        aliases: [],
        description: null,
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
    for (const row of rows) await insert(row);
  })();
  return setupPromise;
}, 60000);
afterAll(async () => {
  // A timed-out hook does not cancel PostgreSQL initialization. Never remove
  // its data directory while that initialization is still writing to it.
  await setupPromise?.catch(() => undefined);
  await store?.close();
  const boundary = resolve(projectRoot, ".private/tests") + sep;
  if (!path.startsWith(boundary)) throw new Error("Unsafe cleanup path");
  await rm(path, { recursive: true, force: true });
}, 60000);

describe("M3 company catalog — actual local PostgreSQL, fictional test data", () => {
  it("enforces RLS on both new tables and invoker/anon permissions on all new RPCs", async () => {
    const tables = await store.db.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      "select relrowsecurity,relforcerowsecurity from pg_class where oid in ('public.sadeeman_company_packages'::regclass,'public.sadeeman_travel_profiles'::regclass)",
    );
    expect(tables.rows).toHaveLength(2);
    expect(
      tables.rows.every((p) => p.relrowsecurity && p.relforcerowsecurity),
    ).toBe(true);
    const functions = await store.db.query<{
      prosecdef: boolean;
      proconfig: string[];
      anon: boolean;
      authenticated: boolean;
    }>(
      "select p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('sadeeman_catalog','sadeeman_travel_profile','sadeeman_commit_travel_turn')",
    );
    expect(functions.rows).toHaveLength(3);
    expect(
      functions.rows.every(
        (p) =>
          !p.prosecdef &&
          !p.anon &&
          p.authenticated &&
          p.proconfig.includes('search_path=""'),
      ),
    ).toBe(true);
  });
  it("persists database data across close/reopen without agent code changes", async () => {
    await store.close();
    store = await createLocalDatabase(path, {
      includeProposed: true,
      allowCatalogDemo: true,
    });
    expect(await store.call(identity, "catalog_search", {})).toHaveLength(4);
    const fresh = CompanyPackage.parse({
      ...rows[0],
      id: randomUUID(),
      code: "TEST-NEW-DATABASE-PROGRAM",
      title: "TEST ONLY new program",
    });
    await insert(fresh);
    expect(
      await store.call(identity, "catalog_get", { id: fresh.id }),
    ).toMatchObject({ title: fresh.title });
  });
  it("filters by destination, exact duration, currency and adult price", async () => {
    const catalog = new PersistentCompanyCatalog(store);
    const result = await catalog.search(
      {
        destination: "Dahab",
        days: 5,
        currency: "EGP",
        maxPricePerAdult: 9000,
      },
      context(),
    );
    expect(result).toMatchObject({
      status: "ok",
      evidence: "company_demo",
      data: {
        packages: [
          { code: "DEMO-SAD-002", label: "FICTIONAL DEMO", bookable: false },
        ],
      },
    });
    expect(
      await catalog.search({ destination: "Dahab", days: 7 }, context()),
    ).toMatchObject({ data: { packages: [] } });
    expect(await catalog.search({ currency: "USD" }, context())).toMatchObject({
      data: { packages: [] },
    });
  });
  it("preserves unknown prices, dates and activities instead of inventing offers", async () => {
    const unknown = CompanyPackage.parse({
      ...rows[0],
      id: randomUUID(),
      code: "TEST-UNKNOWN",
      destination: "Italy",
      price: {
        amountMinor: null,
        currency: null,
        basis: "unknown",
        forTravellers: null,
        verifiedAt: null,
      },
    });
    await insert(unknown);
    const registry = createTools(new PersistentCompanyCatalog(store));
    expect(
      await registry.execute(
        required(tool("get_company_package", { id: unknown.id }).toolCalls[0]),
        context(),
      ),
    ).toMatchObject({
      status: "ok",
      data: {
        packages: [
          {
            price: { amountMinor: null },
            departures: [],
            activities: [],
            datesKnown: false,
            partyTotalMinor: null,
          },
        ],
      },
    });
  });
  it("prices parties only with explicit compatible price basis and composition", () => {
    const p = required(rows[0]);
    expect(packageCost(p, { travellers: 3 })).toMatchObject({
      partyTotalMinor: null,
      budgetStatus: "unknown",
    });
    expect(packageCost(p, { travellers: 3, adults: 2 })).toMatchObject({
      partyTotalMinor: null,
    });
    expect(
      packageCost(p, {
        travellers: 3,
        adults: 3,
        currency: "EGP",
        budgetMinor: 2100000,
        budgetBasis: "party_total",
      }),
    ).toMatchObject({
      partyTotalMinor: 2070000,
      budgetStatus: "within_budget",
    });
    expect(
      packageCost(
        { ...p, price: { ...p.price, basis: "party_total", forTravellers: 2 } },
        { travellers: 3 },
      ),
    ).toMatchObject({ partyTotalMinor: null });
    expect(
      packageCost(
        { ...p, price: { ...p.price, basis: "per_person" } },
        {
          travellers: 2,
          currency: "USD",
          budgetMinor: 2000000,
          budgetBasis: "party_total",
        },
      ).budgetStatus,
    ).toBe("unknown");
  });
  it("ranks within-budget programs and resolves exact stored ordinal references", async () => {
    const c = context();
    c.travel.draft.constraints = {
      travellers: 2,
      adults: 2,
      currency: "EGP",
      budgetMinor: 1200000,
      budgetBasis: "party_total",
    };
    const registry = createTools(new PersistentCompanyCatalog(store));
    await registry.execute(
      required(tool("search_company_packages", {}).toolCalls[0]),
      c,
    );
    expect(c.travel.draft.options[0]?.id).toBe(rows[2]?.id);
    const ids = c.travel.draft.options.slice(0, 2).map((p) => p.id);
    const comparison = await registry.execute(
      required(
        tool("compare_company_packages", { optionNumbers: [2, 1] })
          .toolCalls[0],
      ),
      c,
    );
    expect(comparison).toMatchObject({
      status: "ok",
      data: { packages: [{ id: ids[1] }, { id: ids[0] }] },
    });
    expect(
      await registry.execute(
        required(
          tool("get_company_package", { optionNumber: 20 }).toolCalls[0],
        ),
        c,
      ),
    ).toMatchObject({ code: "OPTION_REFERENCE_NOT_FOUND" });
  });
  it("finds cheaper options with the same currency and known party totals", async () => {
    const c = context();
    c.travel.draft.constraints = { travellers: 2, adults: 2, currency: "EGP" };
    c.travel.draft.options = [
      { id: required(rows[1]).id, title: required(rows[1]).title },
    ];
    const catalog = new PersistentCompanyCatalog(store);
    const r = await catalog.search({ cheaperThanOption: 1 }, c);
    expect(r).toMatchObject({ status: "ok" });
    const parsed = z
      .object({ packages: z.array(z.object({ partyTotalMinor: z.number() })) })
      .parse(r.data);
    expect(parsed.packages.every((p) => p.partyTotalMinor < 1780000)).toBe(
      true,
    );
    expect(c.travel.draft.constraints.budgetMinor).toBeUndefined();
  });
  it("keeps demo and draft records hidden by default; user metadata cannot grant demo access", async () => {
    const normal = new LocalDatabase(store.db);
    expect(await normal.call(identity, "catalog_search", {})).toEqual([]);
    expect(
      (
        await userSql("select id from public.sadeeman_company_packages", {
          user_metadata: { catalog_demo: true },
        })
      ).rows,
    ).toEqual([]);
    const draft = CompanyPackage.parse({
      ...rows[0],
      id: randomUUID(),
      code: "TEST-DRAFT",
      status: "draft",
    });
    await insert(draft);
    expect(
      await store.call(identity, "catalog_get", { id: draft.id }),
    ).toBeNull();
  });
  it("marks an independently verified company record separately from demo and external listings", async () => {
    const official = CompanyPackage.parse({
      ...rows[0],
      id: randomUUID(),
      code: "TEST-VERIFIED",
      title: "TEST ONLY operator record",
      isDemo: false,
      approval: {
        sourceRef: "TEST ONLY authority fixture",
        verifiedAt: "2026-11-05T00:00:00Z",
      },
      price: { ...required(rows[0]).price, verifiedAt: "2026-11-05T00:00:00Z" },
    });
    await insert(official);
    const registry = createTools(
      new PersistentCompanyCatalog(new LocalDatabase(store.db)),
    );
    expect(
      await registry.execute(
        required(tool("get_company_package", { id: official.id }).toolCalls[0]),
        context(),
      ),
    ).toMatchObject({
      evidence: "company_verified",
      data: {
        packages: [
          {
            classification: "company_verified",
            liveInventory: false,
            bookable: false,
          },
        ],
      },
    });
  });
  it("denies catalog writes to authenticated users", async () => {
    await expect(
      userSql(
        "update public.sadeeman_company_packages set document=document where id='" +
          required(rows[0]).id +
          "'",
      ),
    ).rejects.toThrow();
    await expect(
      userSql(
        "delete from public.sadeeman_company_packages where id='" +
          required(rows[0]).id +
          "'",
      ),
    ).rejects.toThrow();
  });
  it("fails closed on malformed package contracts and unapproved real prices", () => {
    expect(
      CompanyPackage.safeParse({ ...rows[0], isDemo: false }).success,
    ).toBe(false);
    expect(
      CompanyPackage.safeParse({
        ...rows[0],
        price: { ...required(rows[0]).price, currency: null },
      }).success,
    ).toBe(false);
  });
  it("atomically commits structured constraints with the conversation, with two-user RLS", async () => {
    const a = new Repository(store, identity),
      b = new Repository(store, other),
      c = await a.createConversation();
    const profile = {
      version: 1,
      constraints: {
        destination: "Italy",
        travellers: 3,
        days: 7,
        startsOn: "2026-12-01",
        endsOn: "2026-12-07",
      },
      options: [],
    };
    await a.commit(
      c.id,
      randomUUID(),
      randomUUID(),
      "TEST ONLY input",
      "TEST ONLY answer",
      { inputTokens: 1, outputTokens: 1 },
      [],
      { state: profile, expectedVersion: 0 },
    );
    expect(await a.travelState(c.id)).toEqual(profile);
    await expect(b.travelState(c.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      b.commit(
        c.id,
        randomUUID(),
        randomUUID(),
        "x",
        "y",
        { inputTokens: 1, outputTokens: 1 },
        [],
        { state: { ...profile, version: 2 }, expectedVersion: 1 },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await store.close();
    store = await createLocalDatabase(path, {
      includeProposed: true,
      allowCatalogDemo: true,
    });
    const restored = new Repository(store, identity);
    expect(await restored.travelState(c.id)).toEqual(profile);
    await restored.deleteConversation(c.id);
    expect(
      (
        await store.db.query(
          "select * from public.sadeeman_travel_profiles where conversation_id=$1",
          [c.id],
        )
      ).rows,
    ).toEqual([]);
  });
  it("rolls back messages and tool records if the context version conflicts", async () => {
    const a = new Repository(store, identity),
      c = await a.createConversation();
    await expect(
      a.commit(
        c.id,
        randomUUID(),
        randomUUID(),
        "TEST rollback",
        "TEST rollback",
        { inputTokens: 1, outputTokens: 1 },
        [],
        {
          state: { version: 3, constraints: {}, options: [] },
          expectedVersion: 2,
        },
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await a.conversation(c.id)).messages).toEqual([]);
    expect(await a.travelState(c.id)).toBeNull();
  });
  it("supports idempotent context commits and rejects revoked sessions", async () => {
    const a = new Repository(store, identity),
      c = await a.createConversation(),
      rid = randomUUID(),
      run = randomUUID();
    const p = {
      state: { version: 1, constraints: { days: 5 }, options: [] },
      expectedVersion: 0,
    };
    await a.commit(
      c.id,
      rid,
      run,
      "TEST same",
      "TEST same",
      { inputTokens: 1, outputTokens: 1 },
      [],
      p,
    );
    await a.commit(
      c.id,
      rid,
      run,
      "TEST same",
      "TEST same",
      { inputTokens: 1, outputTokens: 1 },
      [],
      p,
    );
    expect((await a.conversation(c.id)).messages).toHaveLength(2);
    const temp = await store.authenticate(
      `Bearer ${(await store.guest()).token}`,
    );
    await store.revoke(temp);
    await expect(store.call(temp, "catalog_search", {})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
