import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthoritativeCatalogBatch } from "@sadeeman/contracts";

// Pure data validation: no database, env loading, provider client, network or import operation.
try {
  const root = fileURLToPath(new URL("../", import.meta.url)),
    index = process.argv.indexOf("--file");
  const supplied = process.argv[index + 1];
  if (index < 0 || !supplied) throw new Error("FILE_ARGUMENT_REQUIRED");
  const file = await realpath(resolve(root, supplied));
  if (
    !file.toLowerCase().startsWith((resolve(root) + sep).toLowerCase()) ||
    !file.toLowerCase().endsWith(".json")
  )
    throw new Error("PROJECT_JSON_REQUIRED");
  if ((await stat(file)).size > 256000) throw new Error("INPUT_TOO_LARGE");
  const input = await readFile(file, "utf8");
  if (Buffer.byteLength(input) > 256000) throw new Error("INPUT_TOO_LARGE");
  const result = AuthoritativeCatalogBatch.safeParse(JSON.parse(input));
  if (!result.success) {
    process.stdout.write(
      `${JSON.stringify({
        status: "INVALID_CATALOG",
        issues: result.error.issues.slice(0, 20).map((issue) => ({
          code: issue.code,
          path: issue.path
            .map((part) =>
              String(part)
                .replace(/[^a-zA-Z0-9_]/g, "")
                .slice(0, 80),
            )
            .join("."),
        })),
      })}\n`,
    );
    process.exitCode = 1;
  } else
    process.stdout.write(
      `${JSON.stringify({ status: "VALID_STRUCTURE_REQUIRES_OPERATOR_SOURCE_REVIEW", records: result.data.length, published: result.data.filter((p) => p.status === "published").length, unknownPrice: result.data.filter((p) => p.price.amountMinor === null).length, unknownDates: result.data.filter((p) => p.departures.length === 0).length, databaseWrites: 0, networkRequests: 0 })}\n`,
    );
} catch (error) {
  const codes = [
    "FILE_ARGUMENT_REQUIRED",
    "PROJECT_JSON_REQUIRED",
    "INPUT_TOO_LARGE",
  ];
  process.stderr.write(
    `${error instanceof Error && codes.includes(error.message) ? error.message : "CATALOG_VALIDATION_FAILED"}\n`,
  );
  process.exitCode = 1;
}
