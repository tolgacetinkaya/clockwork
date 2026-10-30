import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExecutionAdapter,
  ExecutionEvent,
  ExecutionReport,
  ExecutionRequest,
} from "@clockwork/core";

export const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "summary", "evidence", "findings"],
  properties: {
    outcome: {
      type: "string",
      enum: ["completed", "accepted", "rework", "blocked"],
    },
    summary: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "command", "result", "passed"],
        properties: {
          criterion: { type: "string" },
          command: { type: "string" },
          result: { type: "string" },
          passed: { type: "boolean" },
        },
      },
    },
    findings: { type: "array", items: { type: "string" } },
  },
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseReport(text: string): ExecutionReport {
  let r: unknown;
  try {
    r = JSON.parse(text);
  } catch {
    throw new Error("Codex returned invalid report JSON");
  }
  if (
    !record(r) ||
    !["completed", "accepted", "rework", "blocked"].includes(
      String(r.outcome),
    ) ||
    typeof r.summary !== "string" ||
    !r.summary.trim() ||
    !Array.isArray(r.findings) ||
    r.findings.some((f) => typeof f !== "string") ||
    !Array.isArray(r.evidence) ||
    r.evidence.some(
      (e) =>
        !record(e) ||
        typeof e.criterion !== "string" ||
        !e.criterion.trim() ||
        typeof e.command !== "string" ||
        !e.command.trim() ||
        typeof e.result !== "string" ||
        !e.result.trim() ||
        typeof e.passed !== "boolean",
    )
  )
    throw new Error("Codex returned an invalid execution report");
  return r as unknown as ExecutionReport;
}
export function buildExecArgs(
  request: ExecutionRequest,
  schema: string,
  windowsSandbox?: "elevated" | "unelevated" | "mxc",
): string[] {
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--color",
    "never",
    "--sandbox",
    request.mode === "verify" ? "read-only" : "workspace-write",
    "-c",
    'approval_policy="never"',
    "-c",
    "mcp_servers={}",
    "-c",
    "features.multi_agent=false",
    ...(windowsSandbox ? ["-c", `windows.sandbox="${windowsSandbox}"`] : []),
    "--output-schema",
    schema,
    "--cd",
    request.workspace,
    ...(request.model ? ["--model", request.model] : []),
    "-",
  ];
}
/** Strict framing, bounded lines; raw tool text/stderr never enters the ledger. */
export class CodexDecoder {
  private buffer = "";
  private completed = false;
  private thread = false;
  private report: ExecutionReport | undefined;
  private commandIds = new Set<string>();
  private pendingCommands = new Map<string, string>();
  feed(chunk: string): ExecutionEvent[] {
    this.buffer += chunk;
    const events: ExecutionEvent[] = [];
    let end: number;
    while ((end = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (line.length > 1_048_576)
        throw new Error("Codex event exceeds the size limit");
      if (!line) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        throw new Error("Malformed Codex JSONL event");
      }
      if (!record(raw) || typeof raw.type !== "string")
        throw new Error("Invalid Codex event envelope");
      if (this.completed)
        throw new Error("Codex emitted data after turn completion");
      switch (raw.type) {
        case "thread.started":
          if (
            this.thread ||
            typeof raw.thread_id !== "string" ||
            !raw.thread_id
          )
            throw new Error("Invalid Codex thread");
          this.thread = true;
          events.push({ type: "thread", id: raw.thread_id });
          break;
        case "item.started":
        case "item.updated":
        case "item.completed": {
          if (!record(raw.item) || typeof raw.item.type !== "string")
            throw new Error("Invalid Codex item");
          if (raw.item.type === "command_execution") {
            const { id, command, exit_code: exitCode, status } = raw.item;
            if (
              typeof id !== "string" ||
              !id.trim() ||
              id !== id.trim() ||
              id.length > 256 ||
              /[\u0000-\u001f\u007f]/.test(id) ||
              this.commandIds.has(id) ||
              typeof command !== "string" ||
              !command.trim() ||
              command.length > 65_536 ||
              command.includes("\0") ||
              (this.pendingCommands.has(id) && this.pendingCommands.get(id) !== command) ||
              (raw.type === "item.started" && this.pendingCommands.has(id))
            )
              throw new Error("Invalid or duplicate Codex completed command");
            if (raw.type === "item.completed") {
              if (
                typeof exitCode !== "number" ||
                !Number.isSafeInteger(exitCode) ||
                (status !== "completed" && status !== "failed")
              )
                throw new Error("Invalid or duplicate Codex completed command");
              this.commandIds.add(id);
              this.pendingCommands.delete(id);
              // Only transport-observed completion metadata is trusted. Tool output
              // stays in the local CLI session and is never copied into the event.
              events.push({ type: "command", id, command, exitCode, status });
            } else {
              this.pendingCommands.set(id, command);
            }
          }
          if (
            raw.type === "item.completed" &&
            raw.item.type === "agent_message"
          ) {
            if (typeof raw.item.text !== "string")
              throw new Error("Missing Codex final message");
            // The final schema-conforming message replaces intermediate commentary.
            try {
              this.report = parseReport(raw.item.text);
            } catch {
              this.report = undefined;
            }
          }
          events.push({
            type: "activity",
            kind: raw.item.type.slice(0, 80),
            status: raw.type.slice(5),
          });
          break;
        }
        case "turn.completed": {
          const u = raw.usage;
          if (
            !record(u) ||
            [u.input_tokens, u.cached_input_tokens, u.output_tokens].some(
              (n) => typeof n !== "number" || !Number.isSafeInteger(n) || n < 0,
            ) ||
            Number(u.cached_input_tokens) > Number(u.input_tokens) ||
            !Number.isSafeInteger(
              Number(u.input_tokens) + Number(u.output_tokens),
            )
          )
            throw new Error("Invalid Codex usage");
          this.completed = true;
          events.push({
            type: "usage",
            input: Number(u.input_tokens),
            cached: Number(u.cached_input_tokens),
            output: Number(u.output_tokens),
          });
          break;
        }
        case "turn.failed":
        case "error":
          throw new Error(
            "Codex execution failed; inspect the local CLI session",
          );
        // Unknown future metadata is ignored; known completion fields remain mandatory.
      }
    }
    if (this.buffer.length > 1_048_576)
      throw new Error("Codex event exceeds the size limit");
    return events;
  }
  finish(): ExecutionReport {
    if (this.buffer.trim() || !this.thread || !this.completed || !this.report || this.pendingCommands.size)
      throw new Error(
        "Incomplete Codex execution stream or missing structured report",
      );
    return this.report;
  }
}
export interface CodexOptions {
  executable?: string;
  timeoutMs?: number;
  /** Transport liveness only; never evidence of work progress. */
  heartbeatMs?: number;
  windowsSandbox?: "elevated" | "unelevated" | "mxc";
}
export class CodexAdapter implements ExecutionAdapter {
  readonly id = "codex";
  constructor(private readonly options: CodexOptions = {}) {}
  async *execute(request: ExecutionRequest): AsyncGenerator<ExecutionEvent> {
    request.signal.throwIfAborted();
    const heartbeatMs = this.options.heartbeatMs ?? 5000;
    if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 10)
      throw new Error("Codex heartbeat interval must be an integer of at least 10ms");
    const temp = await mkdtemp(join(tmpdir(), "clockwork-codex-"));
    let child: ReturnType<typeof spawn> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let closed: Promise<void> | undefined;
    const controller = new AbortController();
    const abort = () =>
      controller.abort(new Error("Codex execution interrupted"));
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    try {
      const schema = join(temp, "report.schema.json");
      await writeFile(schema, JSON.stringify(REPORT_SCHEMA), { flag: "wx" });
      const environment = { ...process.env };
      // Local saved CLI auth only. Never forward API-key credentials to a worker.
      delete environment.OPENAI_API_KEY;
      delete environment.CODEX_API_KEY;
      delete environment.CLOCKWORK_PROJECT_ROOT;
      delete environment.TEAMSMITH_PROJECT_ROOT;
      child = spawn(
        this.options.executable ??
          (process.platform === "win32" ? "codex.exe" : "codex"),
        buildExecArgs(request, schema, this.options.windowsSandbox),
        {
          cwd: request.workspace,
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: environment,
        },
      );
      const processHandle = child;
      let processClosed = false;
      closed = new Promise<void>(resolve => processHandle.once("close", () => {
        processClosed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        resolve();
      }));
      let pulse!: () => void;
      const heartbeat = () => new Promise<void>(resolve => { pulse = resolve; });
      let heartbeatReady = heartbeat();
      heartbeatTimer = setInterval(() => {
        if (!processClosed) pulse();
      }, heartbeatMs);
      heartbeatTimer.unref();
      const exited = new Promise<{ code: number | null; error?: Error }>(
        (resolve) => {
          processHandle.once("error", () =>
            resolve({
              code: null,
              error: new Error(
                "Cannot start Codex CLI; check its installation and executable path",
              ),
            }),
          );
          processHandle.once("close", (code) => resolve({ code }));
        },
      );
      const stop = () => {
        processHandle.kill("SIGTERM");
        killTimer = setTimeout(() => processHandle.kill("SIGKILL"), 1500);
        killTimer.unref();
      };
      controller.signal.addEventListener("abort", stop, { once: true });
      if (controller.signal.aborted) stop();
      timer = setTimeout(abort, this.options.timeoutMs ?? 15 * 60_000);
      timer.unref();
      // Drain without retaining unbounded or possibly sensitive model stderr.
      processHandle.stderr?.resume();
      processHandle.stdout?.setEncoding("utf8");
      processHandle.stdin?.on("error", () => {});
      processHandle.stdin?.end(request.prompt);
      const decoder = new CodexDecoder();
      const stdout = processHandle.stdout![Symbol.asyncIterator]();
      // Retain exactly one outstanding read while the actual child timer supplies
      // liveness events. Partial or malformed JSONL is never activity.
      let next = stdout.next();
      while (true) {
        const received = await Promise.race([
          next.then(value => ({ type: "chunk" as const, value })),
          heartbeatReady.then(() => ({ type: "heartbeat" as const })),
        ]);
        controller.signal.throwIfAborted();
        if (received.type === "heartbeat") {
          heartbeatReady = heartbeat();
          if (!processClosed) yield { type: "heartbeat" };
          continue;
        }
        if (received.value.done) break;
        for (const event of decoder.feed(String(received.value.value))) yield event;
        next = stdout.next();
      }
      let exit: Awaited<typeof exited>;
      while (true) {
        const received = await Promise.race([
          exited.then(value => ({ type: "exit" as const, value })),
          heartbeatReady.then(() => ({ type: "heartbeat" as const })),
        ]);
        controller.signal.throwIfAborted();
        if (received.type === "exit") { exit = received.value; break; }
        heartbeatReady = heartbeat();
        if (!processClosed) yield { type: "heartbeat" };
      }
      controller.signal.throwIfAborted();
      if (exit.error) throw exit.error;
      if (exit.code !== 0)
        throw new Error(
          `Codex CLI exited unsuccessfully (${exit.code ?? "signal"})`,
        );
      yield { type: "report", report: decoder.finish() };
    } finally {
      if (timer) clearTimeout(timer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (killTimer) clearTimeout(killTimer);
      request.signal.removeEventListener("abort", abort);
      if (child && child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      // Do not settle the adapter until the child is actually closed. The runner
      // watchdog bounds this wait and marks unconfirmed termination unreconciled.
      await closed;
      await rm(temp, { recursive: true, force: true });
    }
  }
}
