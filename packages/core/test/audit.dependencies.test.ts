import { describe, expect, it } from "vitest";
import { parseNpmAuditJson } from "../src/audit/dependencies.js";

describe("parseNpmAuditJson", () => {
  it("parses the npm 8+ vulnerabilities map shape", () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        lodash: {
          name: "lodash",
          severity: "high",
          range: "<4.17.21",
          fixAvailable: true,
          via: [{ title: "Prototype Pollution", severity: "high" }],
        },
        minimist: {
          name: "minimist",
          severity: "critical",
          range: "<1.2.6",
          fixAvailable: { name: "minimist", version: "1.2.6", isSemVerMajor: false },
          via: ["yargs-parser"],
        },
      },
    });

    const result = parseNpmAuditJson(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    expect(result.summary.total).toBe(2);
    expect(result.summary.counts).toEqual({ info: 0, low: 0, moderate: 0, high: 1, critical: 1 });
    // Deterministic ordering by package name.
    expect(result.summary.vulnerabilities.map((v) => v.name)).toEqual(["lodash", "minimist"]);
    expect(result.summary.vulnerabilities[0]).toMatchObject({ name: "lodash", severity: "high", fixAvailable: true });
    expect(result.summary.vulnerabilities[1]).toMatchObject({ name: "minimist", severity: "critical", fixAvailable: true });
    expect(result.summary.vulnerabilities[0]!.via).toEqual(["Prototype Pollution"]);
  });

  it("treats a missing vulnerabilities field as a clean report", () => {
    const result = parseNpmAuditJson(JSON.stringify({ metadata: { vulnerabilities: {} } }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.summary.total).toBe(0);
    expect(result.summary.vulnerabilities).toEqual([]);
  });

  it("treats an empty vulnerabilities map as a clean report", () => {
    const result = parseNpmAuditJson(JSON.stringify({ vulnerabilities: {} }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.summary.total).toBe(0);
  });

  it("returns a typed error for garbage input instead of throwing", () => {
    expect(() => parseNpmAuditJson("not json at all {{{")).not.toThrow();
    const result = parseNpmAuditJson("not json at all {{{");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error result");
    expect(result.error).toMatch(/json/i);
  });

  it("returns a typed error when vulnerabilities is not an object", () => {
    const result = parseNpmAuditJson(JSON.stringify({ vulnerabilities: "nope" }));
    expect(result.ok).toBe(false);
  });

  it("returns a typed error for a top-level non-object", () => {
    expect(parseNpmAuditJson("[1,2,3]").ok).toBe(false);
    expect(parseNpmAuditJson("42").ok).toBe(false);
    expect(parseNpmAuditJson('"string"').ok).toBe(false);
  });

  it("skips malformed individual entries without failing the whole parse", () => {
    const result = parseNpmAuditJson(
      JSON.stringify({
        vulnerabilities: {
          good: { name: "good", severity: "moderate", range: "*", fixAvailable: false, via: [] },
          bad: { name: "bad", severity: "not-a-real-severity" },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.summary.total).toBe(1);
    expect(result.summary.vulnerabilities[0]!.name).toBe("good");
  });
});
