import { z } from "zod";
import {
  freeToolModels,
  OpenRouterCatalog,
} from "../apps/api/dist/providers/catalog.js";

// Readiness probes only. No runtime research tool, fixture response or customer data.
const service = process.argv
  .find((arg) => arg.startsWith("--service="))
  ?.slice(10);
let stage = "configuration",
  httpStatus: number | undefined;
let catalogShape:
  | { envelopeType: string; dataType: string; modelCount?: number }
  | undefined;
let invalidPublicModelIds:
  | { id: string; unexpectedCharacters: string[] }[]
  | undefined;
async function readJson(
  url: string,
  key: string,
  payload?: unknown,
): Promise<unknown> {
  const response = await fetch(url, {
    method: payload ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  httpStatus = response.status;
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Request unavailable");
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > 4194304) throw new Error("Response size limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
const emit = (data: Record<string, unknown>) =>
  process.stdout.write(
    `${JSON.stringify({ service, checkedAt: new Date().toISOString(), credentialsDisplayed: false, ...data }, null, 2)}\n`,
  );
if (
  !process.argv.includes("--live") ||
  !["groq", "openrouter", "tavily"].includes(service ?? "")
) {
  process.stderr.write(
    "Use --live --service=groq|openrouter|tavily. Tavily --search opts into one basic public-doc query.\n",
  );
  process.exitCode = 2;
} else {
  try {
    const keyName =
      service === "groq"
        ? "GROQ_API_KEY"
        : service === "openrouter"
          ? "OPENROUTER_API_KEY"
          : "TAVILY_API_KEY";
    const key = process.env[keyName];
    if (!key) throw new Error("Missing local credential");
    if (service === "groq") {
      stage = "authenticated_model_catalog";
      const catalog = z
        .object({
          data: z
            .array(
              z.object({
                id: z.string().regex(/^[A-Za-z0-9/_.:-]{1,160}$/),
                active: z.boolean().optional(),
              }),
            )
            .max(5000),
        })
        .parse(await readJson("https://api.groq.com/openai/v1/models", key));
      emit({
        status: "AUTHENTICATED_MODEL_CATALOG_PASSED",
        models: catalog.data.filter((m) => m.active !== false).map((m) => m.id),
        generationVerified: false,
        toolCallingVerified: false,
      });
    } else if (service === "openrouter") {
      stage = "authenticated_key_check";
      z.object({ data: z.object({}) }).parse(
        await readJson("https://openrouter.ai/api/v1/key", key),
      );
      stage = "free_tool_model_catalog";
      const rawCatalog = await readJson(
        "https://openrouter.ai/api/v1/models",
        key,
      );
      if (process.argv.includes("--diagnose")) {
        const data =
          typeof rawCatalog === "object" &&
          rawCatalog !== null &&
          "data" in rawCatalog
            ? rawCatalog.data
            : undefined;
        catalogShape = {
          envelopeType: typeof rawCatalog,
          dataType: Array.isArray(data) ? "array" : typeof data,
          ...(Array.isArray(data) ? { modelCount: data.length } : {}),
        };
        if (Array.isArray(data))
          invalidPublicModelIds = data
            .flatMap((item) => {
              if (
                typeof item !== "object" ||
                item === null ||
                !("id" in item) ||
                typeof item.id !== "string" ||
                /^[A-Za-z0-9/_.:-]{1,160}$/.test(item.id)
              )
                return [];
              return [
                {
                  id: item.id.slice(0, 200),
                  unexpectedCharacters: [
                    ...new Set(
                      [...item.id].filter((c) => !/[A-Za-z0-9/_.:-]/.test(c)),
                    ),
                  ],
                },
              ];
            })
            .slice(0, 5);
      }
      const catalog = OpenRouterCatalog.parse(rawCatalog);
      const freeToolModelIds = freeToolModels(catalog);
      emit({
        status: "AUTHENTICATED_KEY_AND_CATALOG_PASSED",
        freeToolModels: freeToolModelIds,
        generationVerified: false,
        toolCallingVerified: false,
        paidModelSelected: false,
      });
    } else {
      stage = "authenticated_usage_check";
      z.object({ key: z.object({}), account: z.object({}) }).parse(
        await readJson("https://api.tavily.com/usage", key),
      );
      if (!process.argv.includes("--search"))
        emit({
          status: "AUTHENTICATED_USAGE_PASSED",
          searchVerified: false,
          searchRequests: 0,
          runtimeResearchEnabled: false,
        });
      else {
        stage = "one_public_document_search";
        const response = z
          .object({
            results: z
              .array(z.object({ url: z.url(), title: z.string() }))
              .max(1),
          })
          .parse(
            await readJson("https://api.tavily.com/search", key, {
              query: "Supabase official documentation row level security",
              search_depth: "basic",
              max_results: 1,
              include_domains: ["supabase.com"],
              include_answer: false,
              include_raw_content: false,
              topic: "general",
            }),
          );
        const first = response.results[0];
        if (!first) throw new Error("No search evidence");
        const source = new URL(first.url);
        if (
          source.protocol !== "https:" ||
          (source.hostname !== "supabase.com" &&
            !source.hostname.endsWith(".supabase.com"))
        )
          throw new Error("Unexpected source domain");
        emit({
          status: "REAL_AUTHENTICATED_SEARCH_PASSED",
          searchRequests: 1,
          resultCount: response.results.length,
          sourceHost: source.hostname,
          runtimeResearchEnabled: false,
        });
      }
    }
  } catch (error) {
    const issues =
      error instanceof z.ZodError
        ? error.issues.slice(0, 15).map((issue) => ({
            path: issue.path,
            code: issue.code,
            ...("expected" in issue ? { expectedType: issue.expected } : {}),
          }))
        : undefined;
    const failureKind = issues
      ? "SCHEMA_VALIDATION"
      : error instanceof Error && error.message === "Response size limit"
        ? "RESPONSE_SIZE_LIMIT"
        : error instanceof SyntaxError
          ? "MALFORMED_JSON"
          : "REQUEST_UNAVAILABLE";
    emit({
      status: "FAILED_OR_BLOCKED",
      stage,
      httpStatus,
      ...(process.argv.includes("--diagnose")
        ? { failureKind, catalogShape, invalidPublicModelIds, issues }
        : {}),
      completed: false,
    });
    process.exitCode = 1;
  }
}
