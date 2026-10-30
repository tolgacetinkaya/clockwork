/**
 * Local-first HTTP server (CONCEPT.md §13, Phase 2 panel rules #2 and #3).
 * Defaults to 127.0.0.1; containers may explicitly bind 0.0.0.0. node:http only.
 * either a read-only projection of the ledger (via @clockwork/core) or the
 * single write path: POST /api/control → .teamsmith/control.json.
 */

import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { LaunchService } from "./launch.js";
import type { PanelExecution } from "./launch.js";
import { PanelStream } from "./stream.js";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import {
  loadBudget,
  loadChangelog,
  loadCommandQueue,
  loadLedger,
  submitCommand,
  writeControl,
  readControlFile,
} from "./state.js";
import type { ControlState } from "./state.js";

export interface StartPanelOptions {
  projectDir: string;
  /** Defaults to an ephemeral port (0). */
  port?: number;
  /** Opt in for container port publishing; default remains loopback-only. */
  host?: "127.0.0.1" | "0.0.0.0";
  /** Marks fixture playback, without claiming that live agents are executing. */
  demo?: boolean;
  /** Only trusted local CLI configuration may inject execution. */
  execution?: PanelExecution;
}

export interface PanelHandle {
  url: string;
  close: () => Promise<void>;
}

// Command bodies carry free-form operator text (answers, notes), so the cap
// is generous compared to the terse /api/control patch.
const MAX_BODY_BYTES = 65536;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function sendText(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseControlPatch(raw: string): Partial<ControlState> {
  let parsed: unknown;
  try {
    parsed = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    throw new Error("body is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object");
  }
  const { paused, kill } = parsed as Record<string, unknown>;
  if (paused !== undefined && typeof paused !== "boolean") {
    throw new Error("paused must be a boolean");
  }
  if (kill !== undefined && typeof kill !== "boolean") {
    throw new Error("kill must be a boolean");
  }
  return {
    ...(paused !== undefined ? { paused } : {}),
    ...(kill !== undefined ? { kill } : {}),
  };
}

function parseCommandBody(raw: string): {
  type: string;
  data: Record<string, unknown>;
} {
  let parsed: unknown;
  try {
    parsed = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    throw new Error("body is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object");
  }
  const { type, data } = parsed as Record<string, unknown>;
  if (typeof type !== "string" || type.trim() === "") {
    throw new Error("type must be a non-empty string");
  }
  if (
    data !== undefined &&
    (typeof data !== "object" || data === null || Array.isArray(data))
  ) {
    throw new Error("data must be an object");
  }
  return { type, data: (data as Record<string, unknown> | undefined) ?? {} };
}

async function handleRequest(
  projectDir: string,
  req: IncomingMessage,
  res: ServerResponse,
  stream: PanelStream,
  launch: LaunchService,
): Promise<void> {
  const method = req.method ?? "GET";
  const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("cache-control", "no-store");
  // The unauthenticated panel is local-only. Refuse DNS rebinding hosts and
  // cross-origin writes, including simple form POSTs from unrelated websites.
  const authority = req.headers.host ?? "";
  let hostname: string;
  try {
    hostname = new URL(`http://${authority}`).hostname;
  } catch {
    sendJson(res, 400, { error: "invalid host" });
    return;
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
    sendJson(res, 403, { error: "local panel host required" });
    return;
  }
  if (method === "POST" && req.headers.origin) {
    let origin: URL;
    try {
      origin = new URL(req.headers.origin);
    } catch {
      sendJson(res, 403, { error: "invalid origin" });
      return;
    }
    if (
      origin.host !== authority ||
      !["http:", "https:"].includes(origin.protocol)
    ) {
      sendJson(res, 403, { error: "same-origin writes required" });
      return;
    }
  }
  if (pathname === "/api/launch" || pathname.startsWith("/api/launch/")) {
    if (method === "GET" && pathname === "/api/launch") { sendJson(res, 200, launch.snapshot()); return; }
    if (method !== "POST") { sendJson(res, 405, { error: "POST required" }); return; }
    if (req.headers.origin && req.headers.origin !== `http://${authority}`) { sendJson(res, 403, { error: "Same-origin execution writes required" }); return; }
    const site = req.headers["sec-fetch-site"];
    if ((!req.headers.origin && site && site !== "same-origin" && site !== "none") || req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
      sendJson(res, 403, { error: "Same-origin JSON execution writes required" }); return;
    }
    try {
      const body: unknown = JSON.parse(await readBody(req));
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON object required");
      const state = await launch.request(pathname.slice("/api/launch/".length), body as Record<string, unknown>);
      await stream.refresh();
      sendJson(res, 200, state);
    } catch (error) { sendJson(res, 409, { error: error instanceof Error ? error.message : "Launch request rejected" }); }
    return;
  }
  if (method === "GET" && pathname === "/api/snapshot") {
    sendJson(res, 200, await stream.refresh());
    return;
  }
  if (method === "GET" && pathname === "/api/stream") {
    await stream.subscribe(res);
    return;
  }
  if (
    method === "GET" &&
    (pathname === "/" || pathname.startsWith("/assets/"))
  ) {
    await serveClient(pathname, res);
    return;
  }
  if (method === "GET" && pathname === "/api/state") {
    const { state } = await loadLedger(projectDir);
    sendJson(res, 200, state);
    return;
  }
  if (method === "GET" && pathname === "/api/budget") {
    const report = await loadBudget(projectDir);
    sendJson(res, 200, report);
    return;
  }
  if (method === "GET" && pathname === "/api/changelog") {
    const md = await loadChangelog(projectDir);
    sendText(res, 200, "text/markdown; charset=utf-8", md);
    return;
  }
  if (method === "GET" && pathname === "/api/control") {
    sendJson(res, 200, await readControlFile(projectDir));
    return;
  }
  if (method === "POST" && pathname === "/api/control") {
    let patch: Partial<ControlState>;
    try {
      patch = parseControlPatch(await readBody(req));
    } catch (err) {
      sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const next = await writeControl(projectDir, patch);
    void stream.refresh().catch(() => {});
    sendJson(res, 200, next);
    return;
  }
  if (method === "GET" && pathname === "/api/commands") {
    const status = await loadCommandQueue(projectDir);
    sendJson(res, 200, status);
    return;
  }
  if (method === "POST" && pathname === "/api/commands") {
    let body: { type: string; data: Record<string, unknown> };
    try {
      body = parseCommandBody(await readBody(req));
    } catch (err) {
      sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    try {
      const command = await submitCommand(projectDir, body.type, body.data);
      void stream.refresh().catch(() => {});
      sendJson(res, 200, command);
    } catch (err) {
      sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  sendJson(res, 404, { error: `not found: ${method} ${pathname}` });
}

const CLIENT_ROOT = fileURLToPath(new URL("../dist", import.meta.url));
const MIME: Record<string, string> = {
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};
async function serveClient(
  pathname: string,
  res: ServerResponse,
): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(res, 400, { error: "invalid asset path" });
    return;
  }
  const target = resolve(
    CLIENT_ROOT,
    pathname === "/" ? "index.html" : `.${decoded}`,
  );
  if (
    !target.startsWith(`${resolve(CLIENT_ROOT)}${sep}`) ||
    !MIME[extname(target)]
  ) {
    sendJson(res, 404, { error: "asset not found" });
    return;
  }
  try {
    const [physicalRoot, physicalTarget] = await Promise.all([
      realpath(CLIENT_ROOT),
      realpath(target),
    ]);
    if (!physicalTarget.startsWith(`${physicalRoot}${sep}`)) {
      sendJson(res, 404, { error: "asset not found" });
      return;
    }
    const body = await readFile(physicalTarget);
    res.writeHead(200, {
      "content-type": MIME[extname(target)]!,
      "content-length": body.length,
      "content-security-policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "cache-control":
        pathname === "/" || extname(target) === ".txt"
          ? "no-cache"
          : "public, max-age=31536000, immutable",
    });
    res.end(body);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (pathname === "/")
      sendText(
        res,
        503,
        "text/plain; charset=utf-8",
        "Clockwork panel assets are missing. Run npm run build in the Clockwork checkout.",
      );
    else sendJson(res, 404, { error: "asset not found" });
  }
}

export async function startPanel(
  options: StartPanelOptions,
): Promise<PanelHandle> {
  const { projectDir, port = 0, host = "127.0.0.1" } = options;
  if (host !== "127.0.0.1" && host !== "0.0.0.0")
    throw new Error("unsupported panel bind address");

  const execution = options.demo || host !== "127.0.0.1" ? undefined : options.execution;
  const launch = new LaunchService(projectDir, execution, execution ? undefined : options.demo ? "Recorded demo cannot launch agents" : host !== "127.0.0.1" ? "Execution requires a loopback-only server" : "Start the local CLI with --enable-execution to launch agents", () => { void stream.refresh().catch(() => {}); });
  await launch.restore();
  const stream = new PanelStream(projectDir, options.demo, () => launch.snapshot());
  const server: Server = createServer((req, res) => {
    handleRequest(projectDir, req, res, stream, launch).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("panel server failed to bind to a TCP port");
  }

  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closing ??= (async () => {
      await launch.close();
      return new Promise<void>((resolve, reject) => {
        stream.close();
        server.close((err) => (err ? reject(err) : resolve()));
      });
    })(),
  };
}
