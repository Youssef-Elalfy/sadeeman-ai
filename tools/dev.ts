// One-command local launcher:  node tools/dev.ts [--rebuild]
// Builds contracts + API when their dist is stale, starts the API and the Next
// dev server, waits until both answer, then prints the URL to open. It spawns
// only `node` (no pnpm, no shell) and stops only the process trees it started.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const owned: ChildProcess[] = [];
let stopping = false;

function envValue(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  try {
    const line = readFileSync(resolve(root, ".env"), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    const value = line
      ?.slice(name.length + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    return value || undefined;
  } catch {
    return undefined;
  }
}

const apiPort = Number(envValue("PORT") ?? 4000);
const webPort = Number(process.env.WEB_PORT ?? 3000);
const apiHealth = `http://127.0.0.1:${apiPort}/api/v1/health`;
const webUrl = `http://127.0.0.1:${webPort}/`;

function newest(dir: string): number {
  let max = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    max = Math.max(
      max,
      entry.isDirectory() ? newest(path) : statSync(path).mtimeMs,
    );
  }
  return max;
}
function stale(pkgDir: string, marker: string): boolean {
  const out = resolve(root, pkgDir, "dist", marker);
  if (!existsSync(out)) return true;
  return newest(resolve(root, pkgDir, "src")) > statSync(out).mtimeMs;
}
function portBusy(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });
}
function pipe(child: ChildProcess, tag: string): void {
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = "";
    stream?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(`[${tag}] ${line}\n`);
    });
  }
}
function start(tag: string, args: string[], cwd: string): ChildProcess {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  owned.push(child);
  pipe(child, tag);
  return child;
}
function killTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  // Only PIDs this launcher spawned; /T also stops their own children.
  const result =
    process.platform === "win32"
      ? spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        })
      : undefined;
  if (result?.status !== 0) child.kill("SIGTERM");
}
function shutdown(code: number): never {
  if (!stopping) {
    stopping = true;
    for (const child of [...owned].reverse()) killTree(child);
  }
  process.exit(code);
}
async function runBuild(label: string, pkgDir: string): Promise<void> {
  process.stdout.write(`Building ${label}…\n`);
  const child = spawn(
    process.execPath,
    [resolve(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    { cwd: resolve(root, pkgDir), stdio: "inherit", windowsHide: true },
  );
  owned.push(child);
  const code = await new Promise<number>((done) => {
    child.once("exit", (c) => done(c ?? 1));
    child.once("error", () => done(1));
  });
  owned.splice(owned.indexOf(child), 1);
  if (code !== 0) {
    process.stderr.write(`Build failed for ${label}.\n`);
    shutdown(1);
  }
}
async function waitFor(
  url: string,
  child: ChildProcess,
  seconds: number,
  label: string,
): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    if (child.exitCode !== null) {
      process.stderr.write(
        `${label} exited before it was ready (code ${child.exitCode}). See the [${label.toLowerCase()}] lines above.\n`,
      );
      shutdown(1);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      await response.body?.cancel();
      if (response.status < 500) return;
    } catch {
      /* not up yet */
    }
    await delay(1000);
  }
  process.stderr.write(`${label} was not ready within ${seconds}s.\n`);
  shutdown(1);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

const major = Number(process.versions.node.split(".")[0]);
if (major !== 24)
  process.stderr.write(
    `Warning: Node ${process.versions.node}; this repository expects 24.x.\n`,
  );
if (!existsSync(resolve(root, "node_modules")))
  process.stderr.write(
    "Dependencies are missing. Run `pnpm install --frozen-lockfile` first.\n",
  );
for (const [name, port] of [
  ["API", apiPort],
  ["Web", webPort],
] as const)
  if (await portBusy(port)) {
    process.stderr.write(
      `${name} port ${port} is already in use (an older window still open?). Close it first; this launcher never stops processes it did not start.\n`,
    );
    process.exit(1);
  }

const force = process.argv.includes("--rebuild");
if (force || stale("packages/contracts", "index.js"))
  await runBuild("contracts", "packages/contracts");
if (force || stale("apps/api", "main.js")) await runBuild("API", "apps/api");

const api = start("api", [resolve(root, "apps/api/dist/main.js")], root);
await waitFor(apiHealth, api, 60, "API");
const web = start(
  "web",
  [
    resolve(root, "apps/web/node_modules/next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(webPort),
  ],
  resolve(root, "apps/web"),
);
await waitFor(webUrl, web, 180, "Web");

process.stdout.write(
  `\nSADEEMAN AI is ready.\n  Open:  ${webUrl}\n  API:   ${apiHealth}\nPress Ctrl+C to stop both.\n\n`,
);
for (const child of owned)
  child.once("exit", () => {
    if (stopping) return;
    process.stderr.write("A service exited; stopping the other one.\n");
    shutdown(1);
  });
await new Promise(() => {});
