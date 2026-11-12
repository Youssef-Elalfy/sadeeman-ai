import { loadEnvFile } from "node:process";
import { type Config, loadConfig } from "./config.js";
import { startupReport } from "./diagnostics.js";
import { buildServer } from "./server.js";

try {
  // Resolve from this module, not the package manager's working directory.
  // Existing process variables win over .env (Node's loadEnvFile semantics).
  try {
    loadEnvFile(new URL("../../../.env", import.meta.url));
  } catch (error) {
    if (
      !(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
    )
      throw error;
  }
  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    // loadConfig messages name fields only, never their values.
    process.stderr.write(
      `Configuration error: ${error instanceof Error ? error.message : "invalid environment"}\nCompare the root .env with .env.example.\n`,
    );
    process.exit(1);
  }
  const app = await buildServer({ config });
  // Single-container deploy: the supervisor sets API_LISTEN_HOST=127.0.0.1 so
  // only the web server is reachable from outside the container.
  const host =
    process.env.API_LISTEN_HOST === "127.0.0.1"
      ? "127.0.0.1"
      : config.NODE_ENV === "production"
        ? "0.0.0.0"
        : "127.0.0.1";
  await app.listen({
    host,
    port: config.PORT,
  });
  const report = startupReport(config);
  process.stdout.write(
    [
      `SADEEMAN AI API ready on ${host}:${config.PORT}`,
      ...report.lines,
      ...report.warnings.map((warning) => `  ! ${warning}`),
      "",
    ].join("\n"),
  );
  for (const event of ["SIGINT", "SIGTERM"] as const)
    process.once(event, () => {
      void app.close();
    });
} catch {
  process.stderr.write(
    "Unable to start API; check configured PORT, database connectivity and environment settings.\n",
  );
  process.exitCode = 1;
}
