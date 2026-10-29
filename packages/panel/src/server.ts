/**
 * Local-first HTTP server (CONCEPT.md §13, Phase 2 panel rules #2 and #3).
 * Defaults to 127.0.0.1; containers may explicitly bind 0.0.0.0. node:http only.
 * either a read-only projection of the ledger (via @clockwork/core) or the
 * single write path: POST /api/control → .teamsmith/control.json.
 */

import { createServer } from "node:http";
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
import { renderPage } from "./page.js";

export interface StartPanelOptions {
  projectDir: string;
  /** Defaults to an ephemeral port (0). */
  port?: number;
  /** Opt in for container port publishing; default remains loopback-only. */
  host?: "127.0.0.1" | "0.0.0.0";
}

export interface PanelHandle {
  url: string;
  close: () => Promise<void>;
}

// Command bodies carry free-form operator text (answers, notes), so the cap
// is generous compared to the terse /api/control patch.
const MAX_BODY_BYTES = 8192;

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

function sendText(res: ServerResponse, status: number, contentType: string, body: string): void {
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
  if (typeof parsed !== "object" || parsed === null) {
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

function parseCommandBody(raw: string): { type: string; data: Record<string, unknown> } {
  let parsed: unknown;
  try {
    parsed = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    throw new Error("body is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("body must be a JSON object");
  }
  const { type, data } = parsed as Record<string, unknown>;
  if (typeof type !== "string" || type.trim() === "") {
    throw new Error("type must be a non-empty string");
  }
  if (data !== undefined && (typeof data !== "object" || data === null || Array.isArray(data))) {
    throw new Error("data must be an object");
  }
  return { type, data: (data as Record<string, unknown> | undefined) ?? {} };
}

async function handleRequest(
  projectDir: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? "GET";
  const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

  if (method === "GET" && pathname === "/") {
    sendText(res, 200, "text/html; charset=utf-8", renderPage());
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
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const next = await writeControl(projectDir, patch);
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
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    try {
      const command = await submitCommand(projectDir, body.type, body.data);
      sendJson(res, 200, command);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  sendJson(res, 404, { error: `not found: ${method} ${pathname}` });
}

export async function startPanel(options: StartPanelOptions): Promise<PanelHandle> {
  const { projectDir, port = 0, host = "127.0.0.1" } = options;
  if (host !== "127.0.0.1" && host !== "0.0.0.0") throw new Error("unsupported panel bind address");

  const server: Server = createServer((req, res) => {
    handleRequest(projectDir, req, res).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
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

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
