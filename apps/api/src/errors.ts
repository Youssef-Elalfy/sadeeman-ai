import { ProviderFailure } from "@sadeeman/contracts";

export type ErrorCode =
  | "DISCONNECTED"
  | "PROVIDER_AUTH"
  | "PROVIDER_QUOTA"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_MODEL_RESPONSE"
  | "UNGROUNDED_RESPONSE"
  | "TURN_BUDGET"
  | "CANCELED"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN_ORIGIN"
  | "CONFLICT"
  | "CAPACITY"
  | "INVALID_REQUEST";
export type StorageErrorCode =
  | "DATABASE_UNAVAILABLE"
  | "CONSENT_REQUIRED"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT";

export class SafeError extends Error {
  constructor(
    public readonly code: ErrorCode | StorageErrorCode,
    public readonly status = 503,
    public readonly providerFailure?: ProviderFailure,
    /** Upstream retry hint (ms), from Retry-After / RetryInfo only. */
    public readonly retryAfterMs?: number,
  ) {
    super(code);
  }
}
export function safeError(error: unknown): SafeError {
  return error instanceof SafeError
    ? error
    : new SafeError("PROVIDER_UNAVAILABLE");
}
export function providerError(
  error: unknown,
  signal: AbortSignal,
  context?: Pick<ProviderFailure, "provider" | "model" | "operation">,
  hint: RateHint = {},
): SafeError {
  const status =
    // SafeError.status is OUR HTTP response status, not an upstream status.
    // In particular INVALID_MODEL_RESPONSE defaults to 503 locally.
    !(error instanceof SafeError) &&
    typeof error === "object" &&
    error !== null &&
    "status" in error
      ? error.status
      : undefined;
  const failure = signal.aborted
    ? new SafeError("PROVIDER_TIMEOUT")
    : error instanceof SafeError
      ? error
      : status === 401 || status === 403
        ? new SafeError("PROVIDER_AUTH")
        : status === 429
          ? new SafeError("PROVIDER_QUOTA")
          : typeof status === "number" && status >= 400 && status < 500
            ? new SafeError("INVALID_MODEL_RESPONSE")
            : new SafeError("PROVIDER_UNAVAILABLE");
  if (!context || (error instanceof SafeError && error.providerFailure))
    return failure;
  // Never retain raw error messages, headers, organization identifiers or request contents.
  return new SafeError(
    failure.code,
    failure.status,
    ProviderFailure.parse({
      ...context,
      // A finer diagnostic label when known (e.g. FINISH_MAX_TOKENS); the
      // SafeError code above still drives routing.
      category: hint.category ?? failure.code,
      upstreamStatus:
        typeof status === "number" && status >= 100 && status <= 599
          ? status
          : null,
      quotaScope: hint.quotaScope ?? "unknown",
      modelSpecific: null,
      observedAt: new Date().toISOString(),
    }),
    hint.retryAfterMs,
  );
}
export type RateHint = {
  quotaScope?: ProviderFailure["quotaScope"];
  retryAfterMs?: number;
  category?: string;
};
/**
 * Reads only the rate-limit window and retry delay from an upstream error text
 * (as MASAR does). Nothing else from the text is kept or logged.
 */
export function rateHintFromText(text: string): RateHint {
  const delay = /"?retryDelay"?\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(text);
  const quotaScope: ProviderFailure["quotaScope"] =
    /per\s*day|requests_per_day|\bRPD\b|\bTPD\b/i.test(text)
      ? "daily"
      : /per\s*minute|\bRPM\b|\bTPM\b/i.test(text)
        ? "per_minute"
        : "unknown";
  return {
    quotaScope,
    ...(delay?.[1]
      ? { retryAfterMs: Math.round(Number(delay[1]) * 1000) }
      : {}),
  };
}
/** Milliseconds until the next midnight in Pacific time (Gemini daily reset). */
function untilPacificMidnight(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const elapsed =
    ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000;
  return Math.max(60_000, 24 * 3_600_000 - elapsed);
}
/**
 * How long a provider/model should rest after a failure (MASAR's policy):
 * daily quota → until the provider's hint or the daily reset; per-minute or
 * unspecified rate limit → the retry hint, at least 30 s; overload → 60 s.
 * Returns 0 for failures that say nothing about availability.
 */
export function cooldownMs(error: SafeError, now = new Date()): number {
  if (error.code === "PROVIDER_QUOTA") {
    if (error.providerFailure?.quotaScope === "daily")
      return (
        error.retryAfterMs ??
        (error.providerFailure.provider === "gemini"
          ? untilPacificMidnight(now)
          : 3_600_000)
      );
    return Math.min(Math.max(error.retryAfterMs ?? 0, 30_000), 600_000);
  }
  if (error.code === "PROVIDER_UNAVAILABLE") return 60_000;
  return 0;
}
