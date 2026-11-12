import { mkdir } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

/**
 * Regression suite for the owner-reported scrollbar chaos and squeezed
 * layouts. Measures the REAL rendered page: the document must never scroll,
 * and only the intended regions may scroll — the message list, the history
 * list, the settings dialog body (and the composer textarea when very long).
 */
const ALLOWED_SCROLLERS = [
  ".chat-scroll",
  ".history-list",
  ".settings-body",
  "textarea",
];
const viewports: [number, number, string][] = [
  [320, 568, "phone-xs"],
  [360, 640, "phone-s"],
  [390, 844, "phone"],
  [430, 932, "phone-l"],
  [768, 1024, "tablet"],
  [1024, 768, "tablet-landscape"],
  [1280, 720, "laptop-s"],
  [1366, 768, "laptop"],
  [1440, 900, "desktop"],
  [1920, 1080, "desktop-l"],
  // Browser zoom on a 1280×720 window: 125%, 150%, 200%.
  [1024, 576, "zoom125"],
  [853, 480, "zoom150"],
  [640, 360, "zoom200"],
];

async function enter(page: Page) {
  // Chat opens directly; the first message lazily creates the guest session.
  await page.goto("/");
  const box = page.getByRole("textbox", { name: "رسالتك لسَدِيمًا" });
  await expect(box).toBeVisible();
  await box.fill("TEST ONLY hello");
  await page.getByRole("button", { name: "إرسال الرسالة" }).click();
  // Providers are disabled in QA: the session exists, the reply is honestly unavailable.
  await expect(page.locator(".global-error")).toBeVisible();
  await page.getByRole("button", { name: "إغلاق التنبيه" }).click();
  await box.fill("");
}

async function audit(page: Page, extra: string[] = []) {
  return page.evaluate(
    (allowed) => {
      const name = (e: Element) =>
        `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${
          typeof e.className === "string" && e.className.trim()
            ? `.${e.className.trim().split(/\s+/).join(".")}`
            : ""
        }`;
      const unexpected: string[] = [];
      for (const e of document.querySelectorAll("*")) {
        const style = getComputedStyle(e);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const scrollsY =
          ["auto", "scroll"].includes(style.overflowY) &&
          e.scrollHeight > e.clientHeight + 1;
        const scrollsX =
          ["auto", "scroll"].includes(style.overflowX) &&
          e.scrollWidth > e.clientWidth + 1;
        if (!scrollsY && !scrollsX) continue;
        if (scrollsX || !allowed.some((selector) => e.matches(selector)))
          unexpected.push(
            `${name(e)} y=${e.scrollHeight}/${e.clientHeight} x=${e.scrollWidth}/${e.clientWidth}`,
          );
      }
      const doc = document.documentElement;
      const composer = document
        .querySelector(".composer")
        ?.getBoundingClientRect();
      const clippedHistory = [
        ...document.querySelectorAll(".history-list .history-open"),
      ].filter(
        (b) =>
          b.scrollWidth > b.clientWidth + 1 ||
          b.scrollHeight > b.clientHeight + 1,
      ).length;
      return {
        docScrollsX: doc.scrollWidth > innerWidth,
        docScrollsY: doc.scrollHeight > innerHeight,
        unexpected,
        clippedHistory,
        composerVisible:
          !!composer && composer.top >= 0 && composer.bottom <= innerHeight + 1,
      };
    },
    [...ALLOWED_SCROLLERS, ...extra],
  );
}

/** TEST ONLY: long history and a long conversation, served by route mocks. */
async function mockLongConversation(page: Page) {
  const ids = Array.from(
    { length: 30 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  await page.route("**/api/v1/conversations", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: ids.map((id, i) => ({
            id,
            createdAt: new Date(Date.UTC(2026, 10, 6, 9, i)).toISOString(),
            messageCount: 40,
          })),
        })
      : route.fallback(),
  );
  await page.route(`**/api/v1/conversations/${ids[0]}`, (route) =>
    route.fulfill({
      json: {
        messages: Array.from({ length: 40 }, (_, i) => ({
          role: i % 2 ? "assistant" : "user",
          content: `TEST ONLY message ${i + 1}: ${"نص تجريبي للتأكد من التمرير الطبيعي. ".repeat(i % 3 ? 2 : 6)}`,
        })),
        travelState: null,
      },
    }),
  );
}

// Light functional checks first, before the request-heavy viewport sweep
// (the QA API applies one shared per-minute rate limit).
test("direct-to-chat: no session on page load, one guest session reused", async ({
  page,
}) => {
  const guestCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/auth/guest")) guestCalls.push(r.method());
  });
  await page.goto("/");
  await expect(page.locator(".cinematic-bg video")).toHaveCount(1);
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.reload();
  expect(guestCalls, "no anonymous user on page load").toEqual([]);
  expect(
    await page.evaluate(() => sessionStorage.getItem("sadeeman.session")),
  ).toBeNull();
  const box = page.getByRole("textbox", { name: "رسالتك لسَدِيمًا" });
  await box.fill("TEST ONLY first");
  await page.getByRole("button", { name: "إرسال الرسالة" }).click();
  await expect(page.locator(".global-error")).toBeVisible();
  expect(guestCalls).toEqual(["POST"]);
  await page.reload();
  await box.fill("TEST ONLY second");
  await page.getByRole("button", { name: "إرسال الرسالة" }).click();
  await expect(page.locator(".global-error")).toBeVisible();
  expect(guestCalls, "session reused across refresh").toEqual(["POST"]);
});

test("Listen explains a disabled voice service instead of doing nothing", async ({
  page,
}) => {
  await enter(page);
  const runId = "11111111-1111-4111-8111-111111111112",
    conversationId = "22222222-2222-4222-8222-222222222223";
  // TEST ONLY scripted reply; the QA API runs with voice disabled.
  await page.route("**/api/v1/agent/messages", (route) =>
    route.fulfill({ status: 202, json: { runId } }),
  );
  await page.route(`**/api/v1/agent/events/${runId}`, (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ eventId: "33333333-3333-4333-8333-333333333334", runId, conversationId, occurredAt: new Date().toISOString(), type: "response_completed", textDelta: "TEST ONLY scripted reply" })}\n\n`,
    }),
  );
  await page.route(`**/api/v1/agent/runs/${runId}`, (route) =>
    route.fulfill({
      json: { travelContext: null, sourceEvidence: [], travelArtifacts: [] },
    }),
  );
  await page
    .getByRole("textbox", { name: "رسالتك لسَدِيمًا" })
    .fill("TEST ONLY hi");
  await page.getByRole("button", { name: "إرسال الرسالة" }).click();
  await page.getByRole("button", { name: "استمع للرد" }).click();
  await expect(page.getByText(/ENABLE_VOICE=true/)).toBeVisible();
  // Never a fake playing state.
  await expect(page.getByRole("button", { name: "إيقاف الصوت" })).toHaveCount(
    0,
  );
});

for (const [width, height, label] of viewports) {
  test(`layout ${label} ${width}x${height}: no stray scrollbars, composer anchored`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    // First load: chat immediately, nothing scrolls, background video present.
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "رسالتك لسَدِيمًا" }),
    ).toBeVisible();
    await expect(page.locator(".gate, .gate-card")).toHaveCount(0);
    const first = await audit(page);
    expect(first.docScrollsX, "first load: horizontal scroll").toBe(false);
    expect(first.docScrollsY, "first load: vertical scroll").toBe(false);
    expect(first.unexpected, "first load: scroll containers").toEqual([]);
    expect(first.composerVisible, "first load: composer").toBe(true);
    await enter(page);
    // Empty state: nothing may scroll at all (history is short).
    const empty = await audit(page);
    expect(empty.docScrollsX, "document horizontal scroll").toBe(false);
    expect(empty.docScrollsY, "document vertical scroll").toBe(false);
    expect(empty.unexpected, "unexpected scroll containers").toEqual([]);
    expect(empty.composerVisible, "composer visible").toBe(true);
    await expect(page.locator(".welcome")).toBeVisible();

    // Long history + long conversation: one natural message scroll.
    await mockLongConversation(page);
    await page.reload();
    await expect(page.locator(".history-list .history-open")).toHaveCount(30);
    if (width < 1024) {
      await page.getByRole("button", { name: "القائمة والمحادثات" }).click();
      await expect(page.locator(".sidebar")).toBeVisible();
    }
    await page.locator(".history-list .history-open").first().click();
    await expect(page.locator(".message")).toHaveCount(40);
    await expect(page.locator(".welcome")).toHaveCount(0);
    const busy = await audit(page);
    expect(busy.docScrollsX).toBe(false);
    expect(busy.docScrollsY).toBe(false);
    expect(busy.unexpected).toEqual([]);
    expect(busy.clippedHistory, "history cards must not scroll").toBe(0);
    expect(busy.composerVisible).toBe(true);
    // Older messages stay reachable and nothing overlaps the message region.
    const geometry = await page.evaluate(() => {
      const region = document.querySelector(".chat-scroll");
      if (!region) return null;
      region.scrollTop = 0;
      const top = region.getBoundingClientRect().top;
      const toolbar = document
        .querySelector(".chat-toolbar")
        ?.getBoundingClientRect().bottom;
      const first = document
        .querySelector(".message")
        ?.getBoundingClientRect().top;
      return { top, toolbar: toolbar ?? 0, first: first ?? 0 };
    });
    expect(geometry).not.toBeNull();
    expect(
      geometry?.toolbar ?? 0,
      "toolbar above the messages",
    ).toBeLessThanOrEqual((geometry?.top ?? 0) + 1);
    expect(
      geometry?.first ?? 0,
      "first message reachable at top",
    ).toBeGreaterThanOrEqual((geometry?.top ?? 0) - 1);
    const scroll = page.locator(".chat-scroll");
    expect(
      await scroll.evaluate((e) => e.scrollHeight > e.clientHeight),
      "long conversation scrolls inside the message list",
    ).toBe(true);
    await mkdir("CLAUDE_HANDOFF/screenshots/layout", { recursive: true });
    await page.screenshot({
      path: `CLAUDE_HANDOFF/screenshots/layout/${label}-${width}x${height}-dark.png`,
    });
    if (["desktop", "tablet", "phone"].includes(label)) {
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "light";
      });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `CLAUDE_HANDOFF/screenshots/layout/${label}-${width}x${height}-light.png`,
      });
    }
  });
}

test("drawer, settings dialog and privacy controls are reachable and accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page);
  const menu = page.getByRole("button", { name: "القائمة والمحادثات" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".sidebar .new-chat")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(menu).toBeFocused();
  // No account/privacy pages in the primary navigation any more.
  await expect(page.getByText("حسابي", { exact: true })).toHaveCount(0);
  await menu.click();
  await page.getByRole("button", { name: /الإعدادات/ }).click();
  const dialog = page.getByRole("dialog", { name: "الإعدادات" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "الخصوصية والبيانات" }).click();
  await expect(
    dialog.getByRole("button", { name: "أوافق على ذاكرة تفضيلات السفر" }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "الحساب" }).click();
  await expect(
    dialog.getByRole("button", { name: "تسجيل الخروج" }),
  ).toBeVisible();
  // No technical identifiers on ordinary screens.
  expect(
    await page.evaluate(() =>
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
        document.body.textContent ?? "",
      ),
    ),
  ).toBe(false);
  const audited = await audit(page);
  expect(audited.docScrollsY).toBe(false);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
