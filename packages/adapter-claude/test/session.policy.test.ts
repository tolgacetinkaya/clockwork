import { describe, expect, it } from "vitest";
import { IdlePolicy, sessionEnv, sessionPolicy } from "../src/session/policy.js";
describe("context and keep-warm policy", () => {
  it("opts out by default and leaves inherited environment untouched", () => {
    const env = { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000", OTHER: "unchanged" };
    expect(sessionPolicy().keepWarm.enabled).toBe(false);
    expect(sessionEnv(sessionPolicy(), env)).toEqual(env);
    const scoped = sessionEnv(sessionPolicy({ autoCompactTokens: 600000, cacheTtl: "1h" }), env);
    expect(scoped.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("600000");
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("200000");
    expect(scoped.CLAUDE_CODE_PROMPT_CACHE_TTL).toBe("1h");
  });
  it.each([
    { autoCompactTokens: 600 }, { autoCompactTokens: 1000001 }, { autoCompactTokens: NaN },
    { keepWarm: { enabled: "true" } }, { keepWarm: { maxCalls: 0 } },
    { keepWarm: { intervalMs: 0 } }, { cacheTtl: "forever" },
    { keepWarm: { maxDurationMs: Infinity } }, { keepWarm: { maxEstimatedCostUsd: -1 } },
    { maxEstimatedCostUsd: 0 }, { unknown: true },
  ])("rejects invalid or unbounded policy %j", value => { expect(() => sessionPolicy(value)).toThrow(); });
  it("never overlaps work, counts admitted calls, and measures from request start", () => {
    const p = new IdlePolicy(sessionPolicy({ keepWarm: { enabled: true, maxCalls: 1 } }), 0);
    expect(p.beginWarm(300000)).toBe(false);
    expect(p.beginUser(300000)).toBe(true);
    expect(p.beginWarm(600000)).toBe(false);
    p.finish("user", true, 0.01);
    expect(p.beginWarm(600000)).toBe(true);
    expect(p.beginWarm(600001)).toBe(false);
    expect(p.beginUser(600001)).toBe(false);
    p.finish("warm", true, 0.01);
    expect(p.beginWarm(1000000)).toBe(false);
    expect(p.calls).toBe(1);
    expect(p.beginUser(1000000)).toBe(true);
  });
  it("does not catch up after sleep or continue beyond duration/cost limits", () => {
    const p = new IdlePolicy(sessionPolicy({ keepWarm: { enabled: true } }), 0);
    p.beginUser(0); p.finish("user", true, 0.01);
    expect(p.beginWarm(3600001)).toBe(false);
    const q = new IdlePolicy(sessionPolicy({ keepWarm: { enabled: true, maxEstimatedCostUsd: 0.02 } }), 0);
    q.beginUser(0); q.finish("user", true, 0.01);
    expect(q.beginWarm(240001)).toBe(true); q.finish("warm", true, 0.03);
    expect(q.beginWarm(500000)).toBe(false);
  });
  it("unknown usage or failure disables warm calls; manual work remains possible", () => {
    for (const cost of [undefined, NaN, -1]) {
      const p = new IdlePolicy(sessionPolicy({ keepWarm: { enabled: true } }), 0);
      p.beginUser(0); p.finish("user", true, cost);
      expect(p.beginWarm(300000)).toBe(false); expect(p.beginUser(300000)).toBe(true);
    }
  });
});
