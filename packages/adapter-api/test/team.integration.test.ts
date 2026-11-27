import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { LedgerWriter, readLedger, writeSpecFile, type Spec, type ExecutionEvent, type ExecutionRequest } from "@clockwork/core";
import { ApiAdapter, ModelRouter, validateApiConfig } from "../src/index.js";
import { runTeam } from "../../runner/src/index.js";
import { generateGoalPlan } from "../../runner/src/planning.js";
import { git } from "../../runner/src/workspace.js";

const image = process.env.CLOCKWORK_TEST_SANDBOX_IMAGE;
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
it.skipIf(!image)("runs API planning, two parallel tasks, independent review and final verification against real worktrees", async () => {
  const temp = await mkdtemp(join(tmpdir(), "cw-api-team-")); dirs.push(temp);
  const project = join(temp, "project");
  await mkdir(join(project, "tests"), { recursive: true });
  await writeFile(join(project, "tests/check.cjs"), "const fs=require('node:fs'), a=require('node:assert/strict'); for (const name of process.argv.slice(2)) a.equal(fs.readFileSync(name+'.txt','utf8'),name);\n");
  await git(project, "init", "-b", "main");
  await git(project, "add", ".");
  await git(project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline");
  const requests: Array<{ provider: string; model: string; messages: Array<{ role: string; content: string }> }> = [];
  const server = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const value = JSON.parse(body);
      const messages = value.messages as Array<{ role: string; content: string }>;
      const prompt = messages[1]!.content;
      const planning = value.model === "small-planner";
      const integration = prompt.startsWith("# Final integration verification");
      const producer = prompt.startsWith("# Work unit:");
      const target = prompt.includes("unit: wu-a") ? "a" : "b";
      const command = planning ? "cat tests/check.cjs" : integration ? "node tests/check.cjs a b" : producer ? `printf '${target}' > ${target}.txt; node tests/check.cjs ${target}` : `node tests/check.cjs ${target}`;
      const provider = req.url!.split("/")[1]!;
      requests.push({ provider, model: value.model, messages });
      let message: unknown, finish_reason: string;
      if (messages.length === 2) {
        message = { role: "assistant", content: null, reasoning_content: "private-provider-continuation", tool_calls: [{ id: "tool-1", type: "function", function: { name: "execute_command", arguments: JSON.stringify({ command }) } }] };
        finish_reason = "tool_calls";
      } else {
        const report = planning ? {
          summary: "Two scoped deliveries", assumptions: [], open_questions: [], global_gates: ["both outputs correct"],
          work_units: ["a", "b"].map(name => ({ id: `wu-${name}`, type: "code", description: `Write ${name}.txt`, owns: [`${name}.txt`], contracts: [], depends_on: [], acceptance: [`${name} is correct`], budget_est: 1000, agent: { id: `writer-${name}`, purpose: `Write ${name}`, model_tier: "cheap" } })),
        } : { outcome: producer ? "completed" : "accepted", summary: "Observed command passed", findings: [], evidence: [{ criterion: integration ? "both outputs correct" : `${target} is correct`, command, result: "exit 0", passed: true }] };
        message = { role: "assistant", content: JSON.stringify(report) };
        finish_reason = "stop";
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message, finish_reason }], usage: { prompt_tokens: 20, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 8 } } }));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const envName = "CLOCKWORK_FIXTURE_PROVIDER_KEY", previous = process.env[envName];
  process.env[envName] = "fixture-only";
  try {
    const config = validateApiConfig({ sandboxImage: image, providers: Object.fromEntries(["qwen", "kimi"].map(id => [id, { baseUrl: `http://127.0.0.1:${address.port}/${id}`, apiKeyEnv: envName }])) });
    const adapter = new ModelRouter({ id: "codex", async *execute(_req: ExecutionRequest): AsyncIterable<ExecutionEvent> { throw new Error("Unexpected Codex call"); }, async *plan() { throw new Error("Unexpected Codex planning"); } }, config);
    const models = { producer_model: "qwen::small-code-model", verifier_model: "kimi::independent-review-model" };
    const plan = await generateGoalPlan({ project, adapter, model: "qwen::small-planner", input: { goal: "Produce a.txt and b.txt independently", budget: 20000, execution: models } });
    expect(plan.provider).toBe("qwen");
    expect(plan.spec.work_units).toHaveLength(2);
    await writeFile(join(project, ".teamsmith/control.json"), '{"paused":false,"kill":false}');
    const spec: Spec = plan.spec;
    await writeSpecFile(join(project, ".teamsmith"), spec);
    const writer = await LedgerWriter.open(join(project, ".teamsmith/ledger.jsonl"));
    await writer.append("run.started", { data: { run_id: "api-team" } });
    await writer.append("spec.approved", { actor: "user", data: { version: spec.spec_version, budget_target: 20000, units: spec.work_units.map(u => ({ id: u.id })) } });
    await writer.append("run.phase_entered", { data: { phase: "execute" } });
    const result = await runTeam({ project, adapter, concurrency: 2 });
    expect(result.status).toBe("completed");
    expect(result.failures).toEqual({});
    expect(result.integrationVerification?.status).toBe("passed");
    expect(await readFile(join(result.integrationWorkspace!, "a.txt"), "utf8")).toBe("a");
    expect(await readFile(join(result.integrationWorkspace!, "b.txt"), "utf8")).toBe("b");
    const { events, issues } = await readLedger(join(project, ".teamsmith/ledger.jsonl"));
    expect(issues).toEqual([]);
    const producers = events.filter(e => e.type === "agent.spawned" && e.data?.mode === "produce");
    const verifiers = events.filter(e => e.type === "agent.spawned" && e.data?.mode !== "produce");
    expect(producers).toHaveLength(2);
    expect(producers.every(e => e.data?.provider === "qwen")).toBe(true);
    expect(verifiers).toHaveLength(3);
    expect(verifiers.every(e => e.data?.provider === "kimi")).toBe(true);
    const starts = events.map((e, i) => e.type === "unit.started" ? i : -1).filter(i => i >= 0);
    const firstReview = events.findIndex(e => e.type === "unit.verify_started");
    expect(Math.max(...starts)).toBeLessThan(firstReview);
    expect(events.filter(e => e.type === "budget.spent")).toHaveLength(5);
    expect(JSON.stringify(events)).not.toContain("fixture-only");
    expect(JSON.stringify(events)).not.toContain("private-provider-continuation");
    expect(requests.filter(r => r.provider === "kimi").every(r => !r.messages[1]!.content.includes("Observed command passed"))).toBe(true);
  } finally {
    if (previous === undefined) delete process.env[envName]; else process.env[envName] = previous;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}, 120000);
