import { useEffect } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PanelSnapshot } from "../src/protocol.js";
import { newerSnapshot, parseSnapshot, SNAPSHOT_KEY } from "./transport.js";
import { usePanelUI } from "./state.js";

/** Mounted once at the application boundary, never once per screen. */
export function useLivePanel(): void {
  const cache = useQueryClient();
  useEffect(() => {
    let source: EventSource | null = null;
    let disposed = false;
    let healthy = false;
    const connect = () => {
      source?.close();
      healthy = false;
      if (disposed) return;
      usePanelUI.getState().setConnection("connecting");
      const currentSource = new EventSource("/api/stream");
      source = currentSource;
      source.addEventListener("snapshot", (event) => {
        if (disposed || source !== currentSource) return;
        try {
          const snapshot = parseSnapshot((event as MessageEvent<string>).data);
          cache.setQueryData<PanelSnapshot>(SNAPSHOT_KEY, (previous) =>
            newerSnapshot(previous, snapshot),
          );
          healthy = true;
          usePanelUI.getState().heartbeat();
        } catch {
          healthy = false;
          usePanelUI.getState().setConnection("stale");
        }
      });
      source.addEventListener("heartbeat", () => {
        if (!disposed && source === currentSource) {
          if (healthy) usePanelUI.getState().heartbeat();
          else usePanelUI.setState({ lastHeartbeat: Date.now() });
        }
      });
      source.addEventListener("stream-error", () => {
        if (!disposed && source === currentSource) {
          healthy = false;
          usePanelUI.getState().setConnection("stale");
        }
      });
      source.onerror = () => {
        if (!disposed && source === currentSource) {
          healthy = false;
          usePanelUI.getState().setConnection("reconnecting");
        }
      };
    };
    const offline = () => usePanelUI.getState().setConnection("reconnecting");
    connect();
    const timer = setInterval(() => {
      const { lastHeartbeat, connection } = usePanelUI.getState();
      if (connection === "live" && Date.now() - lastHeartbeat > 25_000) {
        usePanelUI.getState().setConnection("stale");
        connect();
      }
    }, 5000);
    window.addEventListener("online", connect);
    window.addEventListener("offline", offline);
    return () => {
      disposed = true;
      source?.close();
      clearInterval(timer);
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", offline);
    };
  }, [cache]);
}
export function useSnapshot() {
  // SSE owns the bootstrap and subsequent updates. An initial HTTP request
  // cannot race a newer streamed snapshot into the shared query cache.
  return useQuery<PanelSnapshot>({
    queryKey: SNAPSHOT_KEY,
    queryFn: skipToken,
    staleTime: Infinity,
  });
}
export async function postJSON<T>(path: string, data: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(result.error ?? `Request failed (${response.status})`);
  return result;
}
