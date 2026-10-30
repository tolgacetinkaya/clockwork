import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexAdapter,
  CodexDecoder,
  buildExecArgs,
  parseReport,
} from "../src/index.js";
const report = {
  outcome: "completed",
  summary: "Created greeting",
  evidence: [],
  findings: [],
};
const lines = [
  { type: "thread.started", thread_id: "local-thread" },
  {
    type: "item.completed",
    item: { type: "agent_message", text: JSON.stringify(report) },
  },
  {
    type: "turn.completed",
    usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20 },
  },
].map((e) => JSON.stringify(e) + "\n");
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
describe("local Codex transport", () => {
  it("decodes split JSONL, preserves exact usage and requires structured completion", () => {
    const decoder = new CodexDecoder();
    const raw = lines.join("");
    const events = [
      ...decoder.feed(raw.slice(0, 17)),
      ...decoder.feed(raw.slice(17)),
    ];
    expect(events.find((e) => e.type === "usage")).toEqual({
      type: "usage",
      input: 100,
      cached: 80,
      output: 20,
    });
    expect(decoder.finish()).toEqual(report);
  });
  it.each([
    "not JSON\n",
    JSON.stringify({
      type: "turn.failed",
      error: { message: "private data" },
    }) + "\n",
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: -1, cached_input_tokens: 0, output_tokens: 0 },
    }) + "\n",
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 1, cached_input_tokens: 2, output_tokens: 0 },
    }) + "\n",
  ])(
    "rejects malformed or failed frames without echoing their content",
    (line) => {
      expect(() => new CodexDecoder().feed(line)).toThrow();
    },
  );
  it("rejects partial lines, oversized frames, missing reports and duplicate completion", () => {
    const decoder = new CodexDecoder();
    decoder.feed(lines[0]!);
    expect(() => decoder.finish()).toThrow(/Incomplete/);
    expect(() => decoder.feed("x".repeat(1_048_577))).toThrow(/size limit/);
    const complete = new CodexDecoder();
    complete.feed(lines.join(""));
    expect(() => complete.feed(lines[2]!)).toThrow(/after turn completion/);
    expect(() => parseReport('{"outcome":"accepted"}')).toThrow();
  });
  it("builds bounded subprocess arguments, with a fresh read-only verifier and no shell bypass", () => {
    const request = {
      workspace: "/workspace with spaces",
      prompt: "secret prompt",
      mode: "verify" as const,
      signal: new AbortController().signal,
    };
    const args = buildExecArgs(request, "/schema.json");
    expect(args).toContain("read-only");
    expect(args).toContain("--ignore-user-config");
    expect(args).not.toContain("resume");
    expect(buildExecArgs(request, "/schema.json", "elevated")).toContain(
      'windows.sandbox="elevated"',
    );
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("secret prompt");
    expect(args.at(-1)).toBe("-");
  });
  it("streams a real child process, sends the prompt on stdin and cleans schema files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clockwork-codex-test-"));
    dirs.push(dir);
    await writeFile(
      join(dir, "exec"),
      `const fs=require('node:fs');let p='';process.stdin.on('data',x=>p+=x);process.stdin.on('end',()=>{fs.writeFileSync('received.txt',p); const a=process.argv;fs.writeFileSync('schema-path.txt',a[a.indexOf('--output-schema')+1]); for(const l of ${JSON.stringify(lines)})process.stdout.write(l);});`,
    );
    const adapter = new CodexAdapter({ executable: process.execPath });
    const events = [];
    for await (const event of adapter.execute({
      workspace: dir,
      prompt: "a $(literal) `prompt`",
      mode: "produce",
      signal: new AbortController().signal,
    }))
      events.push(event);
    expect(await readFile(join(dir, "received.txt"), "utf8")).toBe(
      "a $(literal) `prompt`",
    );
    expect(events.at(-1)).toEqual({ type: "report", report });
    await expect(
      readFile(await readFile(join(dir, "schema-path.txt"), "utf8")),
    ).rejects.toThrow();
  });
  it("terminates a hung child on timeout instead of accepting partial output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clockwork-codex-test-"));
    dirs.push(dir);
    await writeFile(join(dir, "exec"), "setInterval(()=>{},1000)");
    const adapter = new CodexAdapter({
      executable: process.execPath,
      timeoutMs: 100,
    });
    await expect(
      (async () => {
        for await (const _ of adapter.execute({
          workspace: dir,
          prompt: "hello",
          mode: "produce",
          signal: new AbortController().signal,
        })) {
        }
      })(),
    ).rejects.toThrow(/interrupted/);
  });
  it("reports a missing executable without unhandled process errors", async () => {
    const adapter = new CodexAdapter({
      executable: "clockwork-nonexistent-codex-command",
    });
    await expect(
      (async () => {
        for await (const _ of adapter.execute({
          workspace: tmpdir(),
          prompt: "hello",
          mode: "produce",
          signal: new AbortController().signal,
        })) {
        }
      })(),
    ).rejects.toThrow(/Cannot start/);
  });
});
