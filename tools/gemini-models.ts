import { z } from "zod";

const key = process.env.GEMINI_API_KEY;
const Catalog = z.object({
  models: z
    .array(
      z.object({
        name: z.string().regex(/^models\/[a-zA-Z0-9._-]+$/),
        supportedGenerationMethods: z.array(z.string()).optional(),
      }),
    )
    .max(500),
  nextPageToken: z.string().max(2000).optional(),
});
if (!key) {
  process.stdout.write(
    "GEMINI_API_KEY is missing. Enter it locally with tools/configure-cloud.ps1; do not paste it into chat.\n",
  );
  process.exitCode = 2;
} else {
  try {
    const models: string[] = [];
    let token: string | undefined;
    for (let page = 0; page < 5; page++) {
      const url = new URL(
        "https://generativelanguage.googleapis.com/v1beta/models",
      );
      url.searchParams.set("pageSize", "100");
      if (token) url.searchParams.set("pageToken", token);
      const response = await fetch(url, {
        headers: { "x-goog-api-key": key },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        process.stdout.write(
          `Gemini model catalog request failed (HTTP ${response.status}); no generation was verified.\n`,
        );
        process.exitCode = 1;
        break;
      }
      const body = await response.text();
      if (Buffer.byteLength(body) > 262144)
        throw new Error("Catalog size limit");
      const result = Catalog.parse(JSON.parse(body));
      models.push(
        ...result.models
          .filter((m) =>
            m.supportedGenerationMethods?.includes("generateContent"),
          )
          .map((m) => m.name.slice(7)),
      );
      token = result.nextPageToken;
      if (!token) break;
    }
    if (!process.exitCode)
      process.stdout.write(
        `${JSON.stringify({ authentication: "model_catalog_accepted", models, complete: !token, generationVerified: false, toolCallingVerified: false }, null, 2)}\n`,
      );
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? cause.code
        : undefined;
    const network = [
      "EACCES",
      "ENOTFOUND",
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
    ].includes(String(code))
      ? ` (${code})`
      : "";
    process.stdout.write(
      `Gemini model catalog unavailable${network}; no authenticated generation or tool call was verified.\n`,
    );
    process.exitCode = 1;
  }
}
