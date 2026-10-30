import { describe, expect, it } from "vitest";
import type { ExecutionReport } from "@clockwork/core";
import { validateVerificationEvidence, type CommandReceipt } from "../src/evidence.js";

const receipt: CommandReceipt = {
  type: "command", id: "item_0", command: "node --test", exitCode: 0, status: "completed",
};
const report: ExecutionReport = {
  outcome: "accepted", summary: "Verified", findings: [],
  evidence: [{ criterion: "tests pass", command: "node --test", result: "passed", passed: true }],
};
describe("command-backed verification evidence", () => {
  it("requires a successful receipt with exact command text, ignoring edge whitespace only", () => {
    expect(validateVerificationEvidence(report, [receipt])).toEqual([]);
    expect(validateVerificationEvidence({ ...report, evidence: [{ ...report.evidence[0]!, command: "  node --test\n" }] }, [receipt])).toEqual([]);
    for (const command of ["node  --test", "NODE --test", "node --test extra", "node --test && true"]) {
      expect(validateVerificationEvidence({ ...report, evidence: [{ ...report.evidence[0]!, command }] }, [receipt])).not.toEqual([]);
    }
  });
  it("rejects self-reported success with no execution receipts", () => {
    expect(validateVerificationEvidence(report, [])).not.toEqual([]);
    expect(validateVerificationEvidence({ ...report, evidence: [] }, [receipt])).not.toEqual([]);
  });
  it("rejects nonzero receipts, failed statuses and a report's explicit failure", () => {
    expect(validateVerificationEvidence(report, [{ ...receipt, exitCode: 1 }])).not.toEqual([]);
    expect(validateVerificationEvidence(report, [{ ...receipt, status: "failed" }])).not.toEqual([]);
    expect(validateVerificationEvidence({ ...report, evidence: [{ ...report.evidence[0]!, passed: false }] }, [receipt])).not.toEqual([]);
  });
  it("uses the latest receipt for the exact command, including a later failure", () => {
    const failure: CommandReceipt = { ...receipt, id: "item_1", command: " node --test ", exitCode: 1, status: "failed" };
    expect(validateVerificationEvidence(report, [receipt, failure])).not.toEqual([]);
    expect(validateVerificationEvidence(report, [failure, { ...receipt, id: "item_2" }])).toEqual([]);
  });
  it("does not share receipts across verifier invocations", () => {
    expect(validateVerificationEvidence(report, [receipt])).toEqual([]);
    expect(validateVerificationEvidence(report, [])).not.toEqual([]);
  });
  it("rejects duplicate IDs, even for different commands", () => {
    expect(validateVerificationEvidence(report, [receipt, { ...receipt, command: "another command" }])).not.toEqual([]);
  });
  it.each([
    { id: "" }, { id: " item_0 " }, { id: "x".repeat(257) }, { id: "bad\nitem" },
    { command: " " }, { command: "x".repeat(65_537) }, { command: "bad\0command" },
    { exitCode: NaN }, { exitCode: Infinity }, { exitCode: 0.5 },
    { exitCode: Number.MAX_SAFE_INTEGER + 1 }, { exitCode: undefined },
    { status: "in_progress" }, { status: undefined },
  ])("fails closed on malformed custom adapter receipts without exposing data", (override) => {
    const findings = validateVerificationEvidence(report, [{ ...receipt, ...override } as CommandReceipt]);
    expect(findings).toEqual(["Verification command receipts are invalid or ambiguous"]);
  });
  it.each([
    { command: null }, { command: " " }, { passed: "true" }, { passed: undefined },
  ])("returns findings for malformed report evidence instead of throwing", (override) => {
    const malformed = { ...report, evidence: [{ ...report.evidence[0]!, ...override }] } as ExecutionReport;
    expect(validateVerificationEvidence(malformed, [receipt])).not.toEqual([]);
  });
  it("requires a receipt for every evidence claim", () => {
    expect(validateVerificationEvidence({ ...report, evidence: [
      ...report.evidence,
      { criterion: "build passes", command: "node build.js", result: "passed", passed: true },
    ] }, [receipt])).not.toEqual([]);
  });
});
