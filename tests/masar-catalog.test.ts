import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLocalDatabase,
  type LocalDatabase,
} from "../apps/api/src/persistence/local.js";
import type { Identity } from "../apps/api/src/persistence/types.js";
import { PersistentCompanyCatalog } from "../apps/api/src/travel/catalog.js";

// Real embedded PostgreSQL with the shipped migrations only (no proposals, no
// demo claim): exactly what a normal guest gets. Offline; scratch directory.
let dir: string;
let store: LocalDatabase;
let guest: Identity;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "sadeeman-masar-catalog-"));
  store = await createLocalDatabase(dir);
  guest = await store.authenticate(`Bearer ${(await store.guest()).token}`);
});
afterAll(async () => {
  await store.db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("MASAR demo catalog — normal guest access", () => {
  it("shows all four published packages with prices and day-by-day schedules", async () => {
    const rows = (await store.call(guest, "catalog_search", {})) as {
      code: string;
      destination: string;
      days: number;
      isDemo: boolean;
      price: { amountMinor: number; currency: string; basis: string };
      activities: { day: number | null }[];
    }[];
    expect(
      rows.map((r) => [r.destination, r.days, r.price.amountMinor]).sort(),
    ).toEqual([
      ["Fayoum", 2, 320000],
      ["Hurghada", 4, 650000],
      ["Nubia", 5, 920000],
      ["Sharm El Sheikh", 4, 780000],
    ]);
    for (const r of rows) {
      expect(r.isDemo).toBe(true);
      expect(r.price).toMatchObject({ currency: "EGP", basis: "per_adult" });
      expect(r.activities.length).toBe(r.days);
    }
  });
  it("finds a package by its Arabic name through the agent tool", async () => {
    const result = await new PersistentCompanyCatalog(store).search(
      { destination: "الغردقة" },
      {
        ownerId: guest.ownerId,
        conversationId: "00000000-0000-4000-a000-000000000009",
        signal: AbortSignal.timeout(5000),
        identity: guest,
      },
    );
    expect(result).toMatchObject({ status: "ok", evidence: "company_demo" });
    expect(JSON.stringify(result.data)).toContain("Hurghada");
  });
  it("is read-only for guests", async () => {
    await expect(
      store.db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.exec(
          "delete from public.sadeeman_company_packages where code like 'masar-demo-%'",
        );
      }),
    ).rejects.toThrow();
  });
});
