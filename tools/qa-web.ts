// Serve real production Next assets for local QA in one owned process (Windows-safe teardown).

import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const dir = resolve("apps/web"),
  require = createRequire(resolve(dir, "package.json"));
type NextApp = {
  prepare: () => Promise<void>;
  getRequestHandler: () => (
    req: IncomingMessage,
    res: ServerResponse,
  ) => Promise<void>;
};
const next = require("next") as (options: {
  dev: boolean;
  dir: string;
}) => NextApp;
const app = next({ dev: false, dir });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/api/")) {
    await handle(req, res);
    return;
  }
  const controller = new AbortController();
  res.once("close", () => controller.abort());
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      const data = Buffer.from(chunk);
      bytes += data.length;
      if (bytes > 7500000) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(data);
    }
    const headers: Record<string, string> = {};
    for (const name of ["authorization", "content-type", "origin"]) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const body = Buffer.concat(chunks);
    const response = await fetch(`http://127.0.0.1:4100${req.url}`, {
      method: req.method ?? "GET",
      headers,
      ...(body.length ? { body } : {}),
      signal: controller.signal,
      redirect: "error",
    });
    res.statusCode = response.status;
    const mime = response.headers.get("content-type");
    if (mime) res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "no-store");
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          if (!res.write(next.value)) await once(res, "drain");
        }
      } finally {
        await reader.cancel();
      }
    }
    res.end();
  } catch {
    if (!res.headersSent)
      res.writeHead(503, { "Content-Type": "application/json" });
    res.end('{"error":"QA_API_UNAVAILABLE"}');
  }
});
server.listen(3100, "127.0.0.1");
