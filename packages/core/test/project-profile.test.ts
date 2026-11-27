import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadProjectProfile, prepareProjectEgress, projectProfilePrompt } from "../src/index.js";

it("detects new, removed, or modified profiles before the next dispatch", async () => {
  const project = await mkdtemp(join(tmpdir(), "clockwork-profile-"));
  try {
    const state = join(project, ".teamsmith");
    const file = join(state, "project-profile.json");
    const adapter = { assertProjectEgress: () => {} };
    const legacy = prepareProjectEgress(project, await loadProjectProfile(project), adapter);
    await legacy.assertCurrent();

    await mkdir(state);
    const rules = [{ id: "review-api", instruction: "Preserve the public response format." }];
    const config = { version: 1, rules, egress: { allowCodex: false, apiEndpoints: {} } };
    await writeFile(file, JSON.stringify(config));
    await expect(legacy.assertCurrent()).rejects.toThrow("Project profile changed");

    const profile = await loadProjectProfile(project);
    expect(profile?.receipt).toMatchObject({ version: 1, ruleIds: ["review-api"] });
    expect(projectProfilePrompt(profile)).toContain(rules[0]!.instruction);
    const managed = prepareProjectEgress(project, profile, adapter);
    await managed.assertCurrent();

    await writeFile(file, JSON.stringify({ ...config, egress: { ...config.egress, allowCodex: true } }));
    await expect(managed.assertCurrent()).rejects.toThrow("Project profile changed");
    await rm(file);
    await expect(managed.assertCurrent()).rejects.toThrow("Project profile changed");

    await writeFile(file, JSON.stringify({ ...config, rules: [rules[0], rules[0]] }));
    await expect(loadProjectProfile(project)).rejects.toThrow("Cannot load");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
