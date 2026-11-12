import { randomUUID } from "node:crypto";
import type { ModelOutput } from "@sadeeman/contracts";
import { type Config, loadConfig } from "../apps/api/src/config.js";
import { ModelRouter } from "../apps/api/src/providers/router.js";
import type {
  Generation,
  ModelAdapter,
  ModelInput,
} from "../apps/api/src/providers/types.js";
import { LocalState } from "../apps/api/src/state.js";

export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  ...loadConfig({ NODE_ENV: "test" }),
  PROVIDER_RETRIES: 0,
  // Scripted answers are placeholders; style rewrites are tested explicitly.
  ENABLE_STYLE_GUARD: false,
  ...overrides,
});
export function answer(text = "Synthetic test answer"): ModelOutput {
  return { text, toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } };
}
export function tool(
  name: string,
  args: Record<string, unknown>,
  id: string = randomUUID(),
): ModelOutput {
  return { ...answer(""), toolCalls: [{ id, name, arguments: args }] };
}
export class ScriptedAdapter implements ModelAdapter {
  readonly capabilities = {
    tools: true,
    streaming: false,
    contextChars: 64000,
  };
  readonly inputs: ModelInput[] = [];
  constructor(
    private readonly script: ((
      input: ModelInput,
      signal: AbortSignal,
    ) => Promise<Generation>)[],
    readonly id = "test-only",
  ) {}
  async generate(input: ModelInput, signal: AbortSignal): Promise<Generation> {
    this.inputs.push(structuredClone(input));
    const step = this.script.shift();
    if (!step) throw new Error("Test script exhausted");
    return step(input, signal);
  }
}
export function setup(adapter: ModelAdapter, config = testConfig()) {
  const state = new LocalState();
  const session = state.createSession();
  const ownerId = state.authenticate(`Bearer ${session.token}`);
  const conversation = state.createConversation(ownerId);
  const router = new ModelRouter([adapter], config);
  return { state, ownerId, conversation, router, config };
}
