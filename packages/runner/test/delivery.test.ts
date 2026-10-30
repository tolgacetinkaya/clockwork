import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventType, ExecutionReport, LedgerEvent } from "@clockwork/core";
import { trackDelivery } from "../src/delivery.js";

const report: ExecutionReport = { outcome: "accepted", summary: "Verified", evidence: [], findings: [] };
function gate() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fixture(options: { receipt?: Promise<void>; acknowledgment?: Promise<void> | (() => Promise<void>); onTimeout?: () => Promise<void> } = {}) {
  const committed: LedgerEvent[] = [];
  const append = vi.fn(async (type: EventType, data: Record<string, unknown>): Promise<LedgerEvent> => {
    if (type === "agent.delivery_received") await options.receipt;
    if (type === "agent.delivery_acknowledged")
      await (typeof options.acknowledgment === "function" ? options.acknowledgment() : options.acknowledgment);
    const event: LedgerEvent = { seq: committed.length + 1, type, ts: new Date().toISOString(), actor: "orchestrator", data };
    committed.push(event);
    return event;
  });
  const abort = vi.fn();
  const onTimeout = vi.fn(options.onTimeout ?? (async () => {}));
  const delivery = trackDelivery({ execution: "a12bc345-1234-4234-8234-123456789abc", timeoutMs: 100, append, onTimeout, abort });
  return { delivery, committed, append, abort, onTimeout };
}
function capture(promise: Promise<void>) {
  return promise.then(() => ({ ok: true as const }), error => ({ ok: false as const, error: error as unknown }));
}
afterEach(() => { vi.useRealTimers(); });
describe("durable delivery deadline", () => {
  it("aborts at the deadline without waiting for a blocked timeout ledger write", async () => {
    vi.useFakeTimers();
    const timeoutWrite = gate();
    const { delivery, abort, onTimeout } = fixture({ onTimeout: () => timeoutWrite.promise });
    await delivery.receive(report);
    await vi.advanceTimersByTimeAsync(100);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(() => delivery.assertReady()).toThrow(/deadline/);
    let closed = false;
    const closing = delivery.close().then(() => { closed = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toBe(false);
    timeoutWrite.resolve();
    await closing;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("counts receipt persistence time in the one report-to-ack budget", async () => {
    vi.useFakeTimers();
    const receipt = gate();
    const { delivery, abort } = fixture({ receipt: receipt.promise });
    const receiving = delivery.receive(report);
    await vi.advanceTimersByTimeAsync(70);
    receipt.resolve();
    await receiving;
    await vi.advanceTimersByTimeAsync(29);
    expect(abort).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(abort).toHaveBeenCalledTimes(1);
    await delivery.close();
  });
  it("does not grant fresh budget when receipt persistence already exceeded the deadline", async () => {
    vi.useFakeTimers();
    const receipt = gate();
    const { delivery, abort } = fixture({ receipt: receipt.promise });
    const receiving = delivery.receive(report);
    await vi.advanceTimersByTimeAsync(120);
    receipt.resolve();
    await receiving;
    expect(() => delivery.assertReady()).toThrow(/deadline/);
    await vi.advanceTimersByTimeAsync(0);
    expect(abort).toHaveBeenCalledTimes(1);
    await delivery.close();
  });
  it("cannot return normal success when durable acknowledgement crosses the deadline", async () => {
    vi.useFakeTimers();
    const acknowledgement = gate();
    const { delivery, committed, abort } = fixture({ acknowledgment: acknowledgement.promise });
    await delivery.receive(report);
    await vi.advanceTimersByTimeAsync(60);
    const result = capture(delivery.acknowledge("accepted"));
    await vi.advanceTimersByTimeAsync(40);
    expect(abort).toHaveBeenCalledTimes(1);
    acknowledgement.resolve();
    expect(await result).toMatchObject({ ok: false, error: expect.objectContaining({ message: expect.stringMatching(/deadline/) }) });
    expect(committed.at(-1)?.data?.outcome).toBe("accepted");
    await delivery.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("can durably acknowledge rejection after expiry without claiming acceptance", async () => {
    vi.useFakeTimers();
    const { delivery, committed } = fixture();
    await delivery.receive(report);
    await vi.advanceTimersByTimeAsync(100);
    expect(() => delivery.assertReady()).toThrow(/deadline/);
    await expect(delivery.acknowledge("accepted")).rejects.toThrow(/deadline/);
    await delivery.acknowledge("rejected");
    expect(committed.map(event => [event.type, event.data?.outcome])).toEqual([
      ["agent.delivery_received", "accepted"], ["agent.delivery_acknowledged", "rejected"],
    ]);
    await delivery.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels deadline alerts only after the acknowledgement is durable", async () => {
    vi.useFakeTimers();
    const acknowledgement = gate();
    const { delivery, abort, onTimeout, committed } = fixture({ acknowledgment: acknowledgement.promise });
    await delivery.receive(report);
    const acknowledged = delivery.acknowledge("accepted");
    await vi.advanceTimersByTimeAsync(70);
    expect(committed).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    acknowledgement.resolve();
    await acknowledged;
    await vi.advanceTimersByTimeAsync(500);
    expect(committed).toHaveLength(2);
    expect(abort).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await delivery.close();
  });
  it("retains a failed acknowledgement as unacknowledged and allows a durable rejected retry", async () => {
    vi.useFakeTimers();
    const acknowledgement = gate();
    let attempts = 0;
    const { delivery, committed } = fixture({ acknowledgment: () => ++attempts === 1 ? acknowledgement.promise : Promise.resolve() });
    await delivery.receive(report);
    const result = capture(delivery.acknowledge("accepted"));
    const failure = new Error("acknowledgement storage unavailable");
    acknowledgement.reject(failure);
    expect(await result).toEqual({ ok: false, error: failure });
    expect(committed).toHaveLength(1);
    await delivery.acknowledge("rejected");
    expect(committed.at(-1)?.data?.outcome).toBe("rejected");
    expect(committed).toHaveLength(2);
    await delivery.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps a late timeout receipt failure observable to close and never acknowledges it", async () => {
    vi.useFakeTimers();
    const timeoutWrite = gate();
    const { delivery, committed, abort } = fixture({ onTimeout: () => timeoutWrite.promise });
    await delivery.receive(report);
    await vi.advanceTimersByTimeAsync(100);
    const closing = capture(delivery.close());
    const failure = new Error("timeout ledger write failed");
    timeoutWrite.reject(failure);
    await vi.advanceTimersByTimeAsync(0);
    expect(await closing).toEqual({ ok: false, error: failure });
    expect(abort.mock.calls.flat()).toContain(failure);
    const rejection = await capture(delivery.acknowledge("rejected"));
    expect(rejection).toEqual({ ok: false, error: failure });
    expect(committed).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
