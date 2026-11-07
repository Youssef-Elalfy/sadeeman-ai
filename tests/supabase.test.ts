import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../apps/api/src/config.js";
import { SupabaseDatabase } from "../apps/api/src/persistence/supabase.js";
import { testConfig } from "./helpers.js";

const ref = "a".repeat(20),
  url = `https://${ref}.supabase.co`;
const config = testConfig({
  PERSISTENCE_MODE: "supabase",
  SUPABASE_PROJECT_REF: ref,
  SUPABASE_URL: url,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
});
describe("Supabase adapter wire tests — mocked hosted API only, not live Supabase evidence", () => {
  it("restricts the legacy synthetic-input opt-in to an explicit test environment", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        ALLOW_SYNTHETIC_PROVIDER_DATA: "true",
      }),
    ).toThrow("NODE_ENV=test");
    expect(
      loadConfig({ NODE_ENV: "test", ALLOW_SYNTHETIC_PROVIDER_DATA: "true" })
        .ALLOW_SYNTHETIC_PROVIDER_DATA,
    ).toBe(true);
  });
  it("requires the exact project target and rejects private service keys", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        PERSISTENCE_MODE: "supabase",
        SUPABASE_URL: url,
        SUPABASE_PROJECT_REF: ref,
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      }),
    ).toThrow("verified Sadeeman");
    expect(() =>
      loadConfig({
        PERSISTENCE_MODE: "supabase",
        SUPABASE_URL: url,
        SUPABASE_PROJECT_REF: "b".repeat(20),
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      }),
    ).toThrow("target");
    expect(() =>
      loadConfig({
        PERSISTENCE_MODE: "supabase",
        SUPABASE_URL: url,
        SUPABASE_PROJECT_REF: ref,
        SUPABASE_PUBLISHABLE_KEY: "sb_secret_test",
      }),
    ).toThrow();
    const key = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.x`;
    expect(() =>
      loadConfig({
        PERSISTENCE_MODE: "supabase",
        SUPABASE_URL: url,
        SUPABASE_PROJECT_REF: ref,
        SUPABASE_PUBLISHABLE_KEY: key,
      }),
    ).toThrow("never service role");
  });
  it("verifies a bearer token through Auth and forwards the same JWT to RLS; ignores user_metadata privilege claims", async () => {
    const ownerId = randomUUID(),
      token = "synthetic-jwt";
    const fetcher = vi.fn<typeof fetch>(async (target) => {
      if (String(target).endsWith("/auth/v1/user"))
        return Response.json({
          id: ownerId,
          user_metadata: { role: "admin" },
          created_at: "2026-11-05T00:00:00Z",
        });
      return Response.json({ ownerId });
    });
    const store = new SupabaseDatabase(config, fetcher);
    expect(await store.authenticate(`Bearer ${token}`)).toEqual({
      ownerId,
      token,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [, request] = fetcher.mock.calls[1] ?? [];
    expect(new Headers(request?.headers).get("authorization")).toBe(
      `Bearer ${token}`,
    );
    expect(JSON.parse(String(request?.body))).toEqual({
      p_action: "identity",
      p_payload: {},
    });
  });
  it("rejects invalid Auth responses instead of trusting decoded JWT claims", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ message: "invalid token" }, { status: 401 }),
    );
    await expect(
      new SupabaseDatabase(config, fetcher).authenticate("Bearer forged"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects revoked application sessions and mismatched verified identities", async () => {
    const ownerId = randomUUID();
    const fetcher = vi.fn<typeof fetch>(async (target) =>
      String(target).includes("/auth/v1/user")
        ? Response.json({ id: ownerId })
        : Response.json(
            { code: "P0001", message: "UNAUTHORIZED" },
            { status: 400 },
          ),
    );
    await expect(
      new SupabaseDatabase(config, fetcher).authenticate("Bearer synthetic"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const mismatch = vi.fn<typeof fetch>(async (target) =>
      Response.json({
        ...(String(target).includes("/auth/v1/user")
          ? { id: ownerId }
          : { ownerId: randomUUID() }),
      }),
    );
    await expect(
      new SupabaseDatabase(config, mismatch).authenticate("Bearer synthetic"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("keeps anonymous hosted sign-in disabled until explicitly enabled", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new SupabaseDatabase(config, fetcher).guest(),
    ).rejects.toMatchObject({ code: "DISCONNECTED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends RPC arguments as JSON and maps database failures without exposing raw errors", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        { code: "42501", message: "sensitive provider failure" },
        { status: 403 },
      ),
    );
    await expect(
      new SupabaseDatabase(config, fetcher).call(
        { ownerId: randomUUID(), token: "synthetic" },
        "list_memories",
        {},
      ),
    ).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
  });
});
