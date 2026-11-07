import { ModelOutput } from "@sadeeman/contracts";
import { z } from "zod";
import { SafeError } from "../errors.js";

const Chunk = z.object({
  error: z.unknown().optional(),
  choices: z
    .array(
      z.object({
        index: z.number().int().optional(),
        finish_reason: z.string().nullable().optional(),
        delta: z
          .object({
            content: z.string().nullable().optional(),
            tool_calls: z
              .array(
                z.object({
                  index: z.number().int().min(0).max(3),
                  id: z.string().max(160).optional(),
                  function: z
                    .object({
                      name: z.string().max(80).optional(),
                      arguments: z.string().max(16000).optional(),
                    })
                    .optional(),
                }),
              )
              .max(4)
              .optional(),
          })
          .optional(),
      }),
    )
    .max(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
});
export async function readCompletionStream(
  response: Response,
  signal: AbortSignal,
  onDelta: (text: string) => void,
) {
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    throw new SafeError("INVALID_MODEL_RESPONSE");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let text = "",
    pending = "",
    bytes = 0,
    doneMarker = false,
    finished = false;
  let inputTokens = 0,
    outputTokens = 0;
  const frame = (value: string) => {
    const data = value
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (data === "[DONE]") {
      doneMarker = true;
      return;
    }
    const chunk = Chunk.parse(JSON.parse(data));
    if (chunk.error) throw new SafeError("PROVIDER_UNAVAILABLE");
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens;
      outputTokens = chunk.usage.completion_tokens;
    }
    for (const choice of chunk.choices) {
      if (choice.index !== undefined && choice.index !== 0)
        throw new SafeError("INVALID_MODEL_RESPONSE");
      if (
        choice.finish_reason === "length" ||
        choice.finish_reason === "content_filter"
      )
        throw new SafeError("INVALID_MODEL_RESPONSE");
      if (choice.finish_reason) finished = true;
      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        if (text.length > 24000) throw new SafeError("INVALID_MODEL_RESPONSE");
        onDelta(delta.content);
      }
      for (const call of delta?.tool_calls ?? []) {
        const accumulated = calls.get(call.index) ?? {
          id: "",
          name: "",
          args: "",
        };
        if (call.id) accumulated.id += call.id;
        if (call.function?.name) accumulated.name += call.function.name;
        accumulated.args += call.function?.arguments ?? "";
        if (accumulated.args.length > 16000)
          throw new SafeError("INVALID_MODEL_RESPONSE");
        calls.set(call.index, accumulated);
      }
    }
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 262144) throw new SafeError("INVALID_MODEL_RESPONSE");
      pending += decoder.decode(value, { stream: true });
      pending = pending.replaceAll("\r\n", "\n");
      let end = pending.indexOf("\n\n");
      while (end >= 0) {
        frame(pending.slice(0, end));
        pending = pending.slice(end + 2);
        end = pending.indexOf("\n\n");
      }
    }
    pending += decoder.decode();
    if (pending.trim()) frame(pending);
    if (!doneMarker || !finished) throw new SafeError("INVALID_MODEL_RESPONSE");
    return ModelOutput.parse({
      text,
      toolCalls: [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => ({
          id: call.id,
          name: call.name,
          arguments: JSON.parse(call.args),
        })),
      usage: { inputTokens, outputTokens },
    });
  } finally {
    await reader.cancel();
  }
}
