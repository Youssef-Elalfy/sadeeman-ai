import type { ModelOutput, ToolCall, ToolResult } from "@sadeeman/contracts";

export type ModelMessage =
  | {
      role: "user";
      content: string;
      /** In-run only: files the model must actually see (base64). */
      attachments?: { mime: string; data: string }[];
    }
  | {
      role: "assistant";
      content: string;
      toolCalls: ToolCall[];
      native?: { provider: string; parts: unknown };
    }
  | { role: "tool"; callId: string; name: string; result: ToolResult };
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ModelInput {
  system: string;
  messages: ModelMessage[];
  tools: ToolDefinition[];
  maxOutputTokens: number;
  toolChoice?: "required";
}
export interface Generation extends ModelOutput {
  native?: { provider: string; parts: unknown };
}
export interface ModelAdapter {
  readonly id: string;
  readonly capabilities: {
    tools: boolean;
    /** Can read inline images/PDFs. Adapters without it are skipped for such turns. */
    attachments?: boolean;
    streaming: boolean;
    contextChars: number;
  };
  generate(
    input: ModelInput,
    signal: AbortSignal,
    onDelta?: (text: string) => void,
  ): Promise<Generation>;
}
