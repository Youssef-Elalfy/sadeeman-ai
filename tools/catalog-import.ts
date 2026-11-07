import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { AuthoritativeCatalogBatch } from "@sadeeman/contracts";
import {
  createLocalDatabase,
  localDatabasePath,
  projectRoot,
} from "../apps/api/dist/persistence/local.js";

// Operator-only local data import. No Supabase client, network, secrets or automatic demo seeds.
try {
  const fileIndex = process.argv.indexOf("--file");
  if (
    !process.argv.includes("--local") ||
    fileIndex < 0 ||
    !process.argv[fileIndex + 1]
  )
    throw new Error("USAGE_LOCAL_FILE_REQUIRED");
  const file = await realpath(
    resolve(projectRoot, process.argv[fileIndex + 1] ?? ""),
  );
  if (
    !file
      .toLowerCase()
      .startsWith((resolve(projectRoot) + sep).toLowerCase()) ||
    !file.toLowerCase().endsWith(".json")
  )
    throw new Error("INPUT_MUST_BE_PROJECT_JSON");
  if ((await stat(file)).size > 256000) throw new Error("INPUT_TOO_LARGE");
  const packages = AuthoritativeCatalogBatch.parse(
    JSON.parse(await readFile(file, "utf8")),
  );
  if (packages.some((p) => p.isDemo)) throw new Error("DEMO_RECORDS_TEST_ONLY");
  const db = await createLocalDatabase(
    localDatabasePath(process.env.LOCAL_DATABASE_PATH ?? ".private/postgres"),
    { includeProposed: false },
  );
  try {
    await db.db.transaction(async (tx) => {
      for (const p of packages)
        await tx.query(
          "insert into public.sadeeman_company_packages(id,document) values($1,$2::jsonb)",
          [p.id, JSON.stringify(p)],
        );
    });
    process.stdout.write(
      `Imported ${packages.length} records into LOCAL PostgreSQL. No hosted operations.\n`,
    );
  } finally {
    await db.close();
  }
} catch (error) {
  const allowed = [
    "USAGE_LOCAL_FILE_REQUIRED",
    "INPUT_MUST_BE_PROJECT_JSON",
    "INPUT_TOO_LARGE",
    "DEMO_RECORDS_TEST_ONLY",
  ];
  process.stderr.write(
    `${error instanceof Error && allowed.includes(error.message) ? error.message : "CATALOG_IMPORT_FAILED"}\n`,
  );
  process.exitCode = 1;
}
