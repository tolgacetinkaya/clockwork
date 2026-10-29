import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findInLibrary, listLibrary, saveToLibrary } from "../src/capability/library.js";

const AGENT_DEF = `---
name: backend-builder
description: Data layer and API implementation
model_tier: standard
provenance: generated
---

Backend builder agent body.
`;

describe("private library", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clockwork-library-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("saves an entry and stamps saved_at when absent", async () => {
    const clock = () => new Date("2026-07-17T00:00:00.000Z");
    const filePath = await saveToLibrary(dir, { name: "backend-builder", content: AGENT_DEF }, { clock });

    const listings = await listLibrary(dir);
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      name: "backend-builder",
      description: "Data layer and API implementation",
      model_tier: "standard",
      provenance: "generated", // frontmatter already had it — not overwritten
      saved_at: "2026-07-17T00:00:00.000Z",
      filePath,
    });
  });

  it("refuses to overwrite an existing entry unless overwrite: true", async () => {
    await saveToLibrary(dir, { name: "backend-builder", content: AGENT_DEF });
    await expect(saveToLibrary(dir, { name: "backend-builder", content: AGENT_DEF })).rejects.toThrow(/already exists/);

    await expect(
      saveToLibrary(dir, { name: "backend-builder", content: AGENT_DEF + "\nmore\n" }, { overwrite: true })
    ).resolves.toBeTruthy();
    const listings = await listLibrary(dir);
    expect(listings).toHaveLength(1);
  });

  it("stamps provenance as 'library' and applies tags when the source lacks them", async () => {
    const noProvenance = `---
name: docs-writer
description: Documentation
model_tier: cheap
---

Docs writer body.
`;
    await saveToLibrary(dir, { name: "docs-writer", content: noProvenance, tags: ["docs", "content"] });
    const listings = await listLibrary(dir);
    expect(listings[0]?.provenance).toBe("library");
    expect(listings[0]?.tags).toEqual(["docs", "content"]);
  });

  it("returns an empty list for a missing directory", async () => {
    expect(await listLibrary(join(dir, "missing"))).toEqual([]);
  });

  it("finds entries by case-insensitive query on name/description/tags", async () => {
    await saveToLibrary(dir, { name: "backend-builder", content: AGENT_DEF, tags: ["api", "database"] });
    await saveToLibrary(dir, {
      name: "frontend-builder",
      content: `---
name: frontend-builder
description: Frontend implementation
model_tier: standard
---

Frontend builder body.
`,
      tags: ["ui"],
    });

    const byDescription = await findInLibrary(dir, { query: "API IMPLEMENTATION" });
    expect(byDescription.map((e) => e.name)).toEqual(["backend-builder"]);

    const byTag = await findInLibrary(dir, { tags: ["ui"] });
    expect(byTag.map((e) => e.name)).toEqual(["frontend-builder"]);

    const noMatch = await findInLibrary(dir, { query: "nonexistent" });
    expect(noMatch).toEqual([]);
  });
});
