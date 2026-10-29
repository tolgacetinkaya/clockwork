import { describe, expect, it } from "vitest";
import { appendConfirmation, parsePlaybookMeta, promoteToConfirmed } from "../src/recall/playbook.js";

const AUTO_DRAFT = `---
id: web-saas
applies_to: [web app, saas]
version: 1
provenance: auto-draft
---
## Typical work layers
Some content.
`;

describe("parsePlaybookMeta", () => {
  it("parses frontmatter fields", () => {
    const meta = parsePlaybookMeta(AUTO_DRAFT);
    expect(meta.id).toBe("web-saas");
    expect(meta.applies_to).toEqual(["web app", "saas"]);
    expect(meta.version).toBe(1);
    expect(meta.provenance).toBe("auto-draft");
    expect(meta.confirmations).toBe(0);
    expect(meta.confirmedRunIds).toEqual([]);
  });

  it("counts confirmation markers in the body", () => {
    const content = `${AUTO_DRAFT}<!-- confirmed by run:run-1 -->\n<!-- confirmed by run:run-2 -->\n`;
    const meta = parsePlaybookMeta(content);
    expect(meta.confirmations).toBe(2);
    expect(meta.confirmedRunIds).toEqual(["run-1", "run-2"]);
  });

  it("tolerates content with no frontmatter", () => {
    const meta = parsePlaybookMeta("just a body with no frontmatter\n");
    expect(meta.id).toBeUndefined();
    expect(meta.provenance).toBeUndefined();
    expect(meta.confirmations).toBe(0);
  });

  it("tolerates malformed YAML frontmatter without throwing", () => {
    const content = "---\nid: [unterminated\n---\nbody\n";
    const meta = parsePlaybookMeta(content);
    expect(meta.confirmations).toBe(0);
    expect(meta.id).toBeUndefined();
  });
});

describe("appendConfirmation", () => {
  it("appends a confirmation marker for a new run id", () => {
    const result = appendConfirmation(AUTO_DRAFT, "run-1");
    expect(result).toContain("<!-- confirmed by run:run-1 -->");
    expect(parsePlaybookMeta(result).confirmations).toBe(1);
  });

  it("is idempotent for the same run id", () => {
    const once = appendConfirmation(AUTO_DRAFT, "run-1");
    const twice = appendConfirmation(once, "run-1");
    expect(twice).toBe(once);
    expect(parsePlaybookMeta(twice).confirmations).toBe(1);
  });

  it("accumulates markers for distinct run ids", () => {
    const first = appendConfirmation(AUTO_DRAFT, "run-1");
    const second = appendConfirmation(first, "run-2");
    expect(parsePlaybookMeta(second).confirmedRunIds).toEqual(["run-1", "run-2"]);
  });
});

describe("promoteToConfirmed", () => {
  it("promotes auto-draft to confirmed once two confirmations are present", () => {
    const withTwo = appendConfirmation(appendConfirmation(AUTO_DRAFT, "run-1"), "run-2");
    const promoted = promoteToConfirmed(withTwo);
    expect(parsePlaybookMeta(promoted).provenance).toBe("confirmed");
    // the two confirmation markers are preserved
    expect(parsePlaybookMeta(promoted).confirmations).toBe(2);
  });

  it("does not promote with fewer than two confirmations", () => {
    const withOne = appendConfirmation(AUTO_DRAFT, "run-1");
    const result = promoteToConfirmed(withOne);
    expect(result).toBe(withOne);
    expect(parsePlaybookMeta(result).provenance).toBe("auto-draft");
  });

  it("leaves non-auto-draft provenance untouched", () => {
    const builtin = AUTO_DRAFT.replace("provenance: auto-draft", "provenance: builtin");
    const withTwo = appendConfirmation(appendConfirmation(builtin, "run-1"), "run-2");
    const result = promoteToConfirmed(withTwo);
    expect(result).toBe(withTwo);
  });

  it("is a no-op when there is no frontmatter", () => {
    const content = "no frontmatter here\n<!-- confirmed by run:run-1 -->\n<!-- confirmed by run:run-2 -->\n";
    expect(promoteToConfirmed(content)).toBe(content);
  });
});

describe("legacy confirmation markers", () => {
  it("counts pre-module bare markers and stays idempotent across both forms", async () => {
    const { appendConfirmation, parsePlaybookMeta } = await import("../src/recall/playbook.js");
    const legacy = "---\nid: cli-tool\nprovenance: auto-draft\n---\nbody\n<!-- confirmed by run-mdtoc-2 -->\n";
    const meta = parsePlaybookMeta(legacy);
    expect(meta.confirmations).toBe(1);
    expect(meta.confirmedRunIds).toEqual(["run-mdtoc-2"]);
    // appending the same run id in canonical form is a no-op
    expect(appendConfirmation(legacy, "run-mdtoc-2")).toBe(legacy);
  });
});
