import { t, useI18n } from "./i18n.js";
export function verificationEvidence(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const report = record.report && typeof record.report === "object" ? record.report as Record<string, unknown> : {};
  const evidence = Array.isArray(report.evidence) ? report.evidence.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    return typeof entry.criterion === "string" && typeof entry.command === "string" && typeof entry.result === "string" && typeof entry.passed === "boolean" ? [{ criterion: entry.criterion, command: entry.command, result: entry.result, passed: entry.passed }] : [];
  }) : [];
  return { status: typeof record.status === "string" ? record.status : t("not recorded"), reason: typeof record.reason === "string" ? record.reason : null, findings: Array.isArray(report.findings) ? report.findings.filter((finding): finding is string => typeof finding === "string") : [], evidence };
}
export function IntegrationEvidence({ value, workspace }: { value?: unknown; workspace?: string }) {
  useI18n();
  const result = verificationEvidence(value);
  return <section className="surface mission-form"><h2>{t("Combined verification")}</h2>
    <p className="small-muted">{t("Accepted delivery, integration, and successful global acceptance checks are separate milestones.")}</p>
    <p>{value ? t("Combined checks: {status}", { status: t(result.status) }) : t("No combined verification result recorded")}</p>
    {result.reason ? <p>{result.reason}</p> : null}
    {result.findings.length ? <ul>{result.findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul> : null}
    {result.evidence.map((entry, index) => <article className="verification-evidence" key={index}>
      <strong>{entry.criterion}</strong><span className={`status ${entry.passed ? "status-accepted" : "status-failed"}`}>{entry.passed ? t("Passed") : t("Failed")}</span>
      <dl><dt>{t("Observed command")}</dt><dd><code>{entry.command}</code></dd><dt>{t("Observed result")}</dt><dd>{entry.result}</dd></dl>
    </article>)}
    {value && !result.evidence.length ? <p className="small-muted">{t("No per-criterion evidence recorded.")}</p> : null}
    {workspace ? <p>{t("Integration workspace")}{" "}<code>{workspace}</code></p> : null}
  </section>;
}
