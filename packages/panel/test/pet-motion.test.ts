import { describe, expect, it } from "vitest";
import { petMotion } from "../client/pet-motion.js";

describe("companion motion semantics", () => {
  it("keeps cosmetic breathing separate from work and celebration", () => {
    const idle = petMotion("idle", true, null);
    for (const kind of ["demo", "offline", "passed", "complete", "paused"] as const) {
      expect(petMotion(kind, true, null)).toEqual(idle);
    }
    expect(petMotion("working", true, null)).not.toEqual(idle);
    expect(petMotion("verifying", true, null)).not.toEqual(idle);
  });
  it("only jumps for an explicit interaction or newly observed passing event", () => {
    expect(petMotion("demo", true, "play").y).toEqual([0, -26, -7, 0]);
    expect(petMotion("passed", true, null).y).not.toEqual([0, -26, -7, 0]);
    expect(petMotion("passed", true, "celebrate").y).toEqual([0, -26, -7, 0]);
  });
  it("stops all transforms when reduced motion or tab visibility disables motion", () => {
    for (const kind of ["working", "verifying", "passed", "demo"] as const) {
      expect(petMotion(kind, false, "play")).toEqual({ x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1, transition: { duration: 0 } });
    }
  });
});
