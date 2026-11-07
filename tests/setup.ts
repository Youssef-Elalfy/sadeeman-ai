import { afterEach, beforeEach, expect, vi } from "vitest";

const blockedFetch = vi.fn<typeof fetch>(async () => {
  throw new Error("Network is disabled in deterministic tests");
});
beforeEach(() => {
  blockedFetch.mockClear();
  vi.stubGlobal("fetch", blockedFetch);
});
afterEach(() => {
  expect(
    blockedFetch,
    "A deterministic test attempted a real fetch",
  ).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
