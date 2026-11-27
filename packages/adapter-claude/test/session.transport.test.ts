import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ManagedClaudeSession, type SessionEvent } from "../src/session/runtime.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { sessionPolicy } from "../src/session/policy.js";

it("real SDK transport applies scoped env and delivers the warm tool-denial hook to a child process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cw-claude-transport-"));
  const executable = join(dir, "fixture.mjs"); const receipt = join(dir, "receipt.json");
  const id = randomUUID(); const diagnostics: string[] = []; let clock = 0; const events: SessionEvent[] = [];
  // This child speaks the SDK control protocol but never calls a provider.
  await writeFile(executable, `
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
const id = ${JSON.stringify(id)};
const receipt = ${JSON.stringify(receipt)};
let hookId; let calls = 0; let init;
const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
const result = () => emit({type:'result',subtype:'success',is_error:false,session_id:id,result:'OK',uuid:'r'+calls,total_cost_usd:calls*0.01,num_turns:1,duration_ms:1,duration_api_ms:1,permission_denials:[],usage:{input_tokens:1,output_tokens:1},modelUsage:{fixture:{inputTokens:calls,outputTokens:calls,cacheReadInputTokens:calls*100,cacheCreationInputTokens:20}}});
const rl = createInterface({input:process.stdin});
rl.on('line', line => {
 const m=JSON.parse(line);
 if(m.type==='control_request') {
   if(m.request.subtype==='initialize') { init=m.request; hookId=init.hooks.PreToolUse[0].hookCallbackIds[0]; }
   emit({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{commands:[],models:[],account:{},hooks_applied:true,hook_on_failure_supported:true}}});
 } else if(m.type==='user') {
   calls++;
   if(calls===1) { emit({type:'system',subtype:'init',session_id:id,model:'fixture',tools:[],mcp_servers:[],uuid:'init'}); result(); }
   else emit({type:'control_request',request_id:'warm-hook',request:{subtype:'hook_callback',callback_id:hookId,tool_use_id:'read',input:{hook_event_name:'PreToolUse',session_id:id,transcript_path:'unused',cwd:process.cwd(),tool_name:'Read',tool_input:{file_path:'private.txt'},tool_use_id:'read'}}});
 } else if(m.type==='control_response' && m.response.request_id==='warm-hook') {
   writeFileSync(receipt,JSON.stringify({decision:m.response.response,compact:process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,args:process.argv.slice(2),onFailure:init.hooks.PreToolUse[0].onFailure,calls}));
   result();
 }
});
rl.on('close',()=>process.exit(0));
`);
  const session = new ManagedClaudeSession({ cwd: dir, executable, id, now: () => clock,
    policy: sessionPolicy({ autoCompactTokens: 600000, keepWarm: { enabled: true } }),
    onEvent: async e => { events.push(e); },
    factory: args => {
      const q = query({ ...args, options: { ...args.options, stderr: value => diagnostics.push(value) } });
      return { close: () => q.close(), async *[Symbol.asyncIterator]() {
        try { for await (const message of q) yield message; }
        catch (error) { diagnostics.push(String(error)); throw error; }
      } };
    },
  });
  const done = session.run("Test transport without a model call");
  try {
    await vi.waitFor(() => expect(events.filter(e => e.type === "turn_completed"), JSON.stringify({ events, diagnostics })).toHaveLength(1), { timeout: 15000 });
    clock = 240001; session.tick();
    await vi.waitFor(() => expect(events.filter(e => e.type === "turn_completed")).toHaveLength(2), { timeout: 10000 });
    const actual = JSON.parse(await readFile(receipt, "utf8"));
    expect(actual.decision.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(actual.compact).toBe("600000"); expect(actual.onFailure).toBe("block"); expect(actual.calls).toBe(2);
    expect(actual.args).toContain("--strict-mcp-config");
    expect(events.find(e => e.type === "ready")?.model).toBe("fixture");
  } finally { session.stop(); await done; await rm(dir, { recursive: true, force: true }); }
}, 30000);
