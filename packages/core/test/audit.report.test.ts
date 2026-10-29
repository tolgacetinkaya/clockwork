import { describe, expect, it } from "vitest";
import { parseNpmAuditJson } from "../src/audit/dependencies.js";
import { buildAuditReport, renderAuditReport } from "../src/audit/report.js";
import { scanSecrets } from "../src/audit/secrets.js";

describe("buildAuditReport", () => {
  it("is ok for a clean tree with no secrets and no dependency report", () => {
    const report = buildAuditReport({ secrets: [] });
    expect(report.decision).toBe("ok");
    expect(report.findings).toEqual([]);
  });

  it("rejects on any leaked secret — never merely caution", () => {
    const secret = "sk-zzzzzzzzzzzzzzzzzzzzzzzz";
    const secrets = scanSecrets([{ path: "src/config.ts", content: `const key = "${secret}";\n` }]);
    expect(secrets).toHaveLength(1);

    const dependencies = parseNpmAuditJson(JSON.stringify({ vulnerabilities: {} }));
    if (!dependencies.ok) throw new Error("expected ok dependency parse");

    const report = buildAuditReport({ secrets, dependencies: dependencies.summary });
    expect(report.decision).toBe("reject");
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ rule: "leaked-secret", path: "src/config.ts", line: 1 });

    // The raw secret must never leak into the report, in any field.
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(secret);
  });

  it("cautions on critical/high dependency vulnerabilities with no secrets", () => {
    const dependencies = parseNpmAuditJson(
      JSON.stringify({
        vulnerabilities: {
          lodash: { name: "lodash", severity: "critical", range: "<4.17.21", fixAvailable: true, via: [] },
          leftpad: { name: "leftpad", severity: "low", range: "*", fixAvailable: false, via: [] },
        },
      }),
    );
    if (!dependencies.ok) throw new Error("expected ok dependency parse");

    const report = buildAuditReport({ secrets: [], dependencies: dependencies.summary });
    expect(report.decision).toBe("caution");
    expect(report.dependencyCounts).toEqual({ info: 0, low: 1, moderate: 0, high: 0, critical: 1 });
    expect(report.summary).toContain("1 critical");
    expect(report.findings.some((f) => f.rule === "dependency-vulnerability" && f.path === "lodash")).toBe(true);
  });

  it("stays ok when only low/moderate dependency findings exist", () => {
    const dependencies = parseNpmAuditJson(
      JSON.stringify({
        vulnerabilities: {
          leftpad: { name: "leftpad", severity: "low", range: "*", fixAvailable: false, via: [] },
        },
      }),
    );
    if (!dependencies.ok) throw new Error("expected ok dependency parse");

    const report = buildAuditReport({ secrets: [], dependencies: dependencies.summary });
    expect(report.decision).toBe("ok");
  });

  it("sorts findings deterministically by path then line", () => {
    const secrets = scanSecrets([
      { path: "b.ts", content: 'const a = "sk-1111111111111111111111";\n' },
      { path: "a.ts", content: 'line\nconst b = "sk-2222222222222222222222";\n' },
    ]);
    const report = buildAuditReport({ secrets });
    expect(report.findings.map((f) => `${f.path}:${f.line}`)).toEqual(["a.ts:2", "b.ts:1"]);
  });
});

describe("renderAuditReport", () => {
  it("renders a clean-tree card", () => {
    const md = renderAuditReport(buildAuditReport({ secrets: [] }));
    expect(md).toContain("## Security Audit");
    expect(md).toContain("Decision: **OK**");
  });

  it("renders a reject card without leaking the secret", () => {
    const secret = "sk-yyyyyyyyyyyyyyyyyyyyyyyy";
    const secrets = scanSecrets([{ path: "config.ts", content: `const k = "${secret}";\n` }]);
    const md = renderAuditReport(buildAuditReport({ secrets }));
    expect(md).toContain("Decision: **REJECT**");
    expect(md).not.toContain(secret);
  });

  it("renders dependency severity counts", () => {
    const dependencies = parseNpmAuditJson(
      JSON.stringify({
        vulnerabilities: {
          lodash: { name: "lodash", severity: "critical", range: "<4.17.21", fixAvailable: true, via: [] },
        },
      }),
    );
    if (!dependencies.ok) throw new Error("expected ok dependency parse");
    const md = renderAuditReport(buildAuditReport({ secrets: [], dependencies: dependencies.summary }));
    expect(md).toContain("critical **1**");
    expect(md).toContain("| dependency-vulnerability | `lodash` |");
  });
});
