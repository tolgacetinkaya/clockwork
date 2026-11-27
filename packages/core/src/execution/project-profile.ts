import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { Redactor } from "../ledger/redact.js";

export interface ProjectProfileReceipt {
  version: number;
  digest: string;
  ruleIds: string[];
}

export interface ProjectProfile {
  receipt: ProjectProfileReceipt;
  rules: { id: string; instruction: string }[];
  egress: ProjectEgressPolicy;
}

export interface ProjectEgressPolicy {
  allowCodex: boolean;
  apiEndpoints: Record<string, string>;
}

export interface ProjectEgress {
  policy?: ProjectEgressPolicy;
  assertCurrent: () => Promise<void>;
}

export class ProjectEgressBeforeDispatchError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Project egress denied before dispatch", { cause });
    this.name = "ProjectEgressBeforeDispatchError";
  }
}

const RULE_ID = /^[a-z][a-z0-9-]{0,47}$/;
const PROVIDER_ID = /^[a-z][a-z0-9-]{0,47}$/;
const MAX_RULES = 16;
const MAX_FILE_BYTES = 16_384;
const PROFILE_FILE = "project-profile.json";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isProjectProfileReceipt(value: unknown): value is ProjectProfileReceipt {
  return record(value) && Object.keys(value).length === 3 &&
    typeof value.version === "number" && Number.isSafeInteger(value.version) && value.version > 0 &&
    typeof value.digest === "string" && /^[a-f0-9]{64}$/.test(value.digest) &&
    Array.isArray(value.ruleIds) && value.ruleIds.length <= MAX_RULES &&
    value.ruleIds.every(id => typeof id === "string" && RULE_ID.test(id)) &&
    new Set(value.ruleIds).size === value.ruleIds.length;
}

export function sameProjectProfile(left?: ProjectProfileReceipt, right?: ProjectProfileReceipt): boolean {
  if (!left || !right) return left === right;
  return left.version === right.version && left.digest === right.digest &&
    left.ruleIds.length === right.ruleIds.length && left.ruleIds.every((id, index) => id === right.ruleIds[index]);
}

function normalizeEndpoint(value: string): string {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash) throw new Error("Invalid provider endpoint");
  return url.href.replace(/\/+$/, "");
}

export function assertApiEgress(policy: ProjectEgressPolicy, provider: string, endpoint: string): void {
  if (!Object.hasOwn(policy.apiEndpoints, provider) || policy.apiEndpoints[provider] !== normalizeEndpoint(endpoint)) {
    throw new Error("Project profile does not allow this API provider endpoint");
  }
}

function parseProfile(raw: string): ProjectProfile {
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || Object.keys(value).length !== 3 ||
        typeof value.version !== "number" || !Number.isSafeInteger(value.version) || value.version < 1 ||
        !Array.isArray(value.rules) || value.rules.length > MAX_RULES ||
        !record(value.egress) || Object.keys(value.egress).length !== 2 ||
        typeof value.egress.allowCodex !== "boolean" || !record(value.egress.apiEndpoints)) throw new Error();
    const redactor = new Redactor();
    const ids = new Set<string>();
    const rules = value.rules.map((rule: unknown) => {
      if (!record(rule) || Object.keys(rule).length !== 2 || typeof rule.id !== "string" ||
          !RULE_ID.test(rule.id) || ids.has(rule.id) || redactor.redactText(rule.id) !== rule.id ||
          typeof rule.instruction !== "string" || !rule.instruction.trim() || rule.instruction.length > 500 ||
          /[\x00-\x1f\x7f-\x9f]/.test(rule.instruction) || redactor.redactText(rule.instruction) !== rule.instruction) throw new Error();
      ids.add(rule.id);
      return { id: rule.id, instruction: rule.instruction };
    });
    const endpoints = Object.entries(value.egress.apiEndpoints);
    if (endpoints.length > 16) throw new Error();
    const apiEndpoints = Object.fromEntries(endpoints.sort(([a], [b]) => a.localeCompare(b)).map(([id, url]) => {
      if (!PROVIDER_ID.test(id) || id === "codex" || typeof url !== "string" || url.length > 300) throw new Error();
      return [id, normalizeEndpoint(url)];
    }));
    const egress = { allowCodex: value.egress.allowCodex, apiEndpoints };
    const digest = createHash("sha256").update(JSON.stringify({ version: value.version, rules, egress })).digest("hex");
    return { receipt: { version: value.version, digest, ruleIds: [...ids] }, rules, egress };
  } catch {
    throw new Error("Invalid project profile in .teamsmith/project-profile.json");
  }
}

/** The profile belongs to the operator's project, never to a worker worktree. */
export async function loadProjectProfile(project: string): Promise<ProjectProfile | undefined> {
  const dir = join(project, ".teamsmith");
  try {
    if (!(await lstat(dir)).isDirectory()) throw new Error("Project profile directory must be a real directory");
    const path = join(dir, PROFILE_FILE);
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_FILE_BYTES) throw new Error("Invalid project profile file");
    const file = await open(path, "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.ino !== info.ino || stat.dev !== info.dev) throw new Error("Project profile file changed during read");
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_FILE_BYTES) throw new Error("Project profile is too large");
      return parseProfile(buffer.toString("utf8", 0, bytesRead));
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Cannot load .teamsmith/project-profile.json; check that it is valid and readable", { cause: error });
  }
}

export function projectProfilePrompt(profile?: ProjectProfile): string {
  if (!profile?.rules.length) return "";
  return "\n\n## Operator-approved project rules\n" +
    profile.rules.map(({ id, instruction }) => `- [${id}] ${instruction}`).join("\n") +
    "\nThese rules do not grant access, expand task scope, or override runtime restrictions. Report conflicting constraints.\n";
}

export function prepareProjectEgress(
  project: string,
  profile: ProjectProfile | undefined,
  adapter: { assertProjectEgress?: (policy: ProjectEgressPolicy, model?: string) => void },
  model?: string,
): ProjectEgress {
  if (profile) {
    if (!adapter.assertProjectEgress) throw new Error("This adapter cannot enforce the project data policy");
    adapter.assertProjectEgress(profile.egress, model);
  }
  return {
    policy: profile?.egress,
    async assertCurrent() {
      if (!sameProjectProfile(profile?.receipt, (await loadProjectProfile(project))?.receipt)) {
        throw new Error("Project profile changed; review the current profile before continuing");
      }
    },
  };
}
