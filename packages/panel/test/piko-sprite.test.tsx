import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pikoPose, PikoSprite } from "../client/piko-sprite.js";

describe("Piko sprite evidence", () => {
  it("keeps historical success, demo and offline in cosmetic idle", () => {
    for (const kind of ["passed", "demo", "offline", "complete"] as const) expect(pikoPose(kind, true, null)).toBe("idle");
    expect(pikoPose("passed", true, "celebrate")).toBe("success");
    expect(pikoPose("demo", true, "play")).toBe("attention");
  });
  it("uses work frames only for recorded activity and walking for deliberate native drag", () => {
    expect(pikoPose("working", true, null)).toBe("work");
    expect(pikoPose("verifying", true, null)).toBe("work");
    expect(pikoPose("demo", true, null, true)).toBe("walk");
  });
  it("freezes frame zero of idle when disabled, even during a reaction or drag", () => {
    expect(pikoPose("working", false, "celebrate", true)).toBe("idle");
    const html = renderToStaticMarkup(createElement(PikoSprite, { kind: "passed", enabled: false, reaction: "celebrate" }));
    expect(html).toContain('data-pose="idle"');
    expect(html).toContain('--sprite-row:0%');
    expect(html).not.toContain('is-animated');
  });
  it("selects the fifth normalized row for a fresh success", () => {
    const html = renderToStaticMarkup(createElement(PikoSprite, { kind: "passed", enabled: true, reaction: "celebrate" }));
    expect(html).toContain('--sprite-row:100%');
  });
});
