import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd(),
  runId = randomUUID();
const owned: ChildProcess[] = [];
const launch = (
  args: string[],
  cwd: string,
  extra: NodeJS.ProcessEnv = {},
  inherit = false,
) => {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...extra },
    windowsHide: true,
    stdio: inherit ? "inherit" : "ignore",
  });
  owned.push(child);
  return child;
};
async function waitFor(url: string, expectedRun?: string) {
  for (let i = 0; i < 60; i++) {
    if (owned.some((c) => c.exitCode !== null))
      throw Error("QA service exited before readiness");
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        if (!expectedRun) {
          await r.body?.cancel();
          return;
        }
        const value = (await r.json()) as { runId?: string };
        if (value.runId === expectedRun) return;
        throw Error("QA ownership marker mismatch");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "QA ownership marker mismatch"
      )
        throw error;
    }
    await delay(1000);
  }
  throw Error("Bounded QA readiness deadline");
}
try {
  launch([resolve(root, "tools/qa-api.ts")], root, {
    SADEEMAN_QA_RUN_ID: runId,
  });
  await waitFor("http://127.0.0.1:4100/__qa/ready", runId);
  launch([resolve(root, "tools/qa-web.ts")], root, {
    NEXT_TELEMETRY_DISABLED: "1",
  });
  await waitFor("http://127.0.0.1:3100/api/__qa/ready", runId);
  const cli = createRequire(resolve(root, "package.json")).resolve(
    "@playwright/test/cli",
  );
  const tests = launch(
    [cli, "test", ...process.argv.slice(2)],
    root,
    { QA_EXTERNAL: "true" },
    true,
  );
  process.exitCode = await new Promise<number>((done) => {
    tests.once("exit", (code) => done(code ?? 1));
    tests.once("error", () => done(1));
  });
} catch {
  process.stderr.write(
    "Local QA infrastructure failed its bounded readiness/ownership check. No remote services were used.\n",
  );
  process.exitCode = 1;
} finally {
  // Only PIDs returned by this process's own spawn calls are eligible for cleanup.
  for (const child of owned.reverse())
    if (child.pid && child.exitCode === null) {
      child.kill("SIGKILL");
      child.unref();
    }
}
