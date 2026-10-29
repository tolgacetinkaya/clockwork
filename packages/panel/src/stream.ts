import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { readPanelData } from "./snapshot.js";
import type { LaunchState, PanelSnapshot } from "./protocol.js";

/** One shared projection pump per server, regardless of the number of tabs/screens. */
export class PanelStream {
  private readonly streamId = randomUUID();
  private revision = 0;
  private fingerprint = "";
  private current: PanelSnapshot | null = null;
  private pending: Promise<PanelSnapshot> | null = null;
  private clients = new Set<ServerResponse>();
  private sentRevisions = new WeakMap<ServerResponse, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private heartbeats: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private failed = false;
  private watcher: FSWatcher | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly projectDir: string,
    private readonly demo = false,
    private readonly launch?: () => LaunchState,
  ) {}

  refresh(): Promise<PanelSnapshot> {
    if (this.pending) return this.pending;
    this.pending = this.read()
      .catch((error) => {
        this.failed = true;
        for (const client of this.clients) {
          if (!client.destroyed && !client.writableNeedDrain)
            client.write(
              'event: stream-error\ndata: {"message":"Cannot read project state; retrying."}\n\n',
            );
        }
        throw error;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  private async read(): Promise<PanelSnapshot> {
    const data = await readPanelData(this.projectDir, this.demo);
    if (this.launch) data.launch = this.launch();
    const fingerprint = JSON.stringify(data);
    if (fingerprint !== this.fingerprint || !this.current || this.failed) {
      this.fingerprint = fingerprint;
      this.failed = false;
      this.current = {
        ...data,
        streamId: this.streamId,
        revision: ++this.revision,
        updatedAt: new Date().toISOString(),
      };
      for (const client of this.clients) this.sendSnapshot(client);
    }
    return this.current;
  }

  private sendSnapshot(client: ServerResponse): void {
    if (!this.current || client.destroyed || this.closed) return;
    if ((this.sentRevisions.get(client) ?? 0) >= this.current.revision) return;
    // A slow tab must reconnect and resync, rather than grow an unbounded buffer.
    if (client.writableLength > 256 * 1024) {
      client.destroy();
      return;
    }
    if (client.writableNeedDrain) return;
    client.write(
      `id: ${this.streamId}:${this.current.revision}\nevent: snapshot\ndata: ${JSON.stringify(this.current)}\n\n`,
    );
    this.sentRevisions.set(client, this.current.revision);
  }

  async subscribe(res: ServerResponse): Promise<void> {
    await this.refresh();
    if (this.closed || res.destroyed) {
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 1500\n\n");
    this.clients.add(res);
    // Always send an authoritative full snapshot. This intentionally resyncs
    // Last-Event-ID across gaps, truncation, and server restarts without replaying mutations.
    this.sendSnapshot(res);
    res.on("drain", () => this.sendSnapshot(res));
    res.once("close", () => {
      this.clients.delete(res);
      if (!this.clients.size) this.stopTimers();
    });
    if (!this.timer) {
      try {
        this.watcher = watch(
          join(this.projectDir, ".teamsmith"),
          (_event, name) => {
            if (
              !name ||
              !/^(ledger\.jsonl|control\.json|commands\.jsonl|commands\.cursor|spec\.v\d+\.yaml)$/.test(
                String(name),
              )
            )
              return;
            if (this.debounce) clearTimeout(this.debounce);
            this.debounce = setTimeout(() => {
              void this.refresh().catch(() => {});
            }, 35);
          },
        );
        this.watcher.on("error", () => {
          this.watcher?.close();
          this.watcher = null;
        });
      } catch {
        /* The reconciliation timer also covers unavailable file watches. */
      }
      this.timer = setInterval(() => {
        void this.refresh().catch(() => {});
      }, 1000);
      this.timer.unref();
      this.heartbeats = setInterval(() => {
        for (const client of this.clients) {
          if (client.writableLength > 256 * 1024) client.destroy();
          else if (!client.writableNeedDrain)
            client.write(
              `event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`,
            );
        }
      }, 10_000);
      this.heartbeats.unref();
    }
  }

  private stopTimers(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeats) clearInterval(this.heartbeats);
    this.timer = null;
    this.heartbeats = null;
  }

  close(): void {
    this.closed = true;
    this.stopTimers();
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
