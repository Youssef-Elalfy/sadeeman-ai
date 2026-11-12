// Local end-to-end test service: real SQL/auth/HTTP, no live providers or customer data.
import { loadConfig } from "../apps/api/dist/config.js";
import { createLocalDatabase } from "../apps/api/dist/persistence/local.js";
import { buildServer } from "../apps/api/dist/server.js";

const db = await createLocalDatabase();
const config = loadConfig({
  NODE_ENV: "test",
  PORT: "4100",
  WEB_ORIGIN: "http://127.0.0.1:3100",
  PERSISTENCE_MODE: "local",
  ENABLE_REAL_PROVIDER: "false",
  ENABLE_TRAVEL_CONTEXT: "true",
  ENABLE_TRAVEL_CONTEXT_PERSISTENCE: "true",
  RATE_LIMIT_MAX: "600",
  GUEST_RATE_LIMIT_MAX: "300",
  MAX_GUESTS_PER_HOUR: "300",
});
const app = await buildServer({
  config,
  persistence: { mode: "local", auth: db, transport: db },
});
app.get("/__qa/ready", async () => ({
  runId: process.env.SADEEMAN_QA_RUN_ID ?? null,
  providersEnabled: false,
}));
app.get("/api/__qa/ready", async () => ({
  runId: process.env.SADEEMAN_QA_RUN_ID ?? null,
  providersEnabled: false,
}));
await app.listen({ host: "127.0.0.1", port: 4100 });
process.stdout.write("SADEEMAN isolated QA API ready; providers disabled.\n");
for (const event of ["SIGTERM", "SIGINT"] as const)
  process.once(event, () => {
    void app.close();
  });
