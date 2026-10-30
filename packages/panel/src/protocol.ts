import type {
  BudgetReport,
  Command,
  LedgerEvent,
  QueueStatus,
  RunState,
} from "@clockwork/core";
import type { Spec, WorkUnit } from "../../core/src/spec/types.js";

/** Shared transport types only: importing this module into a browser runs no core code. */
export interface ControlState {
  paused: boolean;
  kill: boolean;
}
export interface PanelAgent {
  id: string;
  purpose: string | null;
  modelTier: string | null;
  provider?: string | null;
  model?: string | null;
  status: "working" | "verifying" | "attention" | "idle" | "completed";
  units: string[];
  lastEventAt: string | null;
}
export interface PanelData {
  schemaVersion: 1;
  mode: "workspace" | "recorded-demo";
  state: RunState;
  budget: BudgetReport;
  events: LedgerEvent[];
  eventCount: number;
  agents: PanelAgent[];
  spec: {
    goal: string;
    units: WorkUnit[];
    version: number;
    bias: Spec["priorities"]["bias"];
  } | null;
  control: ControlState;
  queue: QueueStatus;
  issues: string[];
}
export interface PanelSnapshot extends PanelData {
  streamId: string;
  revision: number;
  updatedAt: string;
}
export type PanelCommand = Pick<Command, "type" | "data">;
