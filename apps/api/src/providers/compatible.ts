import { ModelOutput } from "@sadeeman/contracts";
import { z } from "zod";
import { providerError, SafeError } from "../errors.js";
import { readCompletionStream } from "./sse.js";
import type { Generation, ModelAdapter, ModelInput } from "./types.js";

const ResponseBody = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.literal("function"),
                function: z.object({
                  name: z.string(),
                  arguments: z.string().max(16000),
                }),
              }),
            )
            .max(4)
            .optional(),
        }),
      }),
    )
    .min(1)
    .max(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});
const endpoints = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
} as const;

export class CompatibleAdapter implements ModelAdapter {
  readonly capabilities = {
    tools: true,
    streaming: true,
    contextChars: 32000,
  };
  constructor(
    readonly id: keyof typeof endpoints,
    private readonly key: string,
    private readonly model: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async generate(
    input: ModelInput,
    signal: AbortSignal,
    onDelta?: (text: string) => void,
  ): Promise<Generation> {
    const messages = input.messages.map((message) => {
      if (message.role === "user")
        return { role: "user", content: message.content };
      if (message.role === "tool")
        return {
          role: "tool",
          tool_call_id: message.callId,
          content: JSON.stringify(message.result),
        };
      return {
        role: "assistant",
        content: message.content || null,
        ...(message.toolCalls.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.arguments),
                },
              })),
            }
          : {}),
      };
    });
    try {
      const response = await this.fetcher(endpoints[this.id], {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "system", content: input.system }, ...messages],
          ...(input.tools.length
            ? {
                tools: input.tools.map((tool) => ({
                  type: "function",
                  function: tool,
                })),
                tool_choice: input.toolChoice ?? "auto",
              }
            : { tool_choice: "none" }),
          stream: Boolean(onDelta),
          ...(onDelta ? { stream_options: { include_usage: true } } : {}),
          max_completion_tokens: input.maxOutputTokens,
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw { status: response.status };
      }
      if (onDelta) return await readCompletionStream(response, signal, onDelta);
      // Bound decompressed response size even when Content-Length is absent.
      if (!response.body) throw new SafeError("INVALID_MODEL_RESPONSE");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 262144) throw new SafeError("INVALID_MODEL_RESPONSE");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const data = ResponseBody.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      const message = data.choices[0]?.message;
      if (
        ["length", "content_filter"].includes(
          data.choices[0]?.finish_reason ?? "",
        )
      )
        throw new SafeError("INVALID_MODEL_RESPONSE");
      return ModelOutput.parse({
        text: message?.content ?? "",
        toolCalls: (message?.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: JSON.parse(call.function.arguments),
        })),
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
      });
    } catch (error) {
      throw providerError(
        error instanceof z.ZodError || error instanceof SyntaxError
          ? new SafeError("INVALID_MODEL_RESPONSE")
          : error,
        signal,
        {
          provider: this.id,
          model: this.model,
          operation: onDelta ? "generate_stream" : "generate",
        },
      );
    }
  }
}
