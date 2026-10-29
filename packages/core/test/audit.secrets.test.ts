import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { collectScannableFiles, scanSecrets } from "../src/audit/secrets.js";

describe("scanSecrets", () => {
  it("finds nothing in a clean tree", () => {
    expect(
      scanSecrets([
        { path: "README.md", content: "Hello world.\nNothing sensitive here.\n" },
      ]),
    ).toEqual([]);
  });

  it("locates a planted API key by path and line, with a redacted excerpt", () => {
    const secret = "sk-abcdefghijklmnopqrstuvwx";
    const findings = scanSecrets([
      {
        path: "config/settings.ts",
        content: `export const config = {\n  apiKey: "${secret}",\n  timeout: 30,\n};\n`,
      },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: "config/settings.ts", line: 2 });
    expect(findings[0]!.excerpt).toContain("[REDACTED]");
    expect(findings[0]!.excerpt).not.toContain(secret);

    // The raw secret must never appear anywhere in the serialized findings.
    expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it("sorts findings deterministically by path then line", () => {
    const secretA = "sk-aaaaaaaaaaaaaaaaaaaaaaaa";
    const secretB = "sk-bbbbbbbbbbbbbbbbbbbbbbbb";
    const findings = scanSecrets([
      { path: "z-file.ts", content: `const a = "${secretA}";\n` },
      { path: "a-file.ts", content: `line one\nconst b = "${secretB}";\n` },
    ]);

    expect(findings.map((f) => `${f.path}:${f.line}`)).toEqual(["a-file.ts:2", "z-file.ts:1"]);
  });
});

describe("collectScannableFiles", () => {
  async function makeTree(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "clockwork-audit-"));
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "left-pad"), { recursive: true });
    await mkdir(join(root, ".teamsmith"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "export const x = 1;\n", "utf8");
    await writeFile(join(root, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n", "utf8");
    await writeFile(join(root, ".teamsmith", "ledger.jsonl"), '{"type":"run.opened"}\n', "utf8");
    await writeFile(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return root;
  }

  it("skips node_modules, .teamsmith, and binary-ish extensions", async () => {
    const root = await makeTree();
    const files = await collectScannableFiles(root);

    expect(files.map((f) => f.path)).toEqual(["src/index.ts"]);
    expect(files[0]!.content).toBe("export const x = 1;\n");
  });

  it("returns forward-slash relative paths regardless of platform separator", async () => {
    const root = await makeTree();
    const files = await collectScannableFiles(root);
    expect(files[0]!.path.includes(sep) && sep !== "/").toBe(false);
  });

  it("honors the size cap", async () => {
    const root = await mkdtemp(join(tmpdir(), "clockwork-audit-cap-"));
    await writeFile(join(root, "small.txt"), "ok\n", "utf8");
    await writeFile(join(root, "big.txt"), "x".repeat(200), "utf8");

    const files = await collectScannableFiles(root, { maxBytes: 50 });

    expect(files.map((f) => f.path)).toEqual(["small.txt"]);
  });

  it("returns an empty list for a directory with nothing scannable", async () => {
    const root = await mkdtemp(join(tmpdir(), "clockwork-audit-empty-"));
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "node_modules", "junk.js"), "noop();\n", "utf8");

    expect(await collectScannableFiles(root)).toEqual([]);
  });
});
