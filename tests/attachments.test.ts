import { describe, expect, it } from "vitest";
import { ModelRouter } from "../apps/api/src/providers/router.js";
import type { ModelAdapter } from "../apps/api/src/providers/types.js";
import { buildServer } from "../apps/api/src/server.js";
import { answer, ScriptedAdapter, testConfig } from "./helpers.js";

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]).toString("base64");
const input = (withFile: boolean) => ({
  system: "TEST ONLY",
  tools: [],
  maxOutputTokens: 64,
  messages: [
    {
      role: "user" as const,
      content: "اشرحلي الصورة دي",
      ...(withFile ? { attachments: [{ mime: "image/png", data: png }] } : {}),
    },
  ],
});

describe("image/PDF attachments (offline, TEST ONLY adapters)", () => {
  it("routes a file turn only to a provider that can read files, with the real bytes", async () => {
    const textOnly = new ScriptedAdapter([async () => answer("never")], "groq");
    const vision = new ScriptedAdapter([async () => answer("ok")], "gemini");
    const visionAdapter: ModelAdapter = {
      id: vision.id,
      capabilities: { ...vision.capabilities, attachments: true },
      generate: (i, s) => vision.generate(i, s),
    };
    const result = await new ModelRouter(
      [textOnly, visionAdapter],
      testConfig(),
    ).generate(input(true), new AbortController().signal);
    expect(result.providerId).toBe("gemini");
    expect(textOnly.inputs).toHaveLength(0);
    const sent = vision.inputs[0]?.messages[0];
    expect(sent && sent.role === "user" ? sent.attachments?.[0] : null).toEqual(
      {
        mime: "image/png",
        data: png,
      },
    );
  });
  it("text-only turns still use the normal provider order", async () => {
    const textOnly = new ScriptedAdapter([async () => answer("ok")], "groq");
    const result = await new ModelRouter([textOnly], testConfig()).generate(
      input(false),
      new AbortController().signal,
    );
    expect(result.providerId).toBe("groq");
  });
  it("rejects a file whose real bytes do not match its declared type", async () => {
    const app = await buildServer({ config: testConfig() });
    const session = (
      await app.inject({
        method: "POST",
        url: "/api/v1/dev/sessions",
        payload: { acceptSyntheticDataPolicy: true },
      })
    ).json<{ token: string }>();
    const headers = { authorization: `Bearer ${session.token}` };
    const conversation = (
      await app.inject({
        method: "POST",
        url: "/api/v1/conversations",
        headers,
        payload: {},
      })
    ).json<{ id: string }>();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/agent/messages",
      headers,
      payload: {
        conversationId: conversation.id,
        content: "TEST ONLY",
        attachments: [
          {
            name: "fake.pdf",
            mime: "application/pdf",
            dataBase64: Buffer.from("not a pdf at all").toString("base64"),
          },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
