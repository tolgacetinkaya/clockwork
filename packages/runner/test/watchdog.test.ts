import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionEvent } from "@clockwork/core";
import { DEFAULT_WATCHDOG_POLICY, resolveWatchdogPolicy, watchExecution, WatchdogError } from "../src/watchdog.js";

const policy = { idle_ms: 20, expected_ms: 40, hard_ms: 100, delivery_ms: 30 };
const work: ExecutionEvent = { type: "activity", kind: "command_execution", status: "started" };
const report: ExecutionEvent = { type: "report", report: { outcome: "completed", summary: "Done", findings: [], evidence: [] } };
function channel() {
  let waiting: ((value: IteratorResult<ExecutionEvent>) => void) | undefined;
  let closed = false;
  const queued: ExecutionEvent[] = [];
  let inFlight = 0;
  let peak = 0;
  const iterator: AsyncIterator<ExecutionEvent> & AsyncIterable<ExecutionEvent> = {
    [Symbol.asyncIterator]() { return this; },
    next() {
      inFlight++; peak = Math.max(peak, inFlight);
      const value = queued.shift();
      const read = value ? Promise.resolve({ done: false as const, value }) : closed ? Promise.resolve({ done: true as const, value: undefined }) : new Promise<IteratorResult<ExecutionEvent>>(resolve => { waiting = resolve; });
      return read.finally(() => { inFlight--; });
    },
    return() { close(); return Promise.resolve({ done: true, value: undefined }); },
  };
  function close() { closed = true; waiting?.({ done: true, value: undefined }); waiting = undefined; }
  return { iterator, close, peak: () => peak, push(value: ExecutionEvent) {
    if (waiting) { const resolve = waiting; waiting = undefined; resolve({ done: false, value }); }
    else queued.push(value);
  } };
}
function collect(source: AsyncIterable<ExecutionEvent>) {
  const events: ExecutionEvent[] = [];
  return { events, result: (async () => { try { for await (const event of source) events.push(event); return undefined; } catch (error) { return error; } })() };
}
afterEach(() => { vi.useRealTimers(); });
describe("execution stream watchdog", () => {
  it("resolves bounded integer policies and stable defaults", () => {
    expect(resolveWatchdogPolicy()).toEqual(DEFAULT_WATCHDOG_POLICY);
    for (const key of ["idle_ms", "expected_ms", "hard_ms", "delivery_ms"]) {
      for (const value of [0, 9, 10.5, NaN, Infinity, 3_600_001])
        expect(() => resolveWatchdogPolicy({ [key]: value })).toThrow(/integer/);
    }
    expect(() => resolveWatchdogPolicy({ expected_ms: 100, hard_ms: 100 })).toThrow(/less than hard_ms/);
    expect(resolveWatchdogPolicy({ expected_ms: 10 })).toMatchObject({ expected_ms: 10 });
  });
  it("warns once, recovers only on actual work, and keeps expected duration sticky", async () => {
    vi.useFakeTimers();
    const source = channel();
    const alerts: string[] = [];
    const running = collect(watchExecution(source.iterator, { policy, abort: source.close, onAlert: kind => { alerts.push(kind); } }));
    await vi.advanceTimersByTimeAsync(25);
    source.push({ type: "heartbeat" });
    await vi.advanceTimersByTimeAsync(5);
    source.push({ type: "activity", kind: "process_heartbeat", status: "updated" });
    await vi.advanceTimersByTimeAsync(15);
    expect(alerts).toEqual(["idle", "overdue"]);
    source.push(work);
    await vi.advanceTimersByTimeAsync(0);
    expect(alerts).toEqual(["idle", "overdue", "recovered"]);
    await vi.advanceTimersByTimeAsync(21);
    expect(alerts).toEqual(["idle", "overdue", "recovered", "idle"]);
    source.close();
    expect(await running.result).toBeUndefined();
    expect(source.peak()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts an eventless execution at the hard deadline and confirms cooperative cleanup", async () => {
    vi.useFakeTimers();
    const source = channel();
    const abort = vi.fn(source.close);
    const alerts: string[] = [];
    const running = collect(watchExecution(source.iterator, { policy, abort, onAlert: kind => { alerts.push(kind); } }));
    await vi.advanceTimersByTimeAsync(100);
    expect(await running.result).toMatchObject({ reason: "hard_timeout", unreconciled: false });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(alerts).toEqual(["idle", "overdue", "hard_timeout"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never lets repeated child heartbeats reset work or hard deadlines", async () => {
    vi.useFakeTimers();
    const source = channel();
    const alerts: string[] = [];
    const running = collect(watchExecution(source.iterator, { policy, abort: source.close, onAlert: kind => { alerts.push(kind); } }));
    for (let index = 0; index < 10; index++) {
      source.push({ type: "heartbeat" });
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(await running.result).toMatchObject({ reason: "hard_timeout", unreconciled: false });
    expect(alerts).toEqual(["idle", "overdue", "hard_timeout"]);
  });
  it("requires iterator completion after a report and enforces delivery timeout", async () => {
    vi.useFakeTimers();
    const source = channel();
    const running = collect(watchExecution(source.iterator, { policy, abort: source.close }));
    source.push(report);
    await vi.advanceTimersByTimeAsync(0);
    expect(running.events).toEqual([report]);
    await vi.advanceTimersByTimeAsync(30);
    expect(await running.result).toMatchObject({ reason: "delivery_timeout", unreconciled: false });
  });
  it("returns successful events only when their underlying iterator finishes", async () => {
    vi.useFakeTimers();
    const source = channel();
    const abort = vi.fn();
    const running = collect(watchExecution(source.iterator, { policy, abort }));
    source.push(report);
    await vi.advanceTimersByTimeAsync(0);
    source.close();
    expect(await running.result).toBeUndefined();
    expect(abort).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("handles an external pause abort immediately and clears listeners/timers", async () => {
    vi.useFakeTimers();
    const source = channel();
    const controller = new AbortController();
    const running = collect(watchExecution(source.iterator, { signal: controller.signal, policy, abort: source.close }));
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await running.result).toMatchObject({ reason: "aborted", unreconciled: false });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["immediate", "hung"])("bounds noncooperative next and %s return, even if next later rejects", async mode => {
    vi.useFakeTimers();
    let reject!: (error: Error) => void;
    const source = {
      [Symbol.asyncIterator]() { return this; },
      next: vi.fn(() => new Promise<IteratorResult<ExecutionEvent>>((_, fail) => { reject = fail; })),
      return: vi.fn(() => mode === "hung" ? new Promise<IteratorResult<ExecutionEvent>>(() => {}) : Promise.resolve({ done: true as const, value: undefined })),
    };
    const running = collect(watchExecution(source, { policy, abort: vi.fn() }));
    await vi.advanceTimersByTimeAsync(131);
    expect(await running.result).toBeInstanceOf(WatchdogError);
    expect(await running.result).toMatchObject({ reason: "hard_timeout", unreconciled: true });
    expect(source.next).toHaveBeenCalledTimes(1);
    expect(source.return).toHaveBeenCalledTimes(1);
    reject(new Error("late detached failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("caps cleanup at 1500ms instead of a long delivery policy", async () => {
    vi.useFakeTimers();
    const source = { [Symbol.asyncIterator]() { return this; }, next: () => new Promise<IteratorResult<ExecutionEvent>>(() => {}), return: () => new Promise<IteratorResult<ExecutionEvent>>(() => {}) };
    const running = collect(watchExecution(source, { policy: { ...policy, delivery_ms: 30_000 }, abort: vi.fn() }));
    await vi.advanceTimersByTimeAsync(1600);
    expect(await running.result).toMatchObject({ reason: "hard_timeout", unreconciled: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
