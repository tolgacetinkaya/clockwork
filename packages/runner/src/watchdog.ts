import type { ExecutionEvent } from "@clockwork/core";

export interface WatchdogPolicy {
  idle_ms: number;
  expected_ms?: number;
  hard_ms: number;
  delivery_ms: number;
}
export const DEFAULT_WATCHDOG_POLICY: Readonly<WatchdogPolicy> = Object.freeze({
  idle_ms: 120_000, hard_ms: 900_000, delivery_ms: 30_000,
});
export function resolveWatchdogPolicy(options: Partial<WatchdogPolicy> = {}): WatchdogPolicy {
  const policy = { ...DEFAULT_WATCHDOG_POLICY, ...options };
  for (const key of ["idle_ms", "expected_ms", "hard_ms", "delivery_ms"] as const) {
    const value = policy[key];
    if (key === "expected_ms" && value === undefined) continue;
    if (!Number.isSafeInteger(value) || value! < 10 || value! > 3_600_000)
      throw new Error(`Watchdog ${key} must be an integer from 10 to 3600000`);
  }
  if (policy.expected_ms !== undefined && policy.expected_ms >= policy.hard_ms)
    throw new Error("Watchdog expected_ms must be less than hard_ms");
  return policy;
}
export type WatchdogAlert = "idle" | "overdue" | "hard_timeout" | "delivery_timeout" | "recovered";
export type WatchdogReason = "hard_timeout" | "delivery_timeout" | "aborted" | "cleanup_timeout";
export interface WatchdogObservation { elapsed_ms: number; idle_ms: number }
export class WatchdogError extends Error {
  constructor(readonly reason: WatchdogReason, readonly unreconciled: boolean) {
    super(`Execution watchdog ${reason}${reason === "aborted" ? " (interrupted)" : ""}${unreconciled ? "; worker termination is unconfirmed" : ""}`);
    this.name = "WatchdogError";
  }
}
export interface WatchdogOptions {
  signal?: AbortSignal;
  abort: (reason?: unknown) => void;
  policy?: Partial<WatchdogPolicy>;
  onAlert?: (kind: WatchdogAlert, observation: WatchdogObservation) => void | Promise<void>;
  now?: () => number;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
/** Heartbeats prove transport liveness only. A report is provisional until iterator completion. */
export async function* watchExecution(source: AsyncIterable<ExecutionEvent>, options: WatchdogOptions): AsyncGenerator<ExecutionEvent> {
  const policy = resolveWatchdogPolicy(options.policy);
  const now = options.now ?? Date.now;
  const started = now();
  let lastWork = started;
  let reportAt: number | undefined;
  let idle = false;
  let overdue = false;
  let completed = false;
  let terminal: WatchdogReason | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let changed = deferred();
  const alerts: Array<[WatchdogAlert, WatchdogObservation]> = [];
  const iterator = source[Symbol.asyncIterator]();
  type Step = { ok: true; result: IteratorResult<ExecutionEvent> } | { ok: false; error: unknown };
  let pending: Promise<Step> | undefined;
  const alert = (kind: WatchdogAlert) => {
    alerts.push([kind, { elapsed_ms: Math.max(0, now() - started), idle_ms: Math.max(0, now() - lastWork) }]);
    changed.resolve();
  };
  const interrupt = (reason: WatchdogReason) => {
    if (terminal) return;
    terminal = reason;
    try { options.abort(new WatchdogError(reason, false)); } finally { changed.resolve(); }
  };
  const observe = () => {
    if (timer) clearTimeout(timer);
    if (terminal) return;
    const time = now();
    if (time - started >= policy.hard_ms) {
      alert("hard_timeout"); interrupt("hard_timeout"); return;
    }
    if (reportAt !== undefined && time - reportAt >= policy.delivery_ms) {
      alert("delivery_timeout"); interrupt("delivery_timeout"); return;
    }
    if (!idle && time - lastWork >= policy.idle_ms) { idle = true; alert("idle"); }
    if (!overdue && policy.expected_ms !== undefined && time - started >= policy.expected_ms) {
      overdue = true; alert("overdue");
    }
    const deadlines = [started + policy.hard_ms];
    if (!idle) deadlines.push(lastWork + policy.idle_ms);
    if (!overdue && policy.expected_ms !== undefined) deadlines.push(started + policy.expected_ms);
    if (reportAt !== undefined) deadlines.push(reportAt + policy.delivery_ms);
    timer = setTimeout(observe, Math.max(1, Math.min(...deadlines) - now()));
  };
  const externalAbort = () => interrupt("aborted");
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  try {
    if (options.signal?.aborted) externalAbort();
    observe();
    while (true) {
      while (alerts.length) {
        const [kind, observation] = alerts.shift()!;
        await options.onAlert?.(kind, observation);
      }
      if (terminal) throw new WatchdogError(terminal, false);
      if (!pending) pending = Promise.resolve().then(() => iterator.next()).then(
        result => ({ ok: true as const, result }), error => ({ ok: false as const, error }),
      );
      const wake = changed.promise;
      const step = await Promise.race([pending, wake.then(() => undefined)]);
      changed = deferred();
      if (terminal) continue;
      if (!step) continue;
      pending = undefined;
      if (!step.ok) throw step.error;
      if (step.result.done) { completed = true; return; }
      const event = step.result.value;
      if ((event.type === "activity" && event.kind !== "process_heartbeat") || event.type === "command") {
        lastWork = now();
        if (idle) { idle = false; alert("recovered"); }
      }
      if (event.type === "report" && reportAt === undefined) reportAt = now();
      observe();
      // A deadline can expire while processing an event; never deliver it as success.
      if (terminal) continue;
      yield event;
    }
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
    if (!completed) {
      if (!terminal) options.abort(new WatchdogError("aborted", false));
      // Both the outstanding read and iterator closure must settle. return() alone
      // can lie about closure while a detached next() is still running.
      const outstanding = pending ?? Promise.resolve(undefined);
      const closing = Promise.resolve().then(() => iterator.return?.()).then(
        value => value?.done === true, () => false,
      );
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      const reconciled = await Promise.race([
        Promise.all([outstanding, closing]).then(([step, closed]) => closed || (step?.ok === true && step.result.done === true)),
        new Promise<boolean>(resolve => { cleanupTimer = setTimeout(() => resolve(false), Math.min(policy.delivery_ms, 1500)); }),
      ]);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      if (!reconciled) throw new WatchdogError(terminal ?? "cleanup_timeout", true);
    }
  }
}
