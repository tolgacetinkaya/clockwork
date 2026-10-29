/**
 * Thin PreToolUse shim: stdin JSON in, hook JSON out. All decision logic
 * lives in decide.ts (pure, tested); this file only wires IO.
 */
import { join, dirname, basename } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { normalize } from "./paths.js";
import { readLedger, reduceLedger } from "@clockwork/core";
import { readGuardFiles, CLOCKWORK_DIR } from "./config.js";
import { decide } from "./decide.js";
import type { Decision, HookToolCall } from "./decide.js";
interface HookPayload {
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    cwd?: string;
}
export interface HookOutput {
    hookSpecificOutput: {
        hookEventName: "PreToolUse";
        permissionDecision: Decision["decision"];
        permissionDecisionReason: string;
    };
}
export async function handleHookInput(rawInput: string, fallbackCwd: string, explicitRoot = false): Promise<HookOutput> {
    let payload: HookPayload;
    try {
        payload = JSON.parse(rawInput) as HookPayload;
    }
    catch {
        // Unparseable hook input: fail closed — we cannot know what the call is.
        return output({ decision: "deny", reason: "unparseable hook input" });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.tool_name !== "string" || !payload.tool_input || typeof payload.tool_input !== "object" || Array.isArray(payload.tool_input) || (payload.cwd !== undefined && typeof payload.cwd !== "string"))
        return output({ decision: "deny", reason: "malformed hook input" });
    const call: HookToolCall = {
        tool_name: payload.tool_name ?? "",
        tool_input: payload.tool_input ?? {},
    };
    // The process cwd is the trusted anchor. Caller cwd cannot deactivate its guard.
    let projectDir = fallbackCwd;
    let files = await readGuardFiles(projectDir);
    for (const start of explicitRoot ? [] : [fallbackCwd, payload.cwd ?? fallbackCwd]) {
        let dir = start;
        // Outermost configured ancestor owns discovery: nested files cannot
        // replace an already active project's policy.
        while (true) {
            const candidate = await readGuardFiles(dir);
            if (candidate.config || candidate.configBroken) {
                projectDir = dir;
                files = candidate;
            }
            const parent = dirname(dir);
            if (parent === dir)
                break;
            dir = parent;
        }
        if (files.config || files.configBroken)
            break;
    }
    let callCwd = payload.cwd ?? fallbackCwd;
    if (files.config) {
        const lexical = decide(call, { config: files.config, configBroken: false, control: files.control, controlBroken: files.controlBroken ?? false, cwd: payload.cwd ?? fallbackCwd });
        if (lexical.decision === "deny")
            return output(lexical);
        try {
            callCwd = await physical(callCwd);
            if (normalize(await physical(files.config.project_root)) !== normalize(await physical(projectDir))) {
                return output({ decision: "deny", reason: "guard project_root does not match its discovery directory" });
            }
            // Resolve existing ancestors too: new files under a symlink must not escape.
            files.config = { ...files.config, project_root: await physical(files.config.project_root), worktrees: Object.fromEntries(await Promise.all(Object.entries(files.config.worktrees).map(async ([id, root]) => [id, await physical(root)]))) };
            for (const key of ["file_path", "notebook_path"])
                if (typeof call.tool_input[key] === "string")
                    call.tool_input[key] = await physical(call.tool_input[key]);
        }
        catch {
            return output({ decision: "deny", reason: "unsafe path or filesystem resolution failure" });
        }
    }
    let spentTotal: number | undefined;
    if (files.config?.budget) {
        try {
            const { events, issues } = await readLedger(join(projectDir, CLOCKWORK_DIR, "ledger.jsonl"));
            if (issues.length)
                return output({ decision: "deny", reason: "budget ledger is corrupt" });
            const state = reduceLedger(events);
            if (state.anomalies.length)
                return output({ decision: "deny", reason: "budget ledger has invalid transitions" });
            spentTotal = state.totalSpent;
        }
        catch {
            return output({ decision: "deny", reason: "budget ledger is unreadable" });
        }
    }
    return output(decide(call, {
        config: files.config,
        configBroken: files.configBroken,
        control: files.control,
        controlBroken: files.controlBroken ?? false,
        cwd: callCwd,
        ...(spentTotal !== undefined ? { spentTotal } : {}),
    }));
}
async function physical(path: string): Promise<string> {
    normalize(path);
    try {
        const resolved = await realpath(path);
        const entry = await stat(resolved);
        if (entry.isFile() && entry.nlink > 1) {
            throw new Error("hard-linked write targets are unsupported");
        }
        return resolved;
    }
    catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT")
            throw err;
        const parent = dirname(path);
        if (parent === path)
            throw err;
        return join(await physical(parent), basename(path));
    }
}
function output(decision: Decision): HookOutput {
    return {
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: decision.decision,
            permissionDecisionReason: decision.reason,
        },
    };
}
/** Entry point. CLOCKWORK_PROJECT_ROOT is a trusted launcher-supplied anchor for external worktrees.
 * Hooks are approval boundaries, not an OS sandbox for approved shell commands. */
export async function main(): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
    }
    const anchor = process.env.CLOCKWORK_PROJECT_ROOT ?? process.env.TEAMSMITH_PROJECT_ROOT;
    const result = await handleHookInput(Buffer.concat(chunks).toString("utf8"), anchor ?? process.cwd(), anchor !== undefined);
    process.stdout.write(JSON.stringify(result));
}
