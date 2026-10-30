import { describe, expect, it } from "vitest";
import { clampPetPosition, petPlacementStorageKey, readPetPlacement } from "../client/companion-position.js";

const saved = (raw: string | null) => ({ getItem: (key: string) => { expect(key).toBe(petPlacementStorageKey); return raw; } });
describe("companion placement preferences", () => {
  it("restores both placement modes and leaves negative coordinates for viewport reconciliation", () => {
    for (const mode of ["floating", "docked"]) {
      const value = { version: 1, mode, x: -240, y: 30.5 };
      expect(readPetPlacement(saved(JSON.stringify(value)))).toEqual(value);
    }
  });
  it("ignores corrupt, unsupported, nonfinite and unavailable preferences", () => {
    for (const raw of [null, "", "{", "null", "[]", "42", '{"version":2,"mode":"floating","x":0,"y":0}', '{"version":1,"mode":"unknown","x":0,"y":0}', '{"version":1,"mode":"floating","x":"0","y":0}', '{"version":1,"mode":"floating","x":1e400,"y":0}', '{"version":1,"mode":"floating","x":0}', '{"version":1,"mode":"floating","x":0,"y":null}']) {
      expect(readPetPlacement(saved(raw))).toBeNull();
    }
    expect(readPetPlacement()).toBeNull();
    expect(readPetPlacement({getItem:()=>{throw new Error("Storage blocked");}})).toBeNull();
  });
});
describe("companion viewport boundaries", () => {
  const pet = {width:240,height:280};
  it("keeps a dragged pet within margins and moves old coordinates back after a resize", () => {
    expect(clampPetPosition({x:-70,y:-15},{width:1200,height:900},pet)).toEqual({x:8,y:8});
    expect(clampPetPosition({x:940,y:600},{width:800,height:600},pet)).toEqual({x:552,y:312});
    expect(clampPetPosition({x:300,y:200},{width:1200,height:900},pet)).toEqual({x:300,y:200});
  });
  it("shrinks margins and anchors oversized pets without negative positions in tiny viewports", () => {
    expect(clampPetPosition({x:900,y:900},{width:100,height:90},pet)).toEqual({x:0,y:0});
    expect(clampPetPosition({x:-1,y:99},{width:250,height:286},pet)).toEqual({x:5,y:3});
    expect(clampPetPosition({x:99,y:99},{width:0,height:0},pet)).toEqual({x:0,y:0});
  });
  it("supports custom margins and sanitizes nonfinite movement coordinates", () => {
    expect(clampPetPosition({x:Infinity,y:NaN},{width:800,height:600},pet,16)).toEqual({x:16,y:16});
    expect(clampPetPosition({x:-4,y:900},{width:800,height:600},pet,0)).toEqual({x:0,y:320});
  });
});
