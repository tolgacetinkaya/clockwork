export interface SessionPolicy {
  autoCompactTokens?: number;
  cacheTtl?: "5m" | "1h";
  turnTimeoutMs: number;
  maxEstimatedCostUsd: number;
  keepWarm: { enabled: boolean; intervalMs: number; maxCalls: number; maxDurationMs: number; maxEstimatedCostUsd: number };
}
function record(v: unknown): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v); }
function integer(v: unknown, fallback: number, min: number, max: number, key: string): number {
  const n = v === undefined ? fallback : v;
  if (!Number.isSafeInteger(n) || (n as number) < min || (n as number) > max) throw new Error(`Invalid ${key}: expected ${min}..${max}`);
  return n as number;
}
function cost(v: unknown, fallback: number): number {
  const n = v === undefined ? fallback : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > 100) throw new Error("Estimated cost limit must be greater than 0 and at most 100 USD");
  return n;
}
export function sessionPolicy(input: unknown = {}): SessionPolicy {
  if (!record(input) || Object.keys(input).some(k => !["autoCompactTokens", "cacheTtl", "turnTimeoutMs", "maxEstimatedCostUsd", "keepWarm"].includes(k))) throw new Error("Invalid session policy");
  const warm = input.keepWarm ?? {};
  if (!record(warm) || Object.keys(warm).some(k => !["enabled", "intervalMs", "maxCalls", "maxDurationMs", "maxEstimatedCostUsd"].includes(k)) || (warm.enabled !== undefined && typeof warm.enabled !== "boolean")) throw new Error("Invalid keepWarm policy");
  if (input.cacheTtl !== undefined && input.cacheTtl !== "5m" && input.cacheTtl !== "1h") throw new Error("cacheTtl must be 5m or 1h");
  return {
    ...(input.autoCompactTokens === undefined ? {} : { autoCompactTokens: integer(input.autoCompactTokens, 600000, 100000, 1000000, "autoCompactTokens") }),
    ...(input.cacheTtl === undefined ? {} : { cacheTtl: input.cacheTtl }),
    turnTimeoutMs: integer(input.turnTimeoutMs, 900000, 1000, 3600000, "turnTimeoutMs"),
    maxEstimatedCostUsd: cost(input.maxEstimatedCostUsd, 5),
    keepWarm: {
      enabled: warm.enabled === true,
      intervalMs: integer(warm.intervalMs, input.cacheTtl === "1h" ? 3000000 : 240000, 60000, 3600000, "intervalMs"),
      maxCalls: integer(warm.maxCalls, 6, 1, 100, "maxCalls"),
      maxDurationMs: integer(warm.maxDurationMs, 3600000, 60000, 86400000, "maxDurationMs"),
      maxEstimatedCostUsd: cost(warm.maxEstimatedCostUsd, 0.25),
    },
  };
}
export function sessionEnv(policy: SessionPolicy, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...inherited };
  if (policy.autoCompactTokens !== undefined) env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(policy.autoCompactTokens);
  if (policy.cacheTtl !== undefined) env.CLAUDE_CODE_PROMPT_CACHE_TTL = policy.cacheTtl;
  return env;
}

/** Admission uses elapsed monotonic time. No catch-up bursts after suspend. */
export class IdlePolicy {
  private busy = false;
  private started: number;
  private lastRequest: number;
  private ready = false;
  private stopped = false;
  private enabled: boolean;
  calls = 0;
  estimatedCostUsd = 0;
  constructor(readonly policy: SessionPolicy, now: number) {
    this.started = this.lastRequest = now;
    this.enabled = policy.keepWarm.enabled;
  }
  get active(): boolean { return this.busy; }
  get warmEnabled(): boolean { return this.enabled && !this.stopped; }
  disable(): void { this.enabled = false; }
  stop(): void { this.stopped = true; this.enabled = false; }
  beginUser(now: number): boolean {
    if (this.busy || this.stopped) return false;
    this.busy = true; this.lastRequest = now; return true;
  }
  beginWarm(now: number): boolean {
    const p = this.policy.keepWarm;
    if (!this.warmEnabled || this.busy || !this.ready) return false;
    if (now - this.started >= p.maxDurationMs || this.calls >= p.maxCalls || this.estimatedCostUsd >= p.maxEstimatedCostUsd) { this.disable(); return false; }
    if (now - this.lastRequest < p.intervalMs) return false;
    this.busy = true; this.calls++; this.lastRequest = now; return true;
  }
  finish(kind: "user" | "warm", success: boolean, estimatedCostUsd?: number): void {
    this.busy = false;
    if (!success || estimatedCostUsd === undefined || !Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) this.disable();
    else {
      this.ready = true;
      if (kind === "warm") this.estimatedCostUsd += estimatedCostUsd;
    }
  }
}
