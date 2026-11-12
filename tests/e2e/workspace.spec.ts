import { mkdir } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

test("TEST ONLY mocked model stream renders grounded artifacts and safe text", async ({
  page,
}) => {
  await enter(page);
  const runId = "11111111-1111-4111-8111-111111111111",
    conversationId = "22222222-2222-4222-8222-222222222222";
  await page.route("**/api/v1/agent/messages", (route) =>
    route.fulfill({ status: 202, json: { runId } }),
  );
  await page.route(`**/api/v1/agent/events/${runId}`, (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ eventId: "33333333-3333-4333-8333-333333333333", runId, conversationId, occurredAt: new Date().toISOString(), type: "response_completed", textDelta: "TEST ONLY scripted response <script>alert(1)</script>" })}\n\n`,
    }),
  );
  await page.route(`**/api/v1/agent/runs/${runId}`, (route) =>
    route.fulfill({
      json: {
        travelContext: null,
        sourceEvidence: [],
        travelArtifacts: [
          {
            tool: "build_itinerary",
            data: {
              label: "ESTIMATED_ITINERARY",
              destination: "TEST ONLY Turkey",
              days: [{ day: 1, researchSuggestions: [] }],
            },
          },
        ],
      },
    }),
  );
  await page
    .getByRole("textbox", { name: "رسالتك لسَدِيمًا" })
    .fill("TEST ONLY planner");
  await page.getByRole("button", { name: "إرسال الرسالة" }).click();
  await expect(
    page.getByText("TEST ONLY scripted response <script>alert(1)</script>", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "TEST ONLY Turkey · 1 أيام" }),
  ).toBeVisible();
  expect(await page.locator(".prose script").count()).toBe(0);
});
test("TEST ONLY microphone-denied fault shows text fallback, never fake recording", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          throw new DOMException("TEST ONLY denied", "NotAllowedError");
        },
      },
    });
  });
  await enter(page);
  await page.route("**/api/v1/voice/capabilities", (route) =>
    route.fulfill({
      json: {
        transcription: true,
        speech: false,
        fullDuplex: false,
        audioRetention: "not_stored",
      },
    }),
  );
  await page.getByRole("button", { name: "تسجيل رسالة صوتية" }).click();
  await expect(
    page.getByText(
      "الميكروفون مقفول؛ اسمح له من إعدادات المتصفح أو اكتب رسالتك.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("meter")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "رسالتك لسَدِيمًا" }),
  ).toBeVisible();
});

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

test("TEST ONLY real MediaRecorder segments synthetic tone; mocked transcripts require review and release tracks", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          const context = new AudioContext(),
            oscillator = context.createOscillator();
          const destination = context.createMediaStreamDestination();
          oscillator.connect(destination);
          oscillator.start();
          for (const track of destination.stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => {
              stop();
              oscillator.stop();
              void context.close();
              document.documentElement.dataset.qaTrackStopped = "true";
            };
          }
          return destination.stream;
        },
      },
    });
  });
  await enter(page);
  await page.route("**/api/v1/voice/capabilities", (route) =>
    route.fulfill({
      json: {
        transcription: true,
        incrementalTranscription: true,
        speech: false,
        fullDuplex: false,
        audioRetention: "not_stored",
      },
    }),
  );
  let calls = 0;
  await page.route("**/api/v1/voice/transcribe", async (route) => {
    calls++;
    const note = route.request().postDataJSON() as {
      audioBase64: string;
      language: string;
      consent: boolean;
    };
    // A new EBML header for every segment proves we did not upload invalid
    // continuation fragments from one MediaRecorder timeslice stream.
    expect(Buffer.from(note.audioBase64, "base64").subarray(0, 4)).toEqual(
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    );
    expect(note.language).toBe("ar");
    expect(note.consent).toBe(true);
    await route.fulfill({
      json: {
        text: calls === 1 ? "TEST ONLY first" : "TEST ONLY second",
        empty: false,
      },
    });
  });
  await page.getByRole("button", { name: "تسجيل رسالة صوتية" }).click();
  // One click records immediately, inline BELOW the composer.
  const strip = page.locator(".voice-strip");
  await expect(strip.getByRole("meter")).toBeVisible();
  await expect(strip.getByRole("status")).toContainText("بيسجّل");
  expect(
    await page.evaluate(() => {
      const c = document.querySelector(".composer")?.getBoundingClientRect();
      const v = document.querySelector(".voice-strip")?.getBoundingClientRect();
      return !!c && !!v && v.top >= c.bottom - 1;
    }),
  ).toBe(true);
  await page.waitForTimeout(1200);
  await strip.getByRole("button", { name: "إيقاف", exact: true }).click();
  await expect(page.getByLabel("راجع النص وعدّله")).toHaveValue(
    "TEST ONLY first",
  );
  expect(calls).toBe(1);
  await expect(page.locator("html")).toHaveAttribute(
    "data-qa-track-stopped",
    "true",
  );
  await page.getByLabel("راجع النص وعدّله").fill("TEST ONLY reviewed request");
  await page.getByRole("button", { name: "استخدام النص في الرسالة" }).click();
  await expect(
    page.getByRole("textbox", { name: "رسالتك لسَدِيمًا" }),
  ).toHaveValue("TEST ONLY reviewed request");
  await expect(page.locator(".voice-strip")).toHaveCount(0);
  // It is staged for the user's explicit send; no automatic agent request.
});
test("conversation-first: minimal navigation, history, no CRM or account pages", async ({
  page,
}) => {
  await enter(page);
  // The sidebar holds only: new chat, previous conversations, settings.
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByText(/العملاء والطلبات|CRM|حسابي/)).toHaveCount(0);
  await page.getByRole("button", { name: "محادثة جديدة" }).click();
  await expect(
    page.locator(".history-list .history-open", { hasText: "TEST ONLY hello" }),
  ).toBeVisible();
  // A second click reuses the still-empty conversation instead of piling up.
  await page.getByRole("button", { name: "محادثة جديدة" }).click();
  await expect(page.locator(".history-list .history-open")).toHaveCount(1);
  // Old deep links open the matching settings tab instead of a page.
  await page.goto("/#/profile");
  const dialog = page.getByRole("dialog", { name: "الإعدادات" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "الحساب" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Escape");
  // The retired CRM route lands on the chat.
  await page.goto("/#/crm");
  await expect(
    page.getByRole("textbox", { name: "رسالتك لسَدِيمًا" }),
  ).toBeVisible();
  await expect(page.getByText(/العملاء والطلبات/)).toHaveCount(0);
});
test("truthful unavailable model, voice fallback, settings and reduced motion", async ({
  page,
}) => {
  await enter(page);
  await page
    .getByRole("textbox", { name: "رسالتك لسَدِيمًا" })
    .fill("TEST ONLY سفر");
  await page.getByRole("button", { name: "إرسال الرسالة" }).click();
  await expect(page.locator(".global-error")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "رسالتك لسَدِيمًا" }),
  ).toHaveValue("TEST ONLY سفر");
  await page.getByRole("button", { name: "تسجيل رسالة صوتية" }).click();
  // Capture starts at once; with STT disabled (or no mic in headless QA) it
  // stops with an explanation and never shows a fake recording.
  await expect(page.locator(".voice-error")).toBeVisible();
  await expect(page.locator(".voice-strip meter")).toHaveCount(0);
  await page.getByRole("button", { name: "إغلاق الصوت" }).click();
  await page.getByRole("button", { name: /الإعدادات/ }).click();
  const dialog = page.getByRole("dialog", { name: "الإعدادات" });
  await dialog.getByLabel("المظهر", { exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await dialog.getByRole("tab", { name: "الحساب" }).click();
  // Theme backgrounds animate for 200 ms: check settled colors, AA 4.5:1.
  await expect
    .poll(
      async () => {
        const contrast = await dialog
          .getByRole("button")
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const style = getComputedStyle(button);
              const luminance = (color: string) => {
                const rgb = (color.match(/[\d.]+/g) ?? [])
                  .slice(0, 3)
                  .map(Number)
                  .map((v) => {
                    const c = v / 255;
                    return c <= 0.04045
                      ? c / 12.92
                      : ((c + 0.055) / 1.055) ** 2.4;
                  });
                return (
                  (rgb[0] ?? 0) * 0.2126 +
                  (rgb[1] ?? 0) * 0.7152 +
                  (rgb[2] ?? 0) * 0.0722
                );
              };
              const alpha = Number(
                style.backgroundColor.match(/[\d.]+/g)?.[3] ?? "1",
              );
              // Transparent buttons sit on the dialog surface.
              const bg =
                alpha < 0.5
                  ? getComputedStyle(
                      button.closest(".settings-dialog") ?? document.body,
                    ).backgroundColor
                  : style.backgroundColor;
              const a = luminance(style.color),
                b = luminance(bg);
              return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            }),
          );
        return contrast.length ? Math.min(...contrast) : 0;
      },
      { timeout: 2000 },
    )
    .toBeGreaterThanOrEqual(4.5);
  await mkdir("CLAUDE_HANDOFF/screenshots", { recursive: true });
  await page.screenshot({
    path: "CLAUDE_HANDOFF/screenshots/light-settings.png",
  });
  await dialog.getByRole("tab", { name: "عام" }).click();
  await dialog
    .getByRole("checkbox", { name: "تقليل الحركة وإيقاف فيديو الخلفية" })
    .check();
  // Reduced motion: the background shows the static poster, no video.
  await expect(page.locator(".cinematic-bg")).toHaveAttribute(
    "data-motion",
    "static",
  );
  await expect(page.locator(".cinematic-bg video")).toHaveCount(0);
  await dialog.getByRole("tab", { name: "الحساب" }).click();
  await dialog.getByRole("button", { name: "تسجيل الخروج" }).click();
  // Signed out: still straight into chat, with no history from the old session.
  await expect(
    page.getByRole("textbox", { name: "رسالتك لسَدِيمًا" }),
  ).toBeVisible();
  await expect(page.locator(".history-list .history-open")).toHaveCount(0);
});
test("memory approval/write/erase through the actual consent APIs", async ({
  page,
}) => {
  await enter(page);
  await page.getByRole("button", { name: "محادثة جديدة" }).click();
  await page.getByRole("button", { name: /الإعدادات/ }).click();
  const dialog = page.getByRole("dialog", { name: "الإعدادات" });
  await dialog.getByRole("tab", { name: "الخصوصية والبيانات" }).click();
  await dialog
    .getByRole("button", { name: "أوافق على ذاكرة تفضيلات السفر" })
    .click();
  await dialog
    .getByLabel("اكتب اللي تحب نفتكره")
    .fill("TEST ONLY prefers quiet places");
  await dialog.getByRole("button", { name: "حفظ لمدة 90 يوم" }).click();
  await expect(
    dialog.getByText("TEST ONLY prefers quiet places", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await dialog.getByRole("button", { name: "حذف", exact: true }).click();
  await expect(dialog.getByText("مفيش تفضيلات محفوظة.")).toBeVisible();
});
for (const [name, width, height] of [
  ["desktop", 1440, 900],
  ["tablet", 820, 1180],
  ["mobile", 390, 844],
] as const) {
  test(`responsive ${name} screenshot and accessible landmarks`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await enter(page);
    await expect(page.getByRole("main")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (width < 1024) {
      // Drawer mode: closed drawer is out of the tab order.
      await page.getByRole("button", { name: "القائمة والمحادثات" }).click();
      await expect(page.locator(".sidebar")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".sidebar")).not.toBeVisible();
      await page.keyboard.press("Tab");
      expect(
        await page
          .locator(".sidebar")
          .evaluate((el) => el.contains(document.activeElement)),
      ).toBe(false);
    }
    await mkdir("CLAUDE_HANDOFF/screenshots", { recursive: true });
    await page.screenshot({ path: `CLAUDE_HANDOFF/screenshots/${name}.png` });
  });
}

test("conversation titles come from the first message and persist", async ({
  page,
}) => {
  await page.goto("/");
  const box = page.getByRole("textbox", { name: "رسالتك لسَدِيمًا" });
  await box.fill("عايز أسافر تركيا 5 أيام");
  await page.getByRole("button", { name: "إرسال الرسالة" }).click();
  await expect(page.locator(".global-error")).toBeVisible();
  await expect(
    page.locator(".history-list .history-open").first(),
  ).toContainText("رحلة إلى تركيا");
  await expect(page.locator(".topbar-title")).toHaveText("رحلة إلى تركيا");
  // A later message never renames it.
  await page.getByRole("button", { name: "إغلاق التنبيه" }).click();
  await box.fill("طب خلي الميزانية 20 ألف");
  await page.getByRole("button", { name: "إرسال الرسالة" }).click();
  await page.reload();
  await expect(
    page.locator(".history-list .history-open").first(),
  ).toContainText("رحلة إلى تركيا");
  // New chat starts untitled and isolated.
  await page.getByRole("button", { name: "محادثة جديدة" }).click();
  await expect(page.locator(".topbar-title")).toHaveText("محادثة جديدة");
});
test("paperclip attaches a text file, removes it, and rejects unsupported files", async ({
  page,
}) => {
  await enter(page);
  const input = page.locator(".composer .attach input[type=file]");
  await input.setInputFiles({
    name: "TEST-ONLY-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("TEST ONLY itinerary notes"),
  });
  await expect(page.locator(".attachment-chip")).toContainText(
    "TEST-ONLY-notes.txt",
  );
  await page.getByRole("button", { name: /إزالة المرفق/ }).click();
  await expect(page.locator(".attachment-chip")).toHaveCount(0);
  // Real image bytes go to the API for the vision-capable model.
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
  ]);
  await input.setInputFiles({
    name: "TEST-ONLY.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.locator(".attachment-chip img")).toHaveCount(1);
  const imageSent = page.waitForRequest((r) =>
    r.url().includes("/api/v1/agent/messages"),
  );
  await page.getByRole("button", { name: "إرسال الرسالة" }).click();
  const imageBody = (await imageSent).postDataJSON() as {
    attachments?: { mime: string; dataBase64: string }[];
  };
  expect(imageBody.attachments?.[0]?.mime).toBe("image/png");
  expect(imageBody.attachments?.[0]?.dataBase64).toBe(png.toString("base64"));
  await expect(page.locator(".global-error")).toBeVisible();
  await input.setInputFiles({
    name: "TEST-ONLY.exe",
    mimeType: "application/x-msdownload",
    buffer: Buffer.from("MZ"),
  });
  await expect(page.getByText(/نوع الملف ده مش مدعوم/)).toBeVisible();
  // A text attachment's content is really sent with the message.
  await input.setInputFiles({
    name: "TEST-ONLY-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("TEST ONLY itinerary notes"),
  });
  const sent = page.waitForRequest((r) =>
    r.url().includes("/api/v1/agent/messages"),
  );
  await page.getByRole("button", { name: "إغلاق التنبيه" }).click();
  await page.getByRole("button", { name: "إرسال الرسالة" }).click();
  const body = (await sent).postDataJSON() as { content: string };
  expect(body.content).toContain("TEST ONLY itinerary notes");
});
