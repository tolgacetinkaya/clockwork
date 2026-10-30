import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PlanningEvent } from "@clockwork/core";
import { CodexAdapter, CodexPlanningDecoder } from "../src/index.js";
const proposal = { summary: "Investigate the requested bug", assumptions: [], open_questions: [], global_gates: ["Reproduction explains root cause"], work_units: [{ id: "diagnose", type: "research", description: "Find the root cause", owns: ["reports/diagnosis.md"], contracts: [], depends_on: [], acceptance: ["Cite evidence"], budget_est: 1000, agent: { id: "investigator", purpose: "Diagnose the bug", model_tier: "standard" } }] };
const frames = [
  { type: "thread.started", thread_id: "planning-thread" },
  { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(proposal) } },
  { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 25, output_tokens: 30 } },
].map(event => JSON.stringify(event) + "\n");
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture(script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clockwork-planning-test-")); dirs.push(dir);
  await writeFile(join(dir, "exec"), script);
  return dir;
}
async function collect(dir: string, options = {}): Promise<PlanningEvent[]> {
  const events: PlanningEvent[] = [];
  for await (const event of new CodexAdapter({ executable: process.execPath, ...options }).plan({ workspace: dir, prompt: "literal $(goal) `data`", model: "host/planner", signal: new AbortController().signal })) events.push(event);
  return events;
}
describe("Codex goal planning", () => {
  it("uses a fresh read-only schema-bound real child, exact model, stdin, usage and cleans temporary schema", async () => {
    const capture = await fixture(`const fs=require('node:fs');let prompt='';process.stdin.on('data',x=>prompt+=x);process.stdin.on('end',()=>{const args=process.argv.slice(2);const path=args[args.indexOf('--output-schema')+1];fs.writeFileSync('observed.json',JSON.stringify({args,prompt,path,schema:JSON.parse(fs.readFileSync(path,'utf8'))}));for(const line of ${JSON.stringify(frames)})process.stdout.write(line);});`);
    const events = await collect(capture);
    const observed = JSON.parse(await readFile(join(capture, "observed.json"), "utf8"));
    expect(observed.args[observed.args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(observed.args[observed.args.indexOf("--model") + 1]).toBe("host/planner");
    expect(observed.args).toContain("--ephemeral");
    expect(observed.args).toContain("--ignore-user-config");
    expect(observed.args).toContain("mcp_servers={}");
    expect(observed.prompt).toBe("literal $(goal) `data`");
    expect(observed.schema.properties).toHaveProperty("work_units");
    expect(observed.schema.properties).not.toHaveProperty("outcome");
    expect(events).toContainEqual({ type: "usage", input: 100, cached: 25, output: 30 });
    expect(events.at(-1)).toEqual({ type: "plan", proposal });
    await expect(readFile(observed.path)).rejects.toThrow();
    expect((await readdir(capture)).sort()).toEqual(["exec", "observed.json"]);
  });
  it.each([
    "private malformed JSON\n",
    frames[0]! + JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"secret":"private"}' } }) + "\n" + frames[2]!,
    frames.join("").slice(0, -1),
    frames.join("") + '{"type":"item.completed"}\n',
  ])("rejects malformed or incomplete real child output without exposing private contents", async stream => {
    const dir = await fixture(`process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(stream)}));`);
    await expect(collect(dir)).rejects.toThrow(/Malformed Codex JSONL event|Incomplete Codex execution stream|after turn completion/);
  });
  it("does not write into the workspace when the read-only child only emits output", async () => {
    const dir = await fixture(`process.stdin.resume();process.stdin.on('end',()=>{for(const line of ${JSON.stringify(frames)})process.stdout.write(line);});`);
    const before = await readdir(dir);
    expect((await collect(dir)).at(-1)?.type).toBe("plan");
    expect(await readdir(dir)).toEqual(before);
  });
  it("keeps heartbeat and timeout behavior while rejecting an unclosed child with valid plan frames", async () => {
    const dir = await fixture(`for(const line of ${JSON.stringify(frames)})process.stdout.write(line);setInterval(()=>{},1000);`);
    const events: PlanningEvent[] = [];
    await expect((async () => {
      for await (const event of new CodexAdapter({ executable: process.execPath, timeoutMs: 300, heartbeatMs: 15 }).plan({ workspace: dir, prompt: "plan", signal: new AbortController().signal })) events.push(event);
    })()).rejects.toThrow(/interrupted/);
    expect(events.some(event => event.type === "heartbeat")).toBe(true);
    expect(events.some(event => event.type === "plan")).toBe(false);
  });
  it("requires a valid final proposal and bounded complete framing", () => {
    const decoder = new CodexPlanningDecoder();
    decoder.feed(frames.join(""));
    expect(decoder.finish()).toEqual(proposal);
    expect(() => new CodexPlanningDecoder().feed("x".repeat(1_048_577))).toThrow(/size limit/);
    const invalid = new CodexPlanningDecoder();
    invalid.feed(frames[0]! + JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ ...proposal, permissions: ["write"] }) } }) + "\n" + frames[2]!);
    expect(() => invalid.finish()).toThrow(/Incomplete/);
  });
});
