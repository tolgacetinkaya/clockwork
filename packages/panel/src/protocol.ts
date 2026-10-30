import type {
  BudgetReport,
  Command,
  ExecutionTracking,
  LedgerEvent,
  QueueStatus,
  RunState,
} from "@clockwork/core";
import type { Spec, WorkUnit } from "../../core/src/spec/types.js";

export type PanelExecution = ExecutionTracking;

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
  mode?: string | null;
  model?: string | null;
  status: "working" | "verifying" | "attention" | "idle" | "completed";
  units: string[];
  lastEventAt: string | null;
}
export interface LaunchState {
  enabled: boolean;
  planSupported?: boolean;
  planning?: { requestId?: string; status: "running" | "completed" | "error"; summary?: string; usage?: { input: number; cached: number; output: number }; provider?: string; model?: string; draftRevision?: string; error?: string };
  disabledReason?: string;
  draft?: { revision: string; spec: Spec };
  approvalToken?: string;
  status: "idle" | "running" | "completed" | "stopped" | "error";
  error?: string;
  result?: { status: "completed" | "stopped"; accepted: string[]; failures: Record<string, string>; integrationWorkspace?: string; integrationVerification?: { status: "passed" | "failed" | "not_configured"; [key: string]: unknown } };
  recovery?: { recoveryToken: string; reasons: string[]; canResume: boolean; teamId?: string; accepted?: string[]; retry?: string[]; integrationWorkspace?: string; workspaces?: Record<string, string>; integrationVerification?: { status: "passed" | "failed" | "not_configured"; [key: string]: unknown } };
}
export interface PanelData {
  launch?: LaunchState;
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
