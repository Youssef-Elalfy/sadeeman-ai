import { describe, expect, it } from "vitest";
import { buildServer, trustedOrigins } from "../apps/api/src/server.js";
import { failureMessage } from "../apps/web/lib/api.js";
import {
  CANONICAL_ORIGIN,
  canonicalDestination,
} from "../apps/web/lib/canonical.js";
import { testConfig } from "./helpers.js";

describe("canonical public origin", () => {
  it("allows only the canonical production origin and rejects alternate origins", async () => {
    expect([...trustedOrigins(CANONICAL_ORIGIN)]).toEqual([CANONICAL_ORIGIN]);
    const app = await buildServer({
      config: testConfig({ WEB_ORIGIN: CANONICAL_ORIGIN }),
    });
    try {
      const allowed = await app.inject({
        method: "OPTIONS",
        url: "/api/v1/agent/messages",
        headers: {
          origin: CANONICAL_ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      });
      expect(allowed.statusCode).toBe(204);
      expect(allowed.headers["access-control-allow-origin"]).toBe(
        CANONICAL_ORIGIN,
      );
      for (const origin of [
        "https://sadeeman-ai-youssef-elalfys-projects.vercel.app",
        "https://sadeeman-ai.vercel.app.evil.example",
        "http://sadeeman-ai.vercel.app",
        "https://sadeeman-ai.vercel.app:8443",
      ]) {
        const denied = await app.inject({
          method: "OPTIONS",
          url: "/api/v1/agent/messages",
          headers: { origin },
        });
        expect(denied.statusCode).toBe(403);
        expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  });
  it("redirects hosted alternate Vercel documents to a fixed canonical URL, preserving path and query", () => {
    for (const host of [
      "sadeeman-ai-youssef-elalfys-projects.vercel.app",
      "sadeeman-ai-git-main-youssef-elalfys-projects.vercel.app",
      "sadeeman-example-youssef-elalfys-projects.vercel.app",
    ]) {
      expect(
        canonicalDestination(
          new URL(`https://${host}/privacy?next=https%3A%2F%2Fevil.example`),
          true,
        )?.href,
      ).toBe(`${CANONICAL_ORIGIN}/privacy?next=https%3A%2F%2Fevil.example`);
    }
  });
  it("does not loop on the canonical URL or redirect local/non-Vercel development hosts", () => {
    for (const url of [
      CANONICAL_ORIGIN,
      "http://localhost:3000/",
      "https://example.com/",
      "https://sadeeman-ai.vercel.app.evil.example/",
    ])
      expect(canonicalDestination(new URL(url), true)).toBeUndefined();
    expect(
      canonicalDestination(new URL("https://preview.vercel.app/"), false),
    ).toBeUndefined();
  });
  it("gives production customers a usable canonical link without local-server setup instructions", () => {
    const message = failureMessage(403, "FORBIDDEN_ORIGIN");
    expect(message).toContain(CANONICAL_ORIGIN);
    expect(message).not.toMatch(
      /localhost|127\.0\.0\.1|\.env|WEB_ORIGIN|الخادم المحلي/,
    );
  });
});
