import { randomUUID } from "node:crypto";
import {
  type Content,
  FunctionCallingConfigMode,
  type GenerateContentParameters,
  GenerateContentResponse,
  GoogleGenAI,
  type Part,
} from "@google/genai";
import { ModelOutput } from "@sadeeman/contracts";
import { providerError, SafeError } from "../errors.js";
import type { Generation, ModelAdapter, ModelInput } from "./types.js";

export class GeminiAdapter implements ModelAdapter {
  readonly id = "gemini";
  readonly capabilities = {
    tools: true,
    attachments: true,
    streaming: true,
    contextChars: 64000,
  };
  private readonly models: Pick<GoogleGenAI["models"], "generateContent"> &
    Partial<Pick<GoogleGenAI["models"], "generateContentStream">>;
  constructor(
    key: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    models?: Pick<GoogleGenAI["models"], "generateContent"> &
      Partial<Pick<GoogleGenAI["models"], "generateContentStream">>,
  ) {
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
      // Preserve opaque SDK parts (including signatures) only for this provider.
      const parts: Part[] =
        message.native?.provider === this.id
          ? (message.native.parts as Part[])
          : [
              ...(message.content ? [{ text: message.content }] : []),
              ...message.toolCalls.map((call) => ({
                functionCall: {
                  id: call.id,
                  name: call.name,
                  args: call.arguments,
                },
              })),
            ];
      return { role: "model", parts };
    });
    try {
      const params: GenerateContentParameters = {
        model: this.model,
        contents,
        config: {
          systemInstruction: input.system,
          maxOutputTokens: input.maxOutputTokens,
          abortSignal: signal,
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
            throw new SafeError("INVALID_MODEL_RESPONSE");
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
        throw new SafeError("INVALID_MODEL_RESPONSE");
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
      return { ...output.data, native: { provider: this.id, parts } };
    } catch (error) {
      throw providerError(error, signal, {
        provider: "gemini",
        model: this.model,
        operation: onDelta ? "generate_stream" : "generate",
      });
    }
  }
}
