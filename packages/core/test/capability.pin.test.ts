import { describe, expect, it } from "vitest";
import { parseSkillPin } from "../src/capability/pin.js";

const VALID_HASH = "a".repeat(40);

describe("parseSkillPin", () => {
  it("parses a valid owner/repo@skill#hash pin", () => {
    const result = parseSkillPin(`acme/skills@formatter#${VALID_HASH}`);
    expect(result).toEqual({
      ok: true,
      pin: { owner: "acme", repo: "skills", skill: "formatter", commitHash: VALID_HASH },
    });
  });

  it("lowercases the commit hash", () => {
    const result = parseSkillPin(`acme/skills@formatter#${"A".repeat(40)}`);
    expect(result.ok).toBe(true);
    expect(result.ok && result.pin.commitHash).toBe(VALID_HASH);
  });

  it("rejects a tag in place of a commit hash", () => {
    const result = parseSkillPin("acme/skills@formatter#v1.2.3");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/tag/i);
  });

  it("rejects a branch name in place of a commit hash", () => {
    const result = parseSkillPin("acme/skills@formatter#main");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/commit hash/i);
  });

  it("rejects a malformed pin missing the skill/hash separators", () => {
    const result = parseSkillPin("acme/skills");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/Malformed/);
  });

  it("rejects a pin with a too-short hash", () => {
    const result = parseSkillPin("acme/skills@formatter#abc123");
    expect(result.ok).toBe(false);
  });
});
