import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  latestSpecVersion,
  loadLatestSpec,
  loadSpecFile,
  parseSpecFileName,
  specFileName,
  writeSpecFile,
} from "../src/spec/files.js";
import { validSpec } from "./fixtures.js";

describe("spec file names", () => {
  it("formats and parses version file names", () => {
    expect(specFileName(1)).toBe("spec.v1.yaml");
    expect(specFileName(12)).toBe("spec.v12.yaml");
    expect(parseSpecFileName("spec.v3.yaml")).toBe(3);
    expect(parseSpecFileName("spec.yaml")).toBeNull();
    expect(parseSpecFileName("spec.v3.yml")).toBeNull();
  });

  it("rejects invalid versions", () => {
    expect(() => specFileName(0)).toThrow(RangeError);
    expect(() => specFileName(1.5)).toThrow(RangeError);
  });
});

describe("spec file IO", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clockwork-spec-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes and loads a spec round-trip", async () => {
    const spec = validSpec();
    const filePath = await writeSpecFile(dir, spec);
    const loaded = await loadSpecFile(filePath);
    expect(loaded.issues).toEqual([]);
    expect(loaded.spec).toEqual(spec);
  });

  it("refuses to overwrite an existing version — versions are immutable", async () => {
    await writeSpecFile(dir, validSpec());
    await expect(writeSpecFile(dir, validSpec())).rejects.toThrow(/immutable/);
  });

  it("refuses to write an invalid spec", async () => {
    const broken = validSpec();
    broken.work_units[0]!.depends_on = ["wu-ghost"];
    await expect(writeSpecFile(dir, broken)).rejects.toThrow(/Refusing to write/);
  });

  it("finds the latest version and loads it", async () => {
    const v1 = validSpec();
    await writeSpecFile(dir, v1);
    const v3 = { ...validSpec(), spec_version: 3 };
    await writeSpecFile(dir, v3);

    expect(await latestSpecVersion(dir)).toBe(3);
    const loaded = await loadLatestSpec(dir);
    expect(loaded?.spec?.spec_version).toBe(3);
  });

  it("returns null when the directory has no specs or does not exist", async () => {
    expect(await latestSpecVersion(dir)).toBeNull();
    expect(await loadLatestSpec(join(dir, "missing"))).toBeNull();
  });

  it("reports YAML parse failures as issues instead of throwing", async () => {
    const filePath = join(dir, "spec.v1.yaml");
    await writeFile(filePath, "spec_version: [unclosed", "utf8");
    const loaded = await loadSpecFile(filePath);
    expect(loaded.spec).toBeUndefined();
    expect(loaded.issues.map((i) => i.code)).toContain("yaml-parse");
  });

  it("reports schema violations when loading a hand-broken file", async () => {
    const filePath = join(dir, "spec.v1.yaml");
    await writeFile(filePath, "spec_version: 1\nmeta:\n  goal: x\n", "utf8");
    const loaded = await loadSpecFile(filePath);
    expect(loaded.spec).toBeUndefined();
    expect(loaded.issues.map((i) => i.code)).toContain("schema");
  });
});
