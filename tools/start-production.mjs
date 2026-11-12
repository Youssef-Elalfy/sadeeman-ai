// Single-container production entrypoint (one Railway service):
//   Fastify API  → 127.0.0.1:API_INTERNAL_PORT (never exposed)
//   Next.js web  → 0.0.0.0:PORT (Railway's public port); /api/* is proxied
//                  to the internal API by next.config rewrites.
// Starts the API first, waits for its health endpoint, then starts the web
// server. Forwards SIGTERM/SIGINT to both; if either exits, the other is
// stopped and the container exits non-zero so Railway restarts it.
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const apiPort = process.env.API_INTERNAL_PORT ?? "4000";
const webPort = process.env.PORT ?? "3000";
if (webPort === apiPort) {
  console.error(
    `[start] PORT (${webPort}) must differ from API_INTERNAL_PORT (${apiPort}).`,
  );
  process.exit(1);
}

const children = new Set();
let stopping = false;
function run(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;
    console.error(
      `[start] ${name} exited (${signal ?? code}); stopping the container.`,
    );
    void shutdown(1);
  });
  return child;
}
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const deadline = Date.now() + 10_000;
  while (children.size && Date.now() < deadline) await delay(100);
  for (const child of children) child.kill("SIGKILL");
  process.exit(code);
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => void shutdown(0));

run("api", ["apps/api/dist/main.js"], {
  // The API's own PORT is the internal one; Railway's PORT is for the web.
  PORT: apiPort,
  API_LISTEN_HOST: "127.0.0.1",
});

const healthUrl = `http://127.0.0.1:${apiPort}/api/v1/health`;
const startedAt = Date.now();
for (;;) {
  if (stopping) break;
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) break;
  } catch {
    // not listening yet
  }
  if (Date.now() - startedAt > 60_000) {
    console.error("[start] API did not become healthy within 60 s.");
    await shutdown(1);
  }
  await delay(250);
}

if (!stopping)
  run(
    "web",
    [
      "apps/web/node_modules/next/dist/bin/next",
      "start",
      "apps/web",
      "--hostname",
      "0.0.0.0",
      "--port",
      webPort,
    ],
    {},
  );
