/** Provider-neutral execution protocol. Adapters never mutate the project ledger. */
export interface ExecutionReport {
  outcome: "completed" | "accepted" | "rework" | "blocked";
  summary: string;
  evidence: Array<{
    criterion: string;
    command: string;
    result: string;
    passed: boolean;
  }>;
  findings: string[];
}
export type ExecutionEvent =
  | { type: "heartbeat" }
  | { type: "thread"; id: string }
  | { type: "activity"; kind: string; status: string }
  | {
      type: "command";
      id: string;
      command: string;
      exitCode: number;
      status: "completed" | "failed";
    }
  | { type: "usage"; input: number; cached: number; output: number }
  | { type: "report"; report: ExecutionReport };
export interface ExecutionRequest {
  workspace: string;
  prompt: string;
  mode: "produce" | "verify";
  model?: string;
  signal: AbortSignal;
}
export interface ExecutionAdapter {
  readonly id: string;
  execute(request: ExecutionRequest): AsyncIterable<ExecutionEvent>;
}
