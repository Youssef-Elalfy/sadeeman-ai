import { loadConfig } from "../apps/api/dist/config.js";
import {
  LocalDatabase,
  openLocalPersistence,
} from "../apps/api/dist/persistence/local.js";

const config = loadConfig();
if (
  !process.argv.includes("--local") ||
  config.PERSISTENCE_MODE === "supabase"
) {
  process.stderr.write(
    "This command only migrates the embedded local database. Select PERSISTENCE_MODE=local and pass --local. No hosted migrations are performed.\n",
  );
  process.exitCode = 2;
} else {
  const persistence = await openLocalPersistence(config.LOCAL_DATABASE_PATH);
  try {
    if (!(persistence.transport instanceof LocalDatabase))
      throw new Error("Local PostgreSQL unavailable");
    const db = persistence.transport.db;
    const version = await db.query<{ version: string }>("select version()");
    const migrations = await db.query(
      "select name from sadeeman_private.migrations order by name",
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "LOCAL_DATABASE_MIGRATED",
          engine: version.rows[0]?.version,
          migrations: migrations.rows.length,
          remoteChanges: 0,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await persistence.transport.close();
  }
}
