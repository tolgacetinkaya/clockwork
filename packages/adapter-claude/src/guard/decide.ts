/**
 * Pure PreToolUse decision logic. No IO here: (tool call, guard context) →
 * allow | ask | deny + reason. The thin stdin/stdout shim lives in hook.ts;
 * everything enforceable is tested at this layer.
 */
import { normalize, isUnder } from "./paths.js";
export { normalize } from "./paths.js";
import type { GuardConfig, ControlState } from "./config.js";
export type PermissionDecision = "allow" | "ask" | "deny";
export interface Decision {
    decision: PermissionDecision;
    reason: string;
}
export interface HookToolCall {
    tool_name: string;
    tool_input: Record<string, unknown>;
}
export interface GuardContext {
    config: GuardConfig | null;
    configBroken: boolean;
    control: ControlState;
    /** Total tokens spent so far (derived from the ledger by the shim). */
    spentTotal?: number;
    controlBroken?: boolean;
    cwd?: string;
}
/** Tools that write files directly. */
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "MultiEdit"]);
/** Tools that spawn subagents — denied at unit boundaries (pause/budget). */
const SPAWN_TOOLS = new Set(["Task", "Agent"]);
/**
 * Class 2 (gated: do, but show first) — surfaced as "ask".
 * Class 3 (advisory only: the user pulls the trigger) — denied.
 * Both lists are extensible via guard config; these are the defaults.
 */
export const DEFAULT_CLASS2_PATTERNS = [
    "\\bgit\\s+push\\b",
    "\\bgh\\s+repo\\s+create\\b",
    "\\bdocker\\s+push\\b",
    "\\bgh\\s+pr\\s+create\\b",
];
export const DEFAULT_CLASS3_PATTERNS = [
    "\\bnpm\\s+publish\\b",
    "\\bgh\\s+release\\s+create\\b",
    "\\bgh\\s+repo\\s+(edit|delete)\\b",
    "\\bterraform\\s+(apply|destroy)\\b",
    "\\bkubectl\\s+(apply|delete)\\b",
    "--prod\\b",
    "\\bcurl\\b[^|]*\\|\\s*(ba)?sh\\b",
];
const allow = (reason = "ok"): Decision => ({ decision: "allow", reason });
const deny = (reason: string): Decision => ({ decision: "deny", reason });
const ask = (reason: string): Decision => ({ decision: "ask", reason });
export function decide(call: HookToolCall, ctx: GuardContext): Decision {
    const knownRead = new Set(["Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch", "TaskGet", "TaskList"]);
    const mutating = !knownRead.has(call.tool_name);
    // No guard file → clockwork is not active in this project; stay out of the way.
    if (!ctx.config) {
        if (ctx.configBroken && mutating) {
            return deny("clockwork guard config exists but is unreadable — failing closed for mutations");
        }
        return allow("clockwork inactive");
    }
    if (ctx.controlBroken && mutating)
        return deny("control file is corrupt — failing closed");
    // Kill/pause switch: graceful stop at unit boundary — reads continue,
    // mutations and new spawns do not.
    if (ctx.control.kill && mutating) {
        return deny("run killed — mutations and new agents are stopped");
    }
    if (ctx.control.paused && mutating) {
        return deny("run paused — resume to continue (mutations and new agents are held)");
    }
    // Budget ceiling: stop new work, let reads finish.
    const ceiling = ctx.config.budget?.ceiling;
    if (ceiling !== undefined &&
        ctx.spentTotal !== undefined &&
        ctx.spentTotal >= ceiling &&
        mutating) {
        return deny(`budget target reached (${ctx.spentTotal}/${ceiling} tokens) — graceful stop at unit boundary`);
    }
    if (call.tool_name === "Bash")
        return decideBash(call, ctx.config);
    if (WRITE_TOOLS.has(call.tool_name)) {
        try {
            return decideWrite(call, ctx.config, ctx.cwd);
        }
        catch {
            return deny("unsafe or ambiguous write path");
        }
    }
    if (mutating)
        return ask("agent spawning or unknown tool requires explicit approval");
    return allow();
}
function decideBash(call: HookToolCall, config: GuardConfig): Decision {
    const command = typeof call.tool_input.command === "string" ? call.tool_input.command : "";
    for (const pattern of [...DEFAULT_CLASS3_PATTERNS, ...(config.class3_patterns ?? [])]) {
        if (new RegExp(pattern, "i").test(command)) {
            return deny(`class 3 action (advisory only): matches /${pattern}/ — clockwork produces a runbook; the user pulls the trigger`);
        }
    }
    for (const pattern of [...DEFAULT_CLASS2_PATTERNS, ...(config.class2_patterns ?? [])]) {
        if (new RegExp(pattern, "i").test(command)) {
            return ask(`class 2 action (gated): matches /${pattern}/ — requires explicit approval`);
        }
    }
    return ask("arbitrary shell requires explicit approval; approved commands are not isolated by this hook");
}
function decideWrite(call: HookToolCall, config: GuardConfig, cwd?: string): Decision {
    const pathKey = call.tool_name === "NotebookEdit" ? "notebook_path" : "file_path";
    const alternateKey = pathKey === "file_path" ? "notebook_path" : "file_path";
    if (call.tool_input[alternateKey] !== undefined) {
        return deny("ambiguous write target: unexpected alternate path key");
    }
    const rawPath = typeof call.tool_input[pathKey] === "string" ? call.tool_input[pathKey] : undefined;
    if (!rawPath) {
        return deny("write tool call without a file path — refusing");
    }
    const path = normalize(rawPath);
    const projectRoot = normalize(config.project_root);
    const governedRoots = [projectRoot, ...Object.values(config.worktrees).map(normalize)];
    if (governedRoots.some(root => isUnder(path, root) && path.slice(root.length).split("/").includes(".teamsmith"))) {
        return deny("`.teamsmith/**` is orchestrator-only, including nested state directories");
    }
    const callerTree = cwd && Object.entries(config.worktrees).find(([, root]) => isUnder(normalize(cwd), normalize(root)));
    if (callerTree && !isUnder(path, normalize(callerTree[1])))
        return deny("write outside caller worktree");
    if (Object.values(config.worktrees).some(root => isUnder(path, `${normalize(root)}/.teamsmith`)))
        return deny("`.teamsmith/**` is orchestrator-only");
    // The ledger, guard, and control files are orchestrator-only, and the
    // orchestrator maintains them through the CLI, never through write tools.
    if (isUnder(path, joinNorm(projectRoot, ".teamsmith"))) {
        return deny("`.teamsmith/**` is orchestrator-only (ledger integrity) — use the clockwork CLI");
    }
    // Worktree identity: a write inside a unit's worktree must match that
    // unit's owns patterns.
    for (const [unitId, root] of Object.entries(config.worktrees)) {
        const worktreeRoot = normalize(root);
        if (!isUnder(path, worktreeRoot))
            continue;
        const rel = path.slice(worktreeRoot.length + 1);
        const owns = config.owns[unitId] ?? [];
        if (owns.some((pattern) => matchScope(pattern, rel))) {
            return allow(`within owns of "${unitId}"`);
        }
        return deny(`out of scope for unit "${unitId}": "${rel}" does not match owns [${owns.join(", ")}]`);
    }
    // Main tree: reserved for the integrator role (single writer for shared files).
    if (isUnder(path, projectRoot)) {
        if (!config.allow_main_tree) {
            return deny("main-tree writes are reserved for the integrator — integration phase is not active");
        }
        const scopes = config.main_tree_scopes ?? [];
        const rel = path.slice(projectRoot.length + 1);
        if (scopes.length === 0 || scopes.some((pattern) => matchScope(pattern, rel))) {
            return allow("integration phase: main-tree write permitted");
        }
        return deny(`integration scope violation: "${rel}" not in [${scopes.join(", ")}]`);
    }
    return deny(`write outside the project: "${rawPath}"`);
}
/* ---------- path and glob helpers (exported for tests) ---------- */
function joinNorm(a: string, b: string): string { return `${a}/${b}`; }
/**
 * Minimal glob matcher for owns patterns: `**` crosses directories,
 * `*` stays within a segment, everything else is literal.
 */
export function matchScope(pattern: string, relPath: string): boolean {
    const rel = relPath.replaceAll("\\", "/");
    const pat = pattern.replaceAll("\\", "/");
    const regex = pat
        .split("**")
        .map((part) => part.replace(/[.?+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*"))
        .join(".*");
    return new RegExp(`^${regex}$`, process.platform === "win32" ? "i" : "").test(rel);
}
