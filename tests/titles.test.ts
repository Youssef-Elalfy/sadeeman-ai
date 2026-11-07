import { describe, expect, it } from "vitest";
import { deriveTitle } from "../apps/web/lib/titles.js";

describe("local conversation titles (no model tokens)", () => {
  it.each([
    [
      "عايز أسافر تركيا 5 أيام، إحنا شخصين وميزانيتنا 30 ألف جنيه.",
      "رحلة إلى تركيا",
    ],
    ["اشرحلي الذكاء الاصطناعي", "شرح الذكاء الاصطناعي"],
    ["اشرحلي يعني إيه الذكاء الاصطناعي ببساطة.", "شرح الذكاء الاصطناعي"],
    ["ساعدني أتعلم إنجليزي", "تعلم اللغة الإنجليزية"],
    ["ساعدني أتعلم إنجليزي من الصفر.", "تعلم اللغة الإنجليزية"],
    ["إيه الفرق بين React وNext.js؟", "الفرق بين React وNext.js"],
    ["Plan a trip to Japan in April", "Trip to Japan"],
  ])("%s → %s", (input, title) => {
    expect(deriveTitle(input)).toBe(title);
  });
  it("shortens other topics without inventing anything", () => {
    const title = deriveTitle(
      "ممكن تقولي أحسن طريقة أنظم بيها وقتي في الشغل والمذاكرة مع بعض كل يوم",
    );
    expect(title.length).toBeLessThanOrEqual(41);
    expect(title.startsWith("تقولي أحسن طريقة")).toBe(true);
  });
  it("never returns an empty title", () => {
    expect(deriveTitle("   ؟؟ ")).toBe("محادثة جديدة");
  });
});
