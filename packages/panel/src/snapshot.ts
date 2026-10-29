import { readFile } from "node:fs/promises";
import type { AgentDef } from "../../core/src/spec/types.js";
import { join } from "node:path";
import {
  readLedger,
  reduceLedger,
  buildBudgetReport,
  loadSpecFile,
} from "@clockwork/core";
import { loadCommandQueue, TS_DIR } from "./state.js";
import type { PanelAgent, PanelData } from "./protocol.js";

/** One ledger read supplies every domain projection in an envelope. */
export async function readPanelData(
  projectDir: string,
  demo = false,
): Promise<PanelData> {
  const [ledger, controlResult, queueResult] = await Promise.all([
    readLedger(join(projectDir, TS_DIR, "ledger.jsonl")),
    readFile(join(projectDir, TS_DIR, "control.json"), "utf8")
      .then((raw) => {
        const value = JSON.parse(raw) as Record<string, unknown> | null;
        if (
          !value ||
          Array.isArray(value) ||
          typeof value.paused !== "boolean" ||
          typeof value.kill !== "boolean"
        )
          throw new Error("Invalid control file");
        return {
          control: { paused: value.paused, kill: value.kill },
          error: null as string | null,
        };
      })
      .catch((error) => ({
        control: { paused: false, kill: false },
        error:
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? null
            : "Control file is unreadable or corrupt. Requests are unavailable.",
      })),
    loadCommandQueue(projectDir)
      .then((queue) => ({ queue, error: null as string | null }))
      .catch(() => ({
        queue: { queued: [], consumedSeq: 0 },
        error:
          "Command queue is unreadable or corrupt. Requests are unavailable.",
      })),
  ]);
  const state = reduceLedger(ledger.events);
  const issues = [
    ...ledger.issues.map((issue) => issue.message),
    ...state.anomalies,
  ];
  if (controlResult.error) issues.push(controlResult.error);
  if (queueResult.error) issues.push(queueResult.error);
  let spec: PanelData["spec"] = null;
  let definitions: AgentDef[] = [];
  let assignments: Record<string, string> = {};
  if (state.specVersion !== null) {
    try {
      const loaded = await loadSpecFile(
        join(projectDir, TS_DIR, `spec.v${state.specVersion}.yaml`),
      );
      if (loaded.spec) {
        definitions = loaded.spec.agents;
        assignments = loaded.spec.assignment;
        spec = {
          goal: loaded.spec.meta.goal,
          units: loaded.spec.work_units,
          version: loaded.spec.spec_version,
          bias: loaded.spec.priorities.bias,
        };
      } else
        issues.push(
          "The recorded specification is invalid; task descriptions are unavailable.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        issues.push("The recorded specification could not be read.");
    }
  }
  const agents = new Map<string, PanelAgent>();
  const ensure = (id: string) => {
    let agent = agents.get(id);
    if (!agent) {
      agent = {
        id,
        purpose: null,
        modelTier: null,
        status: "idle",
        units: [],
        lastEventAt: null,
      };
      agents.set(id, agent);
    }
    return agent;
  };
  for (const event of ledger.events) {
    if (!event.agent_id) continue;
    const agent = ensure(event.agent_id);
    agent.lastEventAt = event.ts;
    if (typeof event.data?.provider === "string") agent.provider = event.data.provider;
    if (typeof event.data?.model === "string") agent.model = event.data.model;
    if (event.unit_id && !agent.units.includes(event.unit_id))
      agent.units.push(event.unit_id);
    if (event.type === "agent.completed") agent.status = "completed";
    if (event.type === "agent.error") agent.status = "attention";
    if (event.type === "unit.started") agent.status = "idle";
    if (event.type === "agent.spawned")
      agent.status =
        event.data?.mode === "verify"
          ? "verifying"
          : event.data?.mode === "produce"
            ? "working"
            : "idle";
  }
  for (const [id, unit] of Object.entries(state.units)) {
    const assigned = unit.agent ?? assignments[id];
    if (!assigned) continue;
    const agent = ensure(assigned);
    if (!agent.units.includes(id)) agent.units.push(id);
    if (agent.status === "attention" || agent.status === "completed") continue;
    if (unit.status === "running" || unit.status === "rework")
      agent.status = "working";
    else if (unit.status === "verifying" && agent.status !== "working")
      agent.status = "verifying";
    else if (
      unit.status === "failed" &&
      agent.status !== "working" &&
      agent.status !== "verifying"
    )
      agent.status = "attention";
  }
  for (const agent of agents.values()) {
    const definition =
      definitions.find((item) => item.id === agent.id) ??
      definitions.find((item) => agent.id.startsWith(`${item.id}-`));
    if (definition) {
      agent.purpose = definition.purpose;
      agent.modelTier = definition.model_tier;
    }
  }
  // An agent's status describes recorded work, never OS process liveness.
  return {
    schemaVersion: 1,
    mode: demo ? "recorded-demo" : "workspace",
    state,
    budget: buildBudgetReport(state),
    events: ledger.events.slice(-200),
    eventCount: ledger.events.length,
    agents: [...agents.values()],
    spec,
    control: controlResult.control,
    queue: queueResult.queue,
    issues,
  };
}
