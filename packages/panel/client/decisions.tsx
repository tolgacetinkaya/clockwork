import { t, useI18n } from "./i18n.js";
import { ArrowUpRight, CornerDownLeft } from "lucide-react";
import type { PanelCommand, PanelSnapshot } from "../src/protocol.js";
import { usePanelUI } from "./state.js";
import { title, time } from "./format.js";
import { Empty, SectionHeading } from "./ui.js";
import { checkpointDetails } from "./checkpoint-details.js";
import { PageHeading } from "./work.js";

export function Decisions({
  snapshot,
  submit,
  busy,
  disabled,
}: {
  snapshot: PanelSnapshot;
  submit: (command: PanelCommand) => Promise<void>;
  busy: boolean;
  disabled: boolean;
}) {
  useI18n();
  const answer = usePanelUI((s) => s.answerDraft),
    setAnswer = usePanelUI((s) => s.setAnswerDraft);
  const queuedAnswer = snapshot.queue.queued.some(
    (command) => command.type === "answer_questions",
  );
  return (
    <>
      <PageHeading
        eyebrow={t("THE HUMAN IN THE LOOP")}
        title={t("A little clarity goes a long way.")}
        subtitle={t("Answer questions, resolve checkpoints, and see which requests are still waiting for the orchestrator.")}
      />
      <div className="decisions-grid">
        <div>
          {snapshot.state.pendingQuestions.length ? (
            <section className="surface decision-card">
              <span className="eyebrow">{t("QUESTIONS FROM THE RUN")}</span>
              <h2>{t("The team needs your perspective.")}</h2>
              <ol>
                {snapshot.state.pendingQuestions.map((question, index) => (
                  <li key={`${index}-${question}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {question}
                  </li>
                ))}
              </ol>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit({
                    type: "answer_questions",
                    data: { text: answer },
                  })
                    .then(() => setAnswer(""))
                    .catch(() => {});
                }}
              >
                <label htmlFor="answer">{t("Your answers")}</label>
                <textarea
                  id="answer"
                  maxLength={6000}
                  rows={5}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder={t("Add the context that will help the team move forward…")}
                  disabled={disabled || queuedAnswer}
                />
                <button
                  className="primary-button"
                  disabled={disabled || busy || queuedAnswer || !answer.trim()}
                >
                  {queuedAnswer ? t("Answer queued") : t("Send answers")}
                  <CornerDownLeft size={15} />
                </button>
              </form>
              <p className="small-muted">{t("Questions stay open until the orchestrator records your answer.")}</p>
            </section>
          ) : null}
          {snapshot.state.openCheckpoints.map((checkpoint) => {
            const details = checkpointDetails(snapshot.events, checkpoint.ref);
            const queued = snapshot.queue.queued.some(
              (command) =>
                command.type === "resolve_checkpoint" &&
                command.data.ref === checkpoint.ref,
            );
            return (
              <section key={checkpoint.ref} className="surface checkpoint-card">
                <div>
                  <span className="eyebrow">
                    {checkpoint.blocking ? t("BLOCKING CHECKPOINT") : t("MILESTONE")}
                  </span>
                  <h2>{checkpoint.ref.startsWith("team-") ? t("Team recovery required") : title(checkpoint.ref)}</h2>
                  <p>
                    {details.message ?? (checkpoint.blocking
                      ? t("This gate needs a resolution before dependent work can continue.")
                      : t("Review this milestone with the orchestrator."))}
                  </p>
                  {details.failures.length ? <ul className="checkpoint-failures">
                    {details.failures.map(([unit, reason]) => <li key={unit}><strong>{unit}</strong>: {reason}</li>)}
                  </ul> : null}
                  {details.workspace ? <p>{t("Preserved integration workspace")}{" "}<code>{details.workspace}</code></p> : null}
                </div>
                <button
                  className="secondary-button"
                  disabled={disabled || busy || queued}
                  onClick={() => {
                    void submit({
                      type: "resolve_checkpoint",
                      data: { ref: checkpoint.ref },
                    }).catch(() => {});
                  }}
                >
                  {queued ? t("Resolution queued") : t("Request resolution")}
                  <ArrowUpRight size={15} />
                </button>
              </section>
            );
          })}
          {!snapshot.state.pendingQuestions.length &&
          !snapshot.state.openCheckpoints.length ? (
            <section className="surface">
              <Empty title={t("You're all caught up.")}>{t("No questions or checkpoints are waiting on you. The next decision will appear here.")}</Empty>
            </section>
          ) : null}
        </div>
        <aside className="surface queue-card">
          <SectionHeading
            eyebrow={t("THE RETURN CHANNEL")}
            title={t("Queued requests")}
            action={
              <span className="count-pill">{snapshot.queue.queued.length}</span>
            }
          />
          <p className="aside-copy">{t("Requests are durable. They take effect when the orchestrator handles and acknowledges them.")}</p>
          {snapshot.queue.queued.length ? (
            <div className="queue-list">
              {snapshot.queue.queued.map((command) => (
                <article key={command.seq}>
                  <div>
                    <span>#{command.seq}</span>
                    <strong>{t(title(command.type))}</strong>
                    <time>{time(command.ts)}</time>
                  </div>
                  <p>
                    {String(
                      command.data.text ??
                        command.data.note ??
                        command.data.ref ??
                        "",
                    )}
                  </p>
                  <span className="status status-pending">{t("Awaiting acknowledgment")}</span>
                </article>
              ))}
            </div>
          ) : (
            <p className="queue-empty">{t("No requests waiting.")}</p>
          )}
          <footer>{t("Acknowledged through")}{" "}<code>#{snapshot.queue.consumedSeq}</code>
          </footer>
        </aside>
      </div>
    </>
  );
}
