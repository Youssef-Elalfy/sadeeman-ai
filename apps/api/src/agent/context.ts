import type { ModelInput, ModelMessage } from "../providers/types.js";

// Estimates are admission controls, never reported as billed token usage.
// Include system/schema/protocol overhead and UTF-8 text, not base64 file data.
export function inputChars(input: ModelInput, portable = false): number {
  return serialized(input, portable).length;
}
function serialized(input: ModelInput, portable = false): string {
  const messages = input.messages.map((message) => {
    if (message.role === "user" && message.attachments)
      return {
        ...message,
        attachments: message.attachments.map((file) => ({
          mime: file.mime,
          data: "[inline file]",
        })),
      };
    if (portable && message.role === "assistant") {
      const { native: _native, ...logical } = message;
      return logical;
    }
    return message;
  });
  // Project only known message metadata. Fields named native/attachments
  // inside tool arguments/results remain real context and must be counted.
  return JSON.stringify({ system: input.system, messages, tools: input.tools });
}
export function estimatedInputTokens(
  input: ModelInput,
  portable = false,
): number {
  return (
    Math.ceil(Buffer.byteLength(serialized(input, portable), "utf8") / 3) + 32
  );
}
function excerpt(text: string, maximum: number): string {
  if (text.length <= maximum) return text;
  const marker = "\n[verbatim excerpt; middle omitted]\n";
  const half = Math.max(0, Math.floor((maximum - marker.length) / 2));
  return text.slice(0, half) + marker + text.slice(-half);
}
function projectData(value: unknown, limit: number): unknown {
  if (Array.isArray(value)) return value.map((v) => projectData(v, limit));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      typeof v === "string" &&
      ["excerpt", "description", "summary"].includes(key)
        ? excerpt(v, limit)
        : projectData(v, limit),
    ]),
  );
}

/** Compact a COPY only. Keep current input, confirmed context, exact money/URLs,
 * tool-call/result pairs and provider signatures. Never change stored history.
 */
export function fitModelInput(
  original: ModelInput,
  maxChars: number,
  maxInputTokens = Number.POSITIVE_INFINITY,
  portable = false,
): ModelInput | undefined {
  const input = structuredClone(original);
  const fits = () =>
    inputChars(input, portable) <= maxChars &&
    estimatedInputTokens(input, portable) <= maxInputTokens;
  if (fits()) return input;
  for (const limit of [240, 80]) {
    input.messages = input.messages.map(
      (m): ModelMessage =>
        m.role === "tool"
          ? {
              ...m,
              result: { ...m.result, data: projectData(m.result.data, limit) },
            }
          : m,
    );
    if (fits()) return input;
  }
  const current = input.messages.findLastIndex((m) => m.role === "user");
  // The most recent exchange and user text used for evidence remain exact.
  for (let i = 0; i < current - 2; i++) {
    const m = input.messages[i];
    if (m?.role === "assistant" && !m.toolCalls.length)
      input.messages[i] = { ...m, content: excerpt(m.content, 240) };
  }
  if (fits()) return input;
  for (let i = 0; i < current - 2; i++) {
    const m = input.messages[i];
    if (m?.role === "user" && !m.attachments?.length)
      input.messages[i] = { ...m, content: excerpt(m.content, 600) };
  }
  if (fits()) return input;
  // Remove only complete old plain exchanges. Keep the first user anchor,
  // the latest exchange and every current-run tool protocol message.
  let omissionNoted = false;
  while (!fits()) {
    const boundary = input.messages.findLastIndex((m) => m.role === "user");
    const index = input.messages.findIndex(
      (m, i) =>
        i > 0 &&
        i < boundary - 2 &&
        m.role === "user" &&
        input.messages[i + 1]?.role === "assistant" &&
        !(input.messages[i + 1] as { toolCalls?: unknown[] }).toolCalls?.length,
    );
    if (index < 0) return undefined;
    if (!omissionNoted) {
      input.system +=
        "\nSome older conversation text was omitted to fit context. Confirmed structured facts remain authoritative; do not invent omitted details. Ask if a missing detail matters.";
      omissionNoted = true;
    }
    input.messages.splice(index, 2);
  }
  return input;
}

export function forProvider(input: ModelInput, provider: string): ModelInput {
  return {
    ...input,
    messages: input.messages.map((m) => {
      if (m.role !== "assistant" || !m.native || m.native.provider === provider)
        return m;
      const { native: _native, ...portable } = m;
      return portable;
    }),
  };
}
