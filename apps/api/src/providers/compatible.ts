import { setTimeout as delay } from "node:timers/promises";
import { ModelOutput } from "@sadeeman/contracts";
import { z } from "zod";
import { providerError, type RateHint, SafeError } from "../errors.js";
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
  /**
   * One bounded retry, only when the provider itself asks for a short wait:
   * a per-minute 429 whose Retry-After is at most 10 s (MASAR-style). Daily
   * quotas, longer waits and every other error are returned immediately.
   */
  async generate(
    input: ModelInput,
    signal: AbortSignal,
    onDelta?: (text: string) => void,
  ): Promise<Generation> {
    try {
      return await this.once(input, signal, onDelta);
    } catch (error) {
      const wait = error instanceof SafeError ? error.retryAfterMs : undefined;
      if (
        !(error instanceof SafeError) ||
        error.code !== "PROVIDER_QUOTA" ||
        error.providerFailure?.quotaScope !== "per_minute" ||
        wait === undefined ||
        wait > 10_000
      )
        throw error;
      await delay(wait, undefined, { signal });
      return this.once(input, signal, onDelta);
    }
  }
  private async once(
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
    let hint: RateHint = {};
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
        // Headers only (no body): Retry-After seconds and whether the request
        // allowance (daily on Groq) is spent; otherwise it is a per-minute limit.
        const retry = Number(response.headers.get("retry-after"));
        const retryAfterMs =
          Number.isFinite(retry) && retry > 0
            ? Math.round(retry * 1000)
            : undefined;
        if (response.status === 429)
          hint = {
            quotaScope:
              response.headers.get("x-ratelimit-remaining-requests") === "0"
                ? "daily"
                : retryAfterMs ||
                    response.headers.has("x-ratelimit-remaining-tokens")
                  ? "per_minute"
                  : "unknown",
            ...(retryAfterMs ? { retryAfterMs } : {}),
          };
        else if (response.status === 413)
          hint = {
            category: "UPSTREAM_REQUEST_TOO_LARGE",
            quotaScope: "per_minute",
          };
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
        hint,
      );
    }
  }
}
