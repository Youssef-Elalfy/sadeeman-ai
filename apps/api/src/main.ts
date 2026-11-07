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
  await app.listen({
    host: config.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1",
    port: config.PORT,
  });
  const report = startupReport(config);
  process.stdout.write(
    [
      `SADEEMAN AI API ready: http://127.0.0.1:${config.PORT}/api/v1/health`,
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
    "Unable to start the local API. Is port 4000 already in use (an older API window still open)? Also check .env.\n",
  );
  process.exitCode = 1;
}
