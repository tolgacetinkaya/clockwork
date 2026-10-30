import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureIntegrityBaseline, inspectIntegrity } from "../src/integrity.js";
import { git } from "../src/workspace.js";

describe("committed verification integrity", () => {
  let temp: string;
  let repository: string;
  const put = async (file: string, content: string) => {
    const target = join(repository, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  };
  const commit = async () => {
    await git(repository, "add", ".");
    await git(repository, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture");
  };
  beforeEach(async () => {
    temp = await mkdtemp(join(tmpdir(), "clockwork-integrity-"));
    repository = join(temp, "repository");
    await mkdir(repository);
    await git(repository, "init", "-b", "main");
    await git(repository, "config", "core.autocrlf", "false");
    await put("tests/existing.test.ts", 'expect(answer()).toBe(42);\n');
    await put("vitest.config.ts", 'export default { test: { include: ["tests/*.test.ts"] } };\n');
    await put("package.json", '{"scripts":{"test":"vitest run"}}\n');
    await put("src/answer.ts", "// TODO: preserve existing follow-up\nexport const answer = () => 42;\n");
    await commit();
  });
  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  it("detects modified and deleted existing assertions while permitting added tests", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    await put("tests/existing.test.ts", "expect(true).toBe(true);\n");
    await put("tests/new.test.ts", "throw new Error('not implemented');\n");
    expect(await inspectIntegrity(repository, baseline)).toEqual([
      { code: "protected_test_modified", severity: "blocking", file: "tests/existing.test.ts" },
    ]);
    await rm(join(repository, "tests/existing.test.ts"));
    expect(await inspectIntegrity(repository, baseline)).toEqual([
      { code: "protected_test_deleted", severity: "blocking", file: "tests/existing.test.ts" },
    ]);
  });

  it("protects runner configuration and manifest scripts", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    await put("vitest.config.ts", "export default { test: { exclude: ['**/*'] } };\n");
    await put("package.json", '{"scripts":{"test":"exit 0"}}\n');
    const findings = await inspectIntegrity(repository, baseline);
    expect(findings.map((finding) => finding.file).sort()).toEqual(["package.json", "vitest.config.ts"]);
    expect(findings.every((finding) => finding.severity === "blocking")).toBe(true);
  });

  it("blocks new validation configs and manifests while allowing new ordinary tests", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    await put("jest.config.cjs", "module.exports = { testPathIgnorePatterns: ['.*'] };\n");
    await put("new-package/package.json", '{"scripts":{"test":"exit 0"}}\n');
    await put("tests/new.test.ts", "expect(true).toBe(true);\n");
    expect(await inspectIntegrity(repository, baseline)).toEqual([
      { code: "protected_config_added", severity: "blocking", file: "jest.config.cjs" },
      { code: "protected_config_added", severity: "blocking", file: "new-package/package.json" },
    ]);
  });

  it("permits an explicitly approved new validation config without permitting others", async () => {
    const baseline = await captureIntegrityBaseline(repository, { authorizedTestChanges: ["jest.config.cjs"] });
    await put("jest.config.cjs", "module.exports = { testMatch: ['**/*.test.ts'] };\n");
    await put(".mocharc.json", "{}\n");
    expect(await inspectIntegrity(repository, baseline)).toEqual([
      { code: "protected_config_added", severity: "blocking", file: ".mocharc.json" },
    ]);
  });

  const validationConfigs = [
    "vite.config.ts", "vitest.workspace.ts", "jest.preset.cjs", "tsconfig.json", "tsconfig.build.json", "nested/tsconfig.test.json",
    "jsconfig.json", "babel.config.cjs", ".babelrc.json", "eslint.config.mjs", ".eslintrc.json", ".eslintignore",
  ];

  it("protects existing Vite, compiler and code-validation configs", async () => {
    for (const file of validationConfigs) await put(file, "{}\n");
    await commit();
    const baseline = await captureIntegrityBaseline(repository);
    for (const file of validationConfigs) await put(file, "{\"validationDisabled\":true}\n");
    const findings = await inspectIntegrity(repository, baseline);
    expect(findings.map((finding) => finding.file).sort()).toEqual([...validationConfigs].sort());
    expect(findings.every((finding) => finding.code === "protected_test_modified" && finding.severity === "blocking")).toBe(true);
  });

  it("permits exact approved changes to existing compiler and validation configs", async () => {
    for (const file of validationConfigs) await put(file, "{}\n");
    await commit();
    const baseline = await captureIntegrityBaseline(repository, { authorizedTestChanges: validationConfigs });
    for (const file of validationConfigs) await put(file, "{\"approved\":true}\n");
    expect(await inspectIntegrity(repository, baseline)).toEqual([]);
  });

  it("blocks new Vite, compiler and code-validation configs", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    for (const file of validationConfigs) await put(file, "{}\n");
    const findings = await inspectIntegrity(repository, baseline);
    expect(findings.map((finding) => finding.file).sort()).toEqual([...validationConfigs].sort());
    expect(findings.every((finding) => finding.code === "protected_config_added" && finding.severity === "blocking")).toBe(true);
  });

  it("permits new compiler and validation configs only with their exact approved paths", async () => {
    const baseline = await captureIntegrityBaseline(repository, { authorizedTestChanges: validationConfigs });
    for (const file of validationConfigs) await put(file, "{}\n");
    expect(await inspectIntegrity(repository, baseline)).toEqual([]);
  });

  it("retains protection if the producer commits its changes and advances HEAD", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    await put("tests/existing.test.ts", "// assertion removed\n");
    await put("src/answer.ts", "export function answer() { throw new Error('not implemented'); }\n");
    await commit();
    expect(await inspectIntegrity(repository, baseline)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "protected_test_modified", file: "tests/existing.test.ts" }),
      expect.objectContaining({ code: "incomplete_work", severity: "blocking", marker: "unimplemented" }),
    ]));
  });

  it("detects deletion when a producer renames an existing test", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    await rename(join(repository, "tests/existing.test.ts"), join(repository, "tests/new.test.ts"));
    expect(await inspectIntegrity(repository, baseline)).toEqual([
      { code: "protected_test_deleted", severity: "blocking", file: "tests/existing.test.ts" },
    ]);
  });

  it("requires an unchanged committed test baseline before production", async () => {
    await put("tests/existing.test.ts", "// weakened before baseline\n");
    await expect(captureIntegrityBaseline(repository)).rejects.toThrow("modified protected test/config");
  });

  it("does not trust index flags that hide modified tests from git diff", async () => {
    await git(repository, "update-index", "--assume-unchanged", "tests/existing.test.ts");
    await put("tests/existing.test.ts", "// hidden assertion removal\n");
    expect(await git(repository, "diff", "--name-only", "HEAD")).toBe("");
    await expect(captureIntegrityBaseline(repository)).rejects.toThrow("modified protected test/config");
  });

  it("accepts committed text with normal checkout line-ending conversion", async () => {
    const target = join(repository, "tests/existing.test.ts");
    const original = await readFile(target, "utf8");
    await writeFile(target, original.replace(/\n/g, "\r\n"));
    const baseline = await captureIntegrityBaseline(repository);
    expect(await inspectIntegrity(repository, baseline)).toEqual([]);
  });

  it("permits only exact approved test exceptions", async () => {
    const baseline = await captureIntegrityBaseline(repository, { authorizedTestChanges: ["tests/existing.test.ts"] });
    await put("tests/existing.test.ts", "// approved replacement\n");
    await put("vitest.config.ts", "export default {};\n");
    expect(await inspectIntegrity(repository, baseline)).toEqual([
      { code: "protected_test_modified", severity: "blocking", file: "vitest.config.ts" },
    ]);
    for (const path of ["tests/*", "../tests/existing.test.ts", "tests/../tests/existing.test.ts", "tests\\existing.test.ts", "tests/existing.test.ts.", "TESTS/existing.test.ts", "src/answer.ts", "tests/new.test.ts"]) {
      await expect(captureIntegrityBaseline(repository, { authorizedTestChanges: [path] })).rejects.toThrow();
    }
  });

  it("rejects hard links in protected and new source files", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    await link(join(repository, "tests/existing.test.ts"), join(temp, "test-alias.ts"));
    await expect(inspectIntegrity(repository, baseline)).rejects.toThrow("aliased");
    await rm(join(temp, "test-alias.ts"));
    await link(join(repository, "src/answer.ts"), join(repository, "src/alias.ts"));
    await expect(inspectIntegrity(repository, baseline)).rejects.toThrow("aliased");
  });

  it("rejects a junction parent that redirects protected tests outside the repository", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    await rename(join(repository, "tests"), join(temp, "redirected-tests"));
    await symlink(join(temp, "redirected-tests"), join(repository, "tests"), process.platform === "win32" ? "junction" : "dir");
    await expect(inspectIntegrity(repository, baseline)).rejects.toThrow("aliased");
  });

  it("uses committed markers, allows unchanged ones and inventories newly introduced work", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    await put("src/answer.ts", "\n// TODO: preserve existing follow-up\nexport const answer = () => 43;\n");
    expect(await inspectIntegrity(repository, baseline)).toEqual([]);
    await put("src/new.ts", "// FIXME: follow up on diagnostics\nexport function run() { throw new Error('not implemented'); }\n");
    const findings = await inspectIntegrity(repository, baseline);
    expect(findings).toEqual([
      { code: "incomplete_work", severity: "warning", file: "src/new.ts", line: 1, marker: "fixme" },
      { code: "incomplete_work", severity: "blocking", file: "src/new.ts", line: 2, marker: "unimplemented" },
    ]);
    expect(JSON.stringify(findings)).not.toContain("diagnostics");
  });

  it("finds a multiline unimplemented throw at its statement line", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    await put("src/multiline.ts", "export function run() {\n  throw new Error(\n    'Not implemented yet'\n  );\n}\n");
    expect(await inspectIntegrity(repository, baseline)).toEqual([
      { code: "incomplete_work", severity: "blocking", file: "src/multiline.ts", line: 2, marker: "unimplemented" },
    ]);
  });

  it("does not adopt dirty source markers as a trusted baseline", async () => {
    await put("src/answer.ts", "export function run() { throw new Error('not implemented'); }\n");
    const baseline = await captureIntegrityBaseline(repository);
    expect(await inspectIntegrity(repository, baseline)).toEqual([
      { code: "incomplete_work", severity: "blocking", file: "src/answer.ts", line: 1, marker: "unimplemented" },
    ]);
  });

  it("finds newly incomplete source even when an index flag hides its diff", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    await git(repository, "update-index", "--assume-unchanged", "src/answer.ts");
    await put("src/answer.ts", "export function answer() { throw new Error('not implemented'); }\n");
    expect(await git(repository, "diff", "--name-only", "HEAD")).toBe("");
    expect(await inspectIntegrity(repository, baseline)).toEqual([
      { code: "incomplete_work", severity: "blocking", file: "src/answer.ts", line: 1, marker: "unimplemented" },
    ]);
  });

  it("allows pre-existing executable markers but detects additional copies", async () => {
    const existing = "export function later() { throw new Error('not implemented'); }\n";
    await put("src/later.ts", existing);
    await commit();
    const baseline = await captureIntegrityBaseline(repository);
    await put("src/later.ts", existing + existing);
    expect(await inspectIntegrity(repository, baseline)).toEqual([
      { code: "incomplete_work", severity: "blocking", file: "src/later.ts", line: 2, marker: "unimplemented" },
    ]);
  });

  it("flags explicit implementation stubs without rejecting intentional mocks or success results", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    await put("src/stub.py", "# implementation stub\ndef answer():\n    raise NotImplementedError()\n");
    await put("src/mock.ts", "export const mockClient = () => ({ success: true });\n");
    expect(await inspectIntegrity(repository, baseline)).toEqual([
      { code: "incomplete_work", severity: "blocking", file: "src/stub.py", line: 1, marker: "stub" },
      { code: "incomplete_work", severity: "blocking", file: "src/stub.py", line: 3, marker: "unimplemented" },
    ]);
  });

  it("fails closed on source inventory limits without exposing source content", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    await put("src/large.ts", "PRIVATE_CONTENT".repeat(100000));
    await expect(inspectIntegrity(repository, baseline)).rejects.toThrow("size limit");
    const content = await readFile(join(repository, "src/large.ts"), "utf8");
    expect(content.length).toBeGreaterThan(1024 * 1024);
  });

  it("rejects a baseline captured in a different repository", async () => {
    const baseline = await captureIntegrityBaseline(repository);
    await expect(inspectIntegrity(repository, { ...baseline, workspace: join(temp, "another") })).rejects.toThrow("another workspace");
  });
});
