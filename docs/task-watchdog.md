# Task watchdog and delivery tracking

The local Codex unit/team runner records three separate signals: observed work activity, a heartbeat from the active CLI child, and report delivery/acknowledgement. The panel SSE heartbeat proves only panel connectivity. Neither heartbeat proves useful progress or semantic correctness.

## Policy and deadlines

Every producer, independent verifier, and final integration verifier receives a resolved policy. Defaults are an inactivity warning after 120 seconds, a hard session limit of 15 minutes, and a report-to-acknowledgement deadline of 30 seconds. An expected duration is optional and produces a warning rather than a claim that the agent should have finished.

```yaml
work_units:
  - id: wu-api
    type: code
    description: Implement the reviewed API change
    owns: [src/api/**]
    acceptance: [The API regression checks pass]
    watchdog:
      idle_ms: 120000
      expected_ms: 300000
      hard_ms: 900000
      delivery_ms: 30000
verification:
  global_gates: [The integrated regression checks pass]
  watchdog:
    idle_ms: 120000
    hard_ms: 900000
    delivery_ms: 30000
```

Times are per execution session, not the whole team. Values must be safe integers from 10 to 3600000 milliseconds; tiny values are useful for tests, not normal model work. Expected duration must be below the resolved hard limit. Policies participate in the reviewed specification and amendments. A host CLI --timeout-ms remains an upper bound; a plan cannot broaden it. The current panel planning form does not expose these advanced fields; use a reviewed YAML plan when setting per-task policy.

Inactivity and expected-duration warnings are recorded once per relevant transition. New actual work clears inactivity; expected-duration warnings remain until the execution ends. Heartbeats and usage accounting do not clear inactivity. A hard deadline aborts the adapter. A report cannot establish success while its stream/child has not settled.

## Delivery acknowledgement

The runner durably records agent.delivery_received with a delivery ID and ledger sequence, validates integrity/evidence, records the terminal report, and acknowledges processing using agent.delivery_acknowledged referencing the same ID/sequence. Task acceptance is a separate transition after successful processing. Rejected processing is acknowledged as rejected and never becomes acceptance.

The report-to-acknowledgement deadline includes receipt persistence and validation. A failed or missing acknowledgement remains visible; a crash must not cause the report's effects or a task to be replayed blindly. Normal failures with a received report record a rejected acknowledgement only when persistence succeeds. Startup and reviewed recovery refuse pending/unreconciled executions. A completed run cannot hide an unacknowledged delivery.

## Interruption and recovery

The wrapper bounds waiting even if a custom adapter never returns its next event. Cleanup waits briefly for outstanding iteration and iterator closure. If those do not settle, the ledger records execution_unreconciled. Further execution and recovery remain blocked even when token usage is known. This avoids treating an abort request as proof that the worker stopped.

An operator must establish that the worker and any descendants have stopped before manually reconciling a flagged execution with a user-authorized agent.execution_reconciled event and a nonempty reason. The event must match the original execution, agent and unit (omit unit for integration verification). Reconciliation clears only the unconfirmed-termination flag: it does not invent usage, acknowledge a report, accept work or retry a task. Unknown usage still needs the existing verified budget reconciliation, and remaining recovery blockers still apply.

Stopping the CLI child does not prove every OS descendant stopped. These cooperative local records are not authenticated attestations against a malicious host. Pause/stop and watchdog failure prevent further admission; old worktrees and evidence remain available for review. No automatic retry is introduced.

## Panel and compatibility

The Team screen displays recorded activity, child heartbeat, warning type, delivery receipt and acknowledgement separately. Stale/disconnected snapshots and recorded demos are labeled. A recorded running status is not live OS health, and acknowledgement is not task acceptance. The state projection retains execution tracking even when the recent event window is truncated. CLI status includes a compact tracking summary.

Historical runs without a watchdog-enabled spawn have no fabricated execution health. New events are additive to ledger schema 1. Existing command-backed verification, protected tests and delivery fingerprints remain in force.

## Validation boundary

Tests use real temporary Git worktrees and local Node child processes, controlled noncooperative adapters, deterministic deadline races and actual ledger writes. They do not need model calls. Live provider acceptance, native desktop notifications, notifications outside the panel and automatic restart scheduling are separate work.
