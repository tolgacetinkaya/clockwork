import type { PanelSnapshot } from "../src/protocol.js";

export const SNAPSHOT_KEY = ["panel", "snapshot"] as const;
/** Full snapshots are idempotent. A new server epoch deliberately permits a lower revision. */
export function newerSnapshot(
  current: PanelSnapshot | undefined,
  next: PanelSnapshot,
): PanelSnapshot {
  return current?.streamId === next.streamId &&
    current.revision >= next.revision
    ? current
    : next;
}
export function parseSnapshot(raw: string): PanelSnapshot {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object")
    throw new Error("Invalid panel snapshot");
  const s = value as Partial<PanelSnapshot>;
  if (
    s.schemaVersion !== 1 ||
    typeof s.streamId !== "string" ||
    !Number.isSafeInteger(s.revision) ||
    (s.revision ?? 0) < 1 ||
    !s.state ||
    !s.budget ||
    !s.control ||
    !s.queue ||
    !Array.isArray(s.events) ||
    !Array.isArray(s.agents) ||
    !Array.isArray(s.issues)
  )
    throw new Error("Unsupported panel snapshot");
  return s as PanelSnapshot;
}
