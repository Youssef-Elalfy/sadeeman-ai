import { describe, expect, it } from "vitest";
import { startupReport } from "../apps/api/src/diagnostics.js";
import { testConfig } from "./helpers.js";

describe("startup readiness report", () => {
  it("explains disabled features and never prints secret values", () => {
    const secret = "TEST-ONLY-SECRET-VALUE-123";
    const report = startupReport(
      testConfig({
        ENABLE_REAL_PROVIDER: true,
        GEMINI_API_KEY: secret,
        GEMINI_MODEL: "test-model",
        FALLBACK_PROVIDERS: "groq",
        TAVILY_API_KEY: secret,
        ENABLE_TRAVEL_RESEARCH: true,
      }),
    );
    const text = [...report.lines, ...report.warnings].join("\n");
    expect(text).not.toContain(secret);
    expect(text).toContain("gemini (configured, not verified");
    expect(report.warnings.join(" ")).toContain("groq");
  });
  it("says why chat is off instead of a bare mode name", () => {
    const text = startupReport(testConfig()).lines.join("\n");
    expect(text).toContain("ENABLE_REAL_PROVIDER=false");
    expect(text).not.toContain("CRM");
  });
  it("warns when only the legacy voice flag is present", () => {
    const report = startupReport(testConfig(), {
      ENABLE_REALTIME_VOICE: "false",
    });
    expect(report.warnings.join(" ")).toContain("ENABLE_VOICE=true");
  });
});
