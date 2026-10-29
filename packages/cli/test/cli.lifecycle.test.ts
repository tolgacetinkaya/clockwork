import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { runCli } from "../src/main.js";

const DRAFT_SPEC = {
  spec_version: 1,
  meta: { goal: "Tiny URL shortener", assumptions: ["License: MIT"] },
  priorities: { budget_target: "200k", bias: "fast" },
  work_units: [
    {
      id: "wu-db",
      type: "code",
      description: "Data layer",
      owns: ["src/db/**"],
      contracts: ["createLink(url) -> {slug}"],
      acceptance: ["unit tests pass"],
      budget_est: "40k",
    },
    {
      id: "wu-api",
      type: "code",
      description: "API endpoints",
      owns: ["src/api/**"],
      depends_on: ["wu-db"],
      acceptance: ["contract tests pass"],
      budget_est: "60k",
    },
  ],
  agents: [{ id: "builder", purpose: "Backend implementation", model_tier: "standard" }],
  assignment: { "wu-db": "builder", "wu-api": "builder" },
};

describe("CLI — end-to-end lifecycle in a temp project", () => {
  let dir: string;

  const cli = (...argv: string[]) => runCli(argv, dir);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clockwork-cli-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function saveDraft(spec: unknown): Promise<string> {
    const draftPath = join(dir, "draft.yaml");
    await writeFile(draftPath, YAML.stringify(spec), "utf8");
    return draftPath;
  }

  it("runs a full lifecycle and survives a session death (exit criterion)", async () => {
    // --- INTAKE
    expect((await cli("init")).code).toBe(0);
    expect(
      (
        await cli(
          "event",
          "run.started",
          "--data",
          '{"run_id":"run-gp1-1","teamsmith_version":"0.1.0","ledger_schema_version":1}',
        )
      ).code,
    ).toBe(0);
    await cli("event", "run.phase_entered", "--data", '{"phase":"intake"}');

    // --- DRAFT + NEGOTIATE
    const draftPath = await saveDraft(DRAFT_SPEC);
    const saved = await cli("spec", "save", draftPath);
    expect(saved.code, saved.out).toBe(0);

    await cli(
      "event",
      "spec.approved",
      "--actor",
      "user",
      "--data",
      JSON.stringify({
        version: 1,
        budget_target: 200_000,
        units: [{ id: "wu-db" }, { id: "wu-api", depends_on: ["wu-db"] }],
      }),
    );
    await cli("event", "budget.estimated", "--unit", "wu-db", "--data", '{"tokens":40000}');
    await cli("event", "run.phase_entered", "--data", '{"phase":"execute"}');

    // --- EXECUTE: wu-db with one rework cycle
    await cli("event", "unit.started", "--unit", "wu-db", "--agent", "builder");
    await cli("event", "budget.spent", "--unit", "wu-db", "--data", '{"tokens":30000}');
    await cli("event", "unit.verify_started", "--unit", "wu-db");
    await cli("event", "unit.rework", "--unit", "wu-db");
    await cli("event", "escalation.step", "--unit", "wu-db", "--data", '{"step":1}');
    await cli("event", "unit.started", "--unit", "wu-db", "--agent", "builder");
    await cli("event", "budget.spent", "--unit", "wu-db", "--data", '{"tokens":10000}');
    await cli("event", "unit.verify_started", "--unit", "wu-db");
    await cli("event", "unit.accepted", "--unit", "wu-db");

    // --- SESSION DEATH: a fresh "session" derives everything from disk alone.
    const resumed = await cli("state");
    expect(resumed.code).toBe(0);
    const state = JSON.parse(resumed.out);
    expect(state.runId).toBe("run-gp1-1");
    expect(state.phase).toBe("execute");
    expect(state.units["wu-db"].status).toBe("accepted");
    expect(state.units["wu-db"].reworkAttempts).toBe(1);
    expect(state.units["wu-api"].status).toBe("pending"); // now ready to schedule
    expect(state.totalSpent).toBe(40_000);
    expect(state.anomalies).toEqual([]);

    // --- continue after resume: wu-api, then RETRO
    await cli("event", "unit.started", "--unit", "wu-api", "--agent", "builder");
    await cli("event", "budget.spent", "--unit", "wu-api", "--data", '{"tokens":20000}');
    await cli("event", "unit.verify_started", "--unit", "wu-api");
    await cli("event", "unit.accepted", "--unit", "wu-api");
    await cli("event", "run.phase_entered", "--data", '{"phase":"retro"}');
    await cli("event", "run.completed", "--data", '{"outcome":"done"}');

    const retro = await cli("retro", "--project-type", "web-saas", "--satisfied", "true");
    expect(retro.code, retro.out).toBe(0);
    const record = YAML.parse(await readFile(retro.out.trim(), "utf8"));
    expect(record.run_id).toBe("run-gp1-1");
    expect(record.outcome).toBe("done");
    expect(record.goal).toBe("Tiny URL shortener");
    expect(record.budget.total_spent).toBe(60_000);
    expect(record.signals.rework_total).toBe(1);
    expect(record.user_verdict).toEqual({ satisfied: true });

    // --- projections
    const status = await cli("status");
    expect(status.out).toContain("run-gp1-1");
    expect(status.out).toContain("| wu-db | accepted | builder | 1 | 40000 |");
    const changelog = await cli("changelog");
    expect(changelog.out).toContain("`wu-api` accepted.");
    expect(changelog.out).toContain("Run completed: **done**.");

    // --- doctor is happy
    const doctor = await cli("doctor");
    expect(doctor.code, doctor.out).toBe(0);
    expect(doctor.out).toContain("doctor: healthy");
  });

  it("applies an amendment with sunk budget and appends the event", async () => {
    await cli("init");
    await cli("event", "run.started", "--data", '{"run_id":"run-2"}');
    const withDocs = structuredClone(DRAFT_SPEC) as typeof DRAFT_SPEC & {
      work_units: unknown[];
      assignment: Record<string, string>;
    };
    withDocs.work_units.push({
      id: "wu-docs",
      type: "content",
      description: "README",
      owns: ["README.md"],
      acceptance: ["setup steps verified"],
    });
    withDocs.assignment["wu-docs"] = "builder";
    await cli("spec", "save", await saveDraft(withDocs));
    await cli(
      "event",
      "spec.approved",
      "--actor",
      "user",
      "--data",
      '{"version":1,"units":[{"id":"wu-db"},{"id":"wu-api","depends_on":["wu-db"]},{"id":"wu-docs"}]}',
    );
    await cli("event", "unit.started", "--unit", "wu-db", "--agent", "builder");
    await cli("event", "budget.spent", "--unit", "wu-db", "--data", '{"tokens":9000}');

    const amendmentPath = join(dir, "amendment.yaml");
    await writeFile(
      amendmentPath,
      YAML.stringify({
        base_version: 1,
        initiated_by: "user",
        reason: "drop the whole backend, raise the target for the rework",
        changes: [
          { action: "cancel", unit: "wu-db" },
          { action: "retarget", budget_target: "300k" },
        ],
      }),
      "utf8",
    );

    const result = await cli("amend", amendmentPath);
    expect(result.code, result.out).toBe(0);
    const parsed = JSON.parse(result.out);
    expect(parsed.next_version).toBe(2);
    expect(parsed.impact.cancel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unit: "wu-db", sunk_budget: 9000, reason: "explicit" }),
        expect.objectContaining({ unit: "wu-api", reason: "cascade" }),
      ]),
    );

    // The spec.amended event carries the snapshot — state stays derivable.
    const state = JSON.parse((await cli("state")).out);
    expect(state.specVersion).toBe(2);
    expect(state.units["wu-db"].status).toBe("cancelled");
    expect(state.units["wu-db"].sunkBudget).toBe(9000);
    // retarget flowed through the event into derived state
    expect(state.budgetTarget).toBe(300_000);

    expect((await cli("spec", "latest")).out).toContain("spec.v2.yaml");
  });

  it("rejects an invalid draft with actionable errors and wrong versions", async () => {
    await cli("init");
    const broken = structuredClone(DRAFT_SPEC) as Record<string, unknown>;
    (broken.work_units as Array<{ depends_on?: string[] }>)[1]!.depends_on = ["wu-ghost"];
    const bad = await cli("spec", "save", await saveDraft(broken));
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("unknown-dependency");

    await cli("spec", "save", await saveDraft(DRAFT_SPEC));
    const wrongVersion = await cli("spec", "save", await saveDraft(DRAFT_SPEC));
    expect(wrongVersion.code).toBe(1);
    expect(wrongVersion.out).toContain("spec_version must be 2");
  });

  it("flips the control switch for pause/resume/kill", async () => {
    await cli("init");
    await cli("pause");
    expect(JSON.parse(await readFile(join(dir, ".teamsmith", "control.json"), "utf8"))).toEqual({
      paused: true,
      kill: false,
    });
    await cli("resume");
    expect(JSON.parse(await readFile(join(dir, ".teamsmith", "control.json"), "utf8"))).toEqual({
      paused: false,
      kill: false,
    });
    await cli("kill");
    expect(JSON.parse(await readFile(join(dir, ".teamsmith", "control.json"), "utf8"))).toEqual({
      paused: false,
      kill: true,
    });
  });

  it("emits producer and verifier prompts from the latest spec", async () => {
    await cli("init");
    await cli("spec", "save", await saveDraft(DRAFT_SPEC));

    const unit = await cli("prompt", "unit", "wu-api");
    expect(unit.code).toBe(0);
    expect(unit.out).toContain("Tiny URL shortener");
    expect(unit.out).toContain("wu-db: createLink(url) -> {slug}");

    const verify = await cli("prompt", "verify", "wu-api");
    expect(verify.out).toContain("TRY TO REFUTE");
  });

  it("rejects events with unknown types and lists the closed dictionary", async () => {
    await cli("init");
    const result = await cli("event", "unit.exploded");
    expect(result.code).toBe(1);
    expect(result.out).toContain('unknown event type: "unit.exploded"');
    expect(result.out).toContain("unit.accepted"); // the valid-types list is shown
  });

  it("changelog on an empty project says so instead of printing an empty document", async () => {
    const result = await cli("changelog");
    expect(result.code).toBe(1);
    expect(result.out).toContain("no ledger events found");
  });
});
