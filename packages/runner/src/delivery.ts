import type { EventType, ExecutionReport, LedgerEvent } from "@clockwork/core";

interface DeliveryOptions {
  execution: string;
  timeoutMs: number;
  append: (type: EventType, data: Record<string, unknown>) => Promise<LedgerEvent>;
  onTimeout: () => Promise<void>;
  abort: (reason?: unknown) => void;
}
/** A receipt acknowledges durable processing, never semantic acceptance. */
export function trackDelivery(options: DeliveryOptions) {
  let receivedSeq: number | undefined;
  let receivedAt: number | undefined;
  let acknowledged = false;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  return {
    async receive(report: ExecutionReport): Promise<void> {
      if (receivedSeq !== undefined) throw new Error("Repeated delivery report");
      receivedAt = Date.now();
      const event = await options.append("agent.delivery_received", { execution: options.execution, delivery_id: options.execution, outcome: report.outcome });
      receivedSeq = event.seq;
      timer = setTimeout(() => {
        timedOut = true;
        options.abort(new Error("Delivery acknowledgment deadline exceeded"));
        pending = options.onTimeout();
        void pending.catch(error => { options.abort(error); });
      }, Math.max(0, options.timeoutMs - (Date.now() - receivedAt)));
      timer.unref();
    },
    assertReady(): void {
      if (receivedSeq !== undefined && (timedOut || Date.now() - receivedAt! >= options.timeoutMs)) throw new Error("Delivery acknowledgment deadline exceeded");
    },
    async acknowledge(outcome: ExecutionReport["outcome"] | "rejected"): Promise<void> {
      if (receivedSeq === undefined || acknowledged) return;
      if (outcome !== "rejected") this.assertReady();
      await pending;
      if (outcome !== "rejected") this.assertReady();
      await options.append("agent.delivery_acknowledged", { execution: options.execution, delivery_id: options.execution, received_seq: receivedSeq, outcome });
      acknowledged = true;
      if (timer) clearTimeout(timer);
      if (outcome !== "rejected") this.assertReady();
    },
    async close(): Promise<void> {
      if (timer) clearTimeout(timer);
      await pending;
    },
  };
}
