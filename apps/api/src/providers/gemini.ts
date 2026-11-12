import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  type Content,
  FunctionCallingConfigMode,
  type GenerateContentParameters,
  GenerateContentResponse,
  GoogleGenAI,
  type Part,
  ThinkingLevel,
} from "@google/genai";
import { ModelOutput } from "@sadeeman/contracts";
import {
  cooldownMs,
  providerError,
  type RateHint,
  rateHintFromText,
  SafeError,
} from "../errors.js";

// Documented Gemini 3 value for tool calls whose original signature is not
// available (history from another model); same approach as MASAR.
const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";
const isGemini3 = (model: string) => /^gemini-([3-9]|\d{2,})/.test(model);

import type { Generation, ModelAdapter, ModelInput } from "./types.js";

export class GeminiAdapter implements ModelAdapter {
  readonly id = "gemini";
  readonly capabilities = {
    tools: true,
    attachments: true,
    streaming: true,
    contextChars: 64000,
  };
  private readonly chain: string[];
  /** Model → time until which it is skipped after a quota/overload failure. */
  private readonly resting = new Map<string, number>();
  private lastFailure: SafeError | undefined;
  get model(): string {
    return this.chain[0] ?? "";
  }
  private readonly models: Pick<GoogleGenAI["models"], "generateContent"> &
    Partial<Pick<GoogleGenAI["models"], "generateContentStream">>;
  constructor(
    key: string,
    model: string,
    private readonly timeoutMs: number,
    models?: Pick<GoogleGenAI["models"], "generateContent"> &
      Partial<Pick<GoogleGenAI["models"], "generateContentStream">>,
  ) {
    // MASAR-style chain: "primary,fallback" (comma-separated, in order).
    this.chain = model
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    this.models =
      models ??
      new GoogleGenAI({
        apiKey: key,
        httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } },
      }).models;
  }
  async generate(
    input: ModelInput,
    signal: AbortSignal,
    onDelta?: (text: string) => void,
  ): Promise<Generation> {
    // Overloaded (503) or rate-limited (429) model → next model in the chain,
    // once each, no backoff. A model that failed rests (per-day quota until
    // reset, per-minute ≥ 30 s, overload 60 s) so later turns skip it instead
    // of spending a call on a known failure. Other errors end the chain.
    let failure: unknown;
    const overloaded: string[] = [];
    for (const model of this.chain) {
      if ((this.resting.get(model) ?? 0) > Date.now()) continue;
      signal.throwIfAborted();
      try {
        return await this.generateWith(model, input, signal, onDelta);
      } catch (error) {
        failure = error;
        if (!(error instanceof SafeError)) break;
        this.lastFailure = error;
        const rest = cooldownMs(error);
        if (rest) this.resting.set(model, Date.now() + rest);
        if (error.code === "PROVIDER_UNAVAILABLE") overloaded.push(model);
        if (!["PROVIDER_UNAVAILABLE", "PROVIDER_QUOTA"].includes(error.code))
          break;
      }
    }
    // MASAR-style bounded backoff: when the chain ended on a 503 overload,
    // pause once (1.5 s) and give the overloaded models one more try. Quota
    // and auth failures are never retried.
    if (
      failure instanceof SafeError &&
      failure.code === "PROVIDER_UNAVAILABLE" &&
      overloaded.length
    ) {
      await delay(1500, undefined, { signal }).catch(() => undefined);
      for (const model of overloaded) {
        signal.throwIfAborted();
        try {
          const out = await this.generateWith(model, input, signal, onDelta);
          this.resting.delete(model);
          return out;
        } catch (error) {
          failure = error;
          if (error instanceof SafeError) this.lastFailure = error;
          if (
            !(error instanceof SafeError) ||
            error.code !== "PROVIDER_UNAVAILABLE"
          )
            break;
        }
      }
    }
    // Every model is resting after a recent failure: report that failure
    // (keeps its quota window) without another upstream call.
    throw failure ?? this.lastFailure ?? new SafeError("PROVIDER_UNAVAILABLE");
  }
  private async generateWith(
    model: string,
    input: ModelInput,
    signal: AbortSignal,
    onDelta?: (text: string) => void,
  ): Promise<Generation> {
    const contents: Content[] = input.messages.map((message) => {
      if (message.role === "user")
        return {
          role: "user",
          parts: [
            { text: message.content },
            ...(message.attachments ?? []).map((file) => ({
              inlineData: { mimeType: file.mime, data: file.data },
            })),
          ],
        };
      if (message.role === "tool")
        return {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: message.callId,
                name: message.name,
                response: { result: message.result },
              },
            },
          ],
        };
      // Replay opaque SDK parts (with signatures) only to the SAME model that
      // produced them; any other history gets portable parts, and Gemini 3
      // requires a signature on the first function call of each model turn.
      const parts: Part[] =
        message.native?.provider === this.id && message.native.model === model
          ? (message.native.parts as Part[])
          : [
              ...(message.content ? [{ text: message.content }] : []),
              ...message.toolCalls.map((call, index) => ({
                functionCall: {
                  id: call.id,
                  name: call.name,
                  args: call.arguments,
                },
                ...(index === 0 && isGemini3(model)
                  ? { thoughtSignature: SKIP_THOUGHT_SIGNATURE }
                  : {}),
              })),
            ];
      return { role: "model", parts };
    });
    let hint: RateHint = {};
    const finished = (reason: string | undefined) => {
      hint = {
        category:
          `FINISH_${(reason ?? "UNKNOWN").replace(/[^A-Z_]/g, "")}`.slice(
            0,
            80,
          ),
      };
      return new SafeError("INVALID_MODEL_RESPONSE");
    };
    try {
      const params: GenerateContentParameters = {
        model,
        contents,
        config: {
          systemInstruction: input.system,
          maxOutputTokens: input.maxOutputTokens,
          abortSignal: signal,
          // Gemini 3 thinking tokens count as output: LOW keeps tool turns
          // inside the turn budget and cuts latency (live finding: 1,792
          // output tokens for a single tool call).
          ...(isGemini3(model)
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
          httpOptions: { timeout: this.timeoutMs },
          ...(input.tools.length
            ? {
                tools: [
                  {
                    functionDeclarations: input.tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      parametersJsonSchema: tool.parameters,
                    })),
                  },
                ],
              }
            : {}),
          automaticFunctionCalling: { disable: true },
          automaticContinuation: false,
          ...(input.toolChoice
            ? {
                toolConfig: {
                  functionCallingConfig: {
                    mode: FunctionCallingConfigMode.ANY,
                  },
                },
              }
            : {}),
        },
      };
      let response: GenerateContentResponse;
      if (onDelta && this.models.generateContentStream) {
        response = new GenerateContentResponse();
        const allParts: Part[] = [];
        let bytes = 0;
        const stream = await this.models.generateContentStream(params);
        for await (const chunk of stream) {
          signal.throwIfAborted();
          bytes += Buffer.byteLength(JSON.stringify(chunk));
          if (bytes > 262144) throw new SafeError("INVALID_MODEL_RESPONSE");
          const parts = chunk.candidates?.[0]?.content?.parts ?? [];
          if (
            chunk.candidates?.[0]?.finishReason &&
            chunk.candidates[0].finishReason !== "STOP"
          )
            throw finished(chunk.candidates[0].finishReason);
          allParts.push(...parts);
          for (const part of parts)
            if (!part.thought && part.text) onDelta(part.text);
          if (chunk.usageMetadata) response.usageMetadata = chunk.usageMetadata;
        }
        response.candidates = [{ content: { role: "model", parts: allParts } }];
      } else response = await this.models.generateContent(params);
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      if (
        response.candidates?.[0]?.finishReason &&
        response.candidates[0].finishReason !== "STOP"
      )
        throw finished(response.candidates[0].finishReason);
      const output = ModelOutput.safeParse({
        text: parts
          .filter((p) => !p.thought && typeof p.text === "string")
          .map((p) => p.text)
          .join(""),
        toolCalls: parts.flatMap((p) =>
          p.functionCall
            ? [
                {
                  id: p.functionCall.id ?? randomUUID(),
                  name: p.functionCall.name,
                  arguments: p.functionCall.args ?? {},
                },
              ]
            : [],
        ),
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: Math.max(
            0,
            (response.usageMetadata?.totalTokenCount ??
              (response.usageMetadata?.promptTokenCount ?? 0) +
                (response.usageMetadata?.candidatesTokenCount ?? 0)) -
              (response.usageMetadata?.promptTokenCount ?? 0),
          ),
        },
      });
      if (!output.success) throw new SafeError("INVALID_MODEL_RESPONSE");
      return { ...output.data, native: { provider: this.id, model, parts } };
    } catch (error) {
      if (
        !(error instanceof SafeError) &&
        typeof error === "object" &&
        error !== null
      ) {
        const status = "status" in error ? error.status : undefined;
        const text = "message" in error ? String(error.message) : "";
        if (status === 429) hint = rateHintFromText(text);
        else if (status === 400)
          hint = {
            category: /thought_?signature/i.test(text)
              ? "UPSTREAM_THOUGHT_SIGNATURE"
              : "UPSTREAM_BAD_REQUEST",
          };
      }
      throw providerError(
        error,
        signal,
        {
          provider: "gemini",
          model,
          operation: onDelta ? "generate_stream" : "generate",
        },
        hint,
      );
    }
  }
}
