import type { ExecutionEvent, ExecutionReport } from "@clockwork/core";

export type CommandReceipt = Extract<ExecutionEvent, { type: "command" }>;

/** Compare claims with receipts from this verifier invocation; never run claims. */
export function validateVerificationEvidence(
  report: ExecutionReport,
  receipts: readonly CommandReceipt[],
): string[] {
  if (!Array.isArray(receipts))
    return ["Verification command receipts are invalid or ambiguous"];
  if (!report || !Array.isArray(report.evidence) || !report.evidence.length)
    return ["Verification has no command-backed acceptance evidence"];
  const latest = new Map<string, CommandReceipt>();
  const ids = new Set<string>();
  for (const receipt of receipts) {
    // Adapters are an execution boundary, but fail closed for malformed custom
    // adapters too. Findings intentionally contain neither command text nor IDs.
    if (
      !receipt ||
      receipt.type !== "command" ||
      typeof receipt.id !== "string" ||
      !receipt.id.trim() ||
      receipt.id !== receipt.id.trim() ||
      receipt.id.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(receipt.id) ||
      ids.has(receipt.id) ||
      typeof receipt.command !== "string" ||
      !receipt.command.trim() ||
      receipt.command.length > 65_536 ||
      receipt.command.includes("\0") ||
      typeof receipt.exitCode !== "number" ||
      !Number.isSafeInteger(receipt.exitCode) ||
      (receipt.status !== "completed" && receipt.status !== "failed")
    )
      return ["Verification command receipts are invalid or ambiguous"];
    ids.add(receipt.id);
    latest.set(receipt.command.trim(), receipt);
  }
  const findings: string[] = [];
  for (const [index, evidence] of report.evidence.entries()) {
    if (!evidence || typeof evidence.command !== "string" || !evidence.command.trim()) {
      findings.push(`Verification evidence ${index + 1} has an invalid command claim`);
      continue;
    }
    const receipt = latest.get(evidence.command.trim());
    if (evidence.passed !== true)
      findings.push(`Verification evidence ${index + 1} reports failure`);
    if (!receipt || receipt.status !== "completed" || receipt.exitCode !== 0)
      findings.push(`Verification evidence ${index + 1} lacks a successful observed command`);
  }
  return findings;
}
