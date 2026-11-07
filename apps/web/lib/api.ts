import { z } from "zod";

const tokenKey = "sadeeman.session";
export function token() {
  return typeof window === "undefined"
    ? ""
    : (sessionStorage.getItem(tokenKey) ?? "");
}
const refreshKey = "sadeeman.refresh";
export const consentKey = "sadeeman.memoryConsent";
export function saveToken(value: string, refresh?: string) {
  if (value) sessionStorage.setItem(tokenKey, value);
  else sessionStorage.removeItem(tokenKey);
  if (!value) sessionStorage.removeItem(consentKey);
  if (!value || refresh === "") sessionStorage.removeItem(refreshKey);
  else if (refresh) sessionStorage.setItem(refreshKey, refresh);
}
export const SessionGrant = z.object({
  token: z.string().min(1),
  refreshToken: z.string().optional(),
});
let refreshing: Promise<boolean> | null = null;
/** Fired when the session is definitively gone, so the UI returns to the gate. */
export const sessionExpired = "sadeeman:session-expired";
/**
 * Supabase access tokens expire after about an hour. On a 401 we try the
 * stored refresh token once (single-flight); the API re-verifies the refreshed
 * session against durable revocation before returning it.
 */
async function refreshSession(): Promise<boolean> {
  const refreshToken = sessionStorage.getItem(refreshKey);
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const response = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
      // A transient outage (429/5xx) must not log the user out; only an
      // explicit auth rejection invalidates the stored session.
      if ([400, 401, 403].includes(response.status)) {
        saveToken("");
        return false;
      }
      const grant = SessionGrant.safeParse(
        response.ok ? await response.json().catch(() => null) : null,
      );
      if (!grant.success) return false;
      saveToken(grant.data.token, grant.data.refreshToken ?? refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
export function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${token()}`,
    "Content-Type": "application/json",
  };
}
/**
 * Maps the API's safe error codes to customer-facing Arabic text. Never shows
 * raw technical detail; each message says what happened and what to do next.
 */
export function failureMessage(status: number, code: string): string {
  switch (code) {
    case "FORBIDDEN_ORIGIN":
      return "عنوان الصفحة مش متطابق مع إعدادات الخادم المحلي. افتح التطبيق من العنوان اللي طبعه أمر التشغيل، أو حدّث WEB_ORIGIN في ملف ‎.env‎.";
    case "RATE_LIMITED":
    case "CAPACITY":
      return "طلبات كتير في وقت قصير. استنى دقيقة وجرّب تاني.";
    case "CONSENT_REQUIRED":
      return "المراجعة دي انتهت صلاحيتها أو محتاجة موافقتك من جديد.";
    case "DATABASE_UNAVAILABLE":
      return "قاعدة البيانات مش متاحة دلوقتي. مفيش حاجة اتغيرت؛ حاول بعد شوية.";
    case "PROVIDER_UNAVAILABLE":
      return "خدمة الدخول مش متاحة دلوقتي. مفيش جلسة اتفتحت؛ حاول بعد شوية.";
    case "DISCONNECTED":
      return "الخاصية دي مش مفعّلة في الإعداد الحالي للخادم.";
    case "NETWORK":
      return "الخادم المحلي مش بيرد. اتأكد إن خدمة الـ API شغالة وحاول تاني.";
    case "IDEMPOTENCY_CONFLICT":
    case "VERSION_CONFLICT":
    case "CONFLICT":
      return "التفاصيل اتغيرت؛ حدّث الصفحة وحاول تاني.";
  }
  if (status === 401) return "الجلسة انتهت؛ افتح جلسة جديدة.";
  if (status === 403) return "مش مسموح لحسابك بالإجراء ده.";
  if (status === 409) return "التفاصيل اتغيرت؛ حدّث الصفحة وحاول تاني.";
  if (status === 429) return "طلبات كتير في وقت قصير. استنى دقيقة وجرّب تاني.";
  if (status === 400) return "راجع البيانات المطلوبة وحاول تاني.";
  return "الخدمة مش متاحة دلوقتي. بياناتك المؤكدة ما اتغيرتش.";
}
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(failureMessage(status, code));
  }
}
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  retried = false,
): Promise<T> {
  const requestHeaders = headers();
  const sentToken = token();
  if (body === undefined) delete requestHeaders["Content-Type"];
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers: requestHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
      cache: "no-store",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiFailure(0, "NETWORK");
  }
  // The Next dev proxy answers 500 with a non-JSON body when the API is down.
  if (
    response.status >= 500 &&
    !response.headers.get("content-type")?.includes("json")
  )
    throw new ApiFailure(response.status, "NETWORK");
  const sessionRoute = ![
    "/auth/guest",
    "/auth/login",
    "/auth/refresh",
  ].includes(path);
  if (response.status === 401 && sessionRoute) {
    if (!retried && (await refreshSession()))
      return api(path, schema, method, body, signal, true);
    if (token() || sentToken) window.dispatchEvent(new Event(sessionExpired));
  }
  if (!response.ok) {
    const error = z
      .object({ error: z.string() })
      .safeParse(await response.json().catch(() => null));
    throw new ApiFailure(
      response.status,
      error.success ? error.data.error : "UNAVAILABLE",
    );
  }
  const bodyValue =
    response.status === 204
      ? undefined
      : await response.json().catch(() => undefined);
  const result = schema.safeParse(bodyValue);
  if (!result.success)
    throw new Error(
      "الخدمة ردّت بشكل غير متوقع. مفيش عملية جديدة مؤكدة؛ حاول تاني.",
    );
  return result.data;
}
export const Id = z.object({ id: z.uuid() });
export const History = z.array(
  z.object({ id: z.uuid(), createdAt: z.string(), messageCount: z.number() }),
);
export const Message = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export async function streamEvents(
  runId: string,
  onEvent: (value: unknown) => void,
  signal: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(`/api/v1/agent/events/${runId}`, {
      headers: headers(),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiFailure(0, "NETWORK");
  }
  if (!response.ok) throw new ApiFailure(response.status, "STREAM");
  if (!response.body) throw new ApiFailure(502, "UNAVAILABLE");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  const emit = (data: string) => {
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      throw new ApiFailure(502, "UNAVAILABLE");
    }
    onEvent(value);
  };
  let buffer = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      let end = buffer.indexOf("\n");
      while (end >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line.startsWith("data: ")) emit(line.slice(6));
        end = buffer.indexOf("\n");
      }
      if (buffer.length > 100000)
        throw new ApiFailure(413, "REQUEST_TOO_LARGE");
    }
    const tail = buffer.trim();
    if (tail.startsWith("data: ")) emit(tail.slice(6));
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
