import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalize, isUnder } from "./paths.js";
export const GUARD_FILE = "guard.json";
export const CONTROL_FILE = "control.json";
export const CLOCKWORK_DIR = ".teamsmith";
export interface GuardConfig {
    version: 1;
    run_id?: string;
    project_root: string;
    worktrees: Record<string, string>;
    owns: Record<string, string[]>;
    allow_main_tree: boolean;
    main_tree_scopes?: string[];
    budget?: {
        ceiling: number;
    };
    class2_patterns?: string[];
    class3_patterns?: string[];
}
export interface ControlState {
    paused: boolean;
    kill: boolean;
}
export interface GuardFiles {
    config: GuardConfig | null;
    configBroken: boolean;
    control: ControlState;
    controlBroken?: boolean;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
export function validConfig(v: unknown): v is GuardConfig {
    if (!record(v) || v.version !== 1 || typeof v.project_root !== "string" || typeof v.allow_main_tree !== "boolean" || !record(v.worktrees) || !record(v.owns))
        return false;
    try {
        normalize(v.project_root);
        if (v.run_id !== undefined && typeof v.run_id !== "string")
            return false;
        for (const [id, root] of Object.entries(v.worktrees)) {
            if (!id || typeof root !== "string" || !strings(v.owns[id]))
                return false;
            normalize(root);
        }
        const roots = Object.values(v.worktrees).map(root => normalize(root as string));
        if (roots.some((root, i) => root === normalize(v.project_root as string) || roots.some((other, j) => i !== j && isUnder(root, other))))
            return false;
        const scopes = [...Object.values(v.owns), ...(v.main_tree_scopes === undefined ? [] : [v.main_tree_scopes])];
        if (!scopes.every(x => strings(x) && x.every(p => !!p && !p.replaceAll("\\", "/").split("/").includes("..") && !/^[\\/]|:/.test(p))))
            return false;
        if (v.budget !== undefined && (!record(v.budget) || typeof v.budget.ceiling !== "number" || !Number.isFinite(v.budget.ceiling) || v.budget.ceiling < 0))
            return false;
        for (const key of ["class2_patterns", "class3_patterns"]) {
            if (v[key] !== undefined) {
                if (!strings(v[key]))
                    return false;
                for (const p of v[key])
                    new RegExp(p, "i");
            }
        }
        return true;
    }
    catch {
        return false;
    }
}
export async function readGuardFiles(projectDir: string): Promise<GuardFiles> {
    const dir = join(projectDir, CLOCKWORK_DIR);
    let config: GuardConfig | null = null;
    let configBroken = false;
    try {
        const parsed: unknown = JSON.parse(await readFile(join(dir, GUARD_FILE), "utf8"));
        if (validConfig(parsed))
            config = parsed;
        else
            configBroken = true;
    }
    catch (err) {
        configBroken = (err as NodeJS.ErrnoException).code !== "ENOENT";
    }
    let control: ControlState = { paused: false, kill: false };
    let controlBroken = false;
    try {
        const parsed: unknown = JSON.parse(await readFile(join(dir, CONTROL_FILE), "utf8"));
        if (!record(parsed) || Object.keys(parsed).some(k => k !== "paused" && k !== "kill") || (parsed.paused !== undefined && typeof parsed.paused !== "boolean") || (parsed.kill !== undefined && typeof parsed.kill !== "boolean"))
            controlBroken = true;
        else
            control = { paused: parsed.paused === true, kill: parsed.kill === true };
    }
    catch (err) {
        controlBroken = (err as NodeJS.ErrnoException).code !== "ENOENT";
    }
    return { config, configBroken, control, controlBroken };
}
