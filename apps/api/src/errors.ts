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
      category: failure.code,
      upstreamStatus:
        typeof status === "number" && status >= 100 && status <= 599
          ? status
          : null,
      quotaScope: "unknown",
      modelSpecific: null,
      observedAt: new Date().toISOString(),
    }),
  );
}
