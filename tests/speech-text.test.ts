import { describe, expect, it } from "vitest";
import { speechText } from "../apps/web/lib/speech-text.js";

describe("text sent to TTS", () => {
  it("drops Markdown symbols and URLs but keeps link text", () => {
    expect(
      speechText(
        "**سيوة**: واحة [المصدر](https://example.com/a) https://x.y/z",
      ),
    ).toBe("سيوة : واحة المصدر");
  });
  it("caps long replies at a sentence boundary", () => {
    const long = `${"جملة طويلة عن السفر. ".repeat(120)}`;
    const out = speechText(long);
    expect(out.length).toBeLessThanOrEqual(1200);
    expect(out.endsWith(".")).toBe(true);
  });
});
