import { setTimeout as delay } from "node:timers/promises";
import { ModelOutput, type ProviderFailure } from "@sadeeman/contracts";
import { fitModelInput, forProvider } from "../agent/context.js";
import type { Config } from "../config.js";
import { cooldownMs, SafeError, safeError } from "../errors.js";
import { CompatibleAdapter } from "./compatible.js";
import { GeminiAdapter } from "./gemini.js";
import type { Generation, ModelAdapter, ModelInput } from "./types.js";

// Promise.race bounds even a broken adapter that ignores AbortSignal.
export async function withinDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal,
  ms: number,
): Promise<T> {
  if (parent.aborted) throw new SafeError("CANCELED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, ms));
  const signal = AbortSignal.any([parent, controller.signal]);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(new SafeError(parent.aborted ? "CANCELED" : "PROVIDER_TIMEOUT"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([run(signal), aborted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
export class ModelRouter {
  private readonly skips = new Map<
    string,
    | "attachments_not_supported"
    | "tools_not_supported"
    | "context_capacity"
    | "cooldown"
  >();
  private readonly observations = new Map<
    string,
    {
      status: "available" | "unavailable";
      lastSuccessAt?: string;
      lastError?: string;
    }
  >();
  private readonly circuits = new Map<
    string,
    { failures: number; openUntil: number }
  >();
  constructor(
    readonly adapters: ModelAdapter[],
    private readonly config: Config,
  ) {}
  get configured(): boolean {
    return this.adapters.length > 0;
  }
  statuses() {
    return this.adapters.map((adapter) => ({
      id: adapter.id,
      streaming: adapter.capabilities.streaming,
      ...(this.observations.get(adapter.id) ?? { status: "not_verified" }),
      ...(this.skips.has(adapter.id)
        ? { skipReason: this.skips.get(adapter.id) }
        : {}),
    }));
  }
  canGenerate(input: ModelInput, excluded: readonly string[] = []): boolean {
    const needsFiles = input.messages.some(
      (m) => m.role === "user" && m.attachments?.length,
    );
    return this.adapters.some(
      (adapter) =>
        !excluded.includes(adapter.id) &&
        (this.circuits.get(adapter.id)?.openUntil ?? 0) <= Date.now() &&
        (!needsFiles || adapter.capabilities.attachments) &&
        (!input.tools.length || adapter.capabilities.tools) &&
        Boolean(
          fitModelInput(
            forProvider(input, adapter.id),
            adapter.capabilities.contextChars,
          ),
        ),
    );
  }
  async generate(
    input: ModelInput,
    signal: AbortSignal,
    onDelta?: (text: string) => void,
    onFailure?: (failure: ProviderFailure) => void,
    options: {
      deadlineAt?: number;
      bufferedDeltas?: boolean;
      excludeProviders?: readonly string[];
      onAttempt?: (providerId: string) => void;
    } = {},
  ): Promise<Generation & { providerId: string }> {
    if (!this.configured) throw new SafeError("DISCONNECTED");
    let last = new SafeError("PROVIDER_UNAVAILABLE");
    let meaningful: SafeError | undefined;
    // A turn with an image/PDF only goes to providers that can actually read
    // it; never let a text-only fallback answer as if it had seen the file.
    const needsFiles = input.messages.some(
      (m) => m.role === "user" && (m.attachments?.length ?? 0) > 0,
    );
    const candidates = this.adapters.flatMap((adapter) => {
      if (options.excludeProviders?.includes(adapter.id)) return [];
      const skip =
        needsFiles && !adapter.capabilities.attachments
          ? "attachments_not_supported"
          : input.tools.length > 0 && !adapter.capabilities.tools
            ? "tools_not_supported"
            : undefined;
      if (skip) {
        this.skips.set(adapter.id, skip);
        return [];
      }
      const projected = fitModelInput(
        forProvider(input, adapter.id),
        adapter.capabilities.contextChars,
      );
      if (!projected) {
        this.skips.set(adapter.id, "context_capacity");
        return [];
      }
      this.skips.delete(adapter.id);
      return [{ adapter, input: projected }];
    });
    for (const [index, candidate] of candidates.entries()) {
      const { adapter } = candidate;
      const hasFallback = candidates
        .slice(index + 1)
        .some(
          ({ adapter: next }) =>
            (this.circuits.get(next.id)?.openUntil ?? 0) <= Date.now(),
        );
      if (signal.aborted) throw new SafeError("CANCELED");
      const circuit = this.circuits.get(adapter.id) ?? {
        failures: 0,
        openUntil: 0,
      };
      if (circuit.openUntil > Date.now()) {
        this.skips.set(adapter.id, "cooldown");
        const category = this.observations.get(adapter.id)?.lastError;
        if (category === "PROVIDER_QUOTA" || category === "PROVIDER_AUTH") {
          last = new SafeError(category);
          meaningful ??= last;
        }

        continue;
      }
      for (
        let attempt = 0;
        attempt <= this.config.PROVIDER_RETRIES;
        attempt++
      ) {
        let emitted = false;
        let accepting = true;
        const deltas: string[] = [];
        let deltaChars = 0;
        try {
          const availableMs =
            (options.deadlineAt ?? Number.POSITIVE_INFINITY) - Date.now();
          if (availableMs <= 0) throw new SafeError("PROVIDER_TIMEOUT");
          options.onAttempt?.(adapter.id);
          const raw = await withinDeadline(
            (s) =>
              adapter.generate(
                candidate.input,
                s,
                this.config.ENABLE_PROVIDER_STREAMING &&
                  onDelta &&
                  adapter.capabilities.streaming
                  ? (text) => {
                      if (!accepting || s.aborted) return;
                      if (options.bufferedDeltas) {
                        deltaChars += text.length;
                        if (deltaChars > 24000)
                          throw new SafeError("INVALID_MODEL_RESPONSE");
                        deltas.push(text);
                      } else {
                        emitted = true;
                        onDelta(text);
                      }
                    }
                  : undefined,
              ),
            signal,
            Math.min(
              this.config.MODEL_TIMEOUT_MS,
              Math.max(1, Math.floor(availableMs / (hasFallback ? 2 : 1))),
            ),
          );
          const output = ModelOutput.safeParse({
            text: raw.text,
            toolCalls: raw.toolCalls,
            usage: raw.usage,
          });
          if (!output.success) throw new SafeError("INVALID_MODEL_RESPONSE");
          accepting = false;
          if (options.bufferedDeltas)
            for (const text of deltas) onDelta?.(text);
          this.circuits.set(adapter.id, { failures: 0, openUntil: 0 });
          this.observations.set(adapter.id, {
            status: "available",
            lastSuccessAt: new Date().toISOString(),
          });
          return {
            ...output.data,
            ...(raw.native ? { native: raw.native } : {}),
            providerId: adapter.id,
          };
        } catch (error) {
          if (signal.aborted) {
            throw new SafeError("CANCELED");
          }

          last = safeError(error);
          if (["TURN_BUDGET", "CANCELED"].includes(last.code)) throw last;
          const temporaryFailure =
            last.code === "PROVIDER_UNAVAILABLE" ||
            last.code === "PROVIDER_TIMEOUT";

          if (last.providerFailure) {
            onFailure?.(last.providerFailure);
          }

          this.observations.set(adapter.id, {
            ...this.observations.get(adapter.id),
            status: "unavailable",
            lastError: last.code,
          });

          circuit.failures++;

          // Rate limits rest for their real window (per-minute ≥ 30 s,
          // daily until reset); auth problems use the configured cooldown.
          circuit.openUntil =
            last.code === "PROVIDER_QUOTA"
              ? Date.now() + cooldownMs(last)
              : last.code === "PROVIDER_AUTH"
                ? Date.now() + this.config.PROVIDER_QUOTA_COOLDOWN_MS
                : circuit.failures >= 3
                  ? Date.now() + 30000
                  : 0;

          this.circuits.set(adapter.id, circuit);

          // Never mix partially streamed responses from different models.
          if (emitted) throw last;

          // A temporary 503 must not override a more informative
          // failure reported by a later provider.
          const priority = (error: SafeError) =>
            [
              "PROVIDER_UNAVAILABLE",
              "PROVIDER_TIMEOUT",
              "INVALID_MODEL_RESPONSE",
              "PROVIDER_QUOTA",
              "PROVIDER_AUTH",
            ].indexOf(error.code);
          if (!meaningful || priority(last) > priority(meaningful)) {
            meaningful = last;
          }

          // Prefer an eligible fallback immediately on timeout. Quota/auth and
          // malformed responses are never retried on the same provider.
          const retryable =
            temporaryFailure &&
            !(hasFallback && last.code === "PROVIDER_TIMEOUT");

          if (
            !retryable ||
            attempt === this.config.PROVIDER_RETRIES ||
            circuit.openUntil > Date.now()
          ) {
            break;
          }

          const backoff = 100 * 2 ** attempt + Math.floor(Math.random() * 50);
          if (
            Date.now() + backoff + 50 >=
            (options.deadlineAt ?? Number.POSITIVE_INFINITY)
          )
            break;
          await delay(backoff, undefined, { signal });
        } finally {
          accepting = false;
        }
      }
    }
    // Report the most informative failure (e.g. Gemini quota), not whichever
    // fallback happened to fail last with a generic "unavailable".
    throw meaningful ?? last;
  }
}
export function createRouter(config: Config): ModelRouter {
  const adapters: ModelAdapter[] = [];
  if (
    config.ENABLE_REAL_PROVIDER &&
    (config.NODE_ENV !== "test" || config.ALLOW_SYNTHETIC_PROVIDER_DATA)
  ) {
    const order = [
      ...new Set([
        config.MODEL_PROVIDER,
        ...config.FALLBACK_PROVIDERS.split(",")
          .map((p) => p.trim())
          .filter(Boolean),
      ]),
    ];
    for (const id of order) {
      if (
        id === "gemini" &&
        config.GEMINI_API_KEY &&
        validModel(config.GEMINI_MODEL)
      )
        adapters.push(
          new GeminiAdapter(
            config.GEMINI_API_KEY,
            config.GEMINI_MODEL,
            config.MODEL_TIMEOUT_MS,
          ),
        );
      if (id === "groq" && config.GROQ_API_KEY && validModel(config.GROQ_MODEL))
        adapters.push(
          new CompatibleAdapter("groq", config.GROQ_API_KEY, config.GROQ_MODEL),
        );
      if (
        id === "openrouter" &&
        config.ENABLE_OPENROUTER_RUNTIME &&
        config.OPENROUTER_API_KEY &&
        validModel(config.OPENROUTER_MODEL)
      )
        adapters.push(
          new CompatibleAdapter(
            "openrouter",
            config.OPENROUTER_API_KEY,
            config.OPENROUTER_MODEL,
          ),
        );
    }
  }
  return new ModelRouter(adapters, config);
}
function validModel(model: string): boolean {
  return Boolean(model.trim()) && !model.includes("CHECK_");
}
