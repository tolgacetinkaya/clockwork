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
  const answer = usePanelUI((s) => s.answerDraft),
    setAnswer = usePanelUI((s) => s.setAnswerDraft);
  const queuedAnswer = snapshot.queue.queued.some(
    (command) => command.type === "answer_questions",
  );
  return (
    <>
      <PageHeading
        eyebrow="THE HUMAN IN THE LOOP"
        title="A little clarity goes a long way."
        subtitle="Answer questions, resolve checkpoints, and see which requests are still waiting for the orchestrator."
      />
      <div className="decisions-grid">
        <div>
          {snapshot.state.pendingQuestions.length ? (
            <section className="surface decision-card">
              <span className="eyebrow">QUESTIONS FROM THE RUN</span>
              <h2>The team needs your perspective.</h2>
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
                <label htmlFor="answer">Your answers</label>
                <textarea
                  id="answer"
                  maxLength={6000}
                  rows={5}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Add the context that will help the team move forward…"
                  disabled={disabled || queuedAnswer}
                />
                <button
                  className="primary-button"
                  disabled={disabled || busy || queuedAnswer || !answer.trim()}
                >
                  {queuedAnswer ? "Answer queued" : "Send answers"}
                  <CornerDownLeft size={15} />
                </button>
              </form>
              <p className="small-muted">
                Questions stay open until the orchestrator records your answer.
              </p>
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
                    {checkpoint.blocking ? "BLOCKING CHECKPOINT" : "MILESTONE"}
                  </span>
                  <h2>{checkpoint.ref.startsWith("team-") ? "Team recovery required" : title(checkpoint.ref)}</h2>
                  <p>
                    {details.message ?? (checkpoint.blocking
                      ? "This gate needs a resolution before dependent work can continue."
                      : "Review this milestone with the orchestrator.")}
                  </p>
                  {details.failures.length ? <ul className="checkpoint-failures">
                    {details.failures.map(([unit, reason]) => <li key={unit}><strong>{unit}</strong>: {reason}</li>)}
                  </ul> : null}
                  {details.workspace ? <p>Preserved integration workspace <code>{details.workspace}</code></p> : null}
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
                  {queued ? "Resolution queued" : "Request resolution"}
                  <ArrowUpRight size={15} />
                </button>
              </section>
            );
          })}
          {!snapshot.state.pendingQuestions.length &&
          !snapshot.state.openCheckpoints.length ? (
            <section className="surface">
              <Empty title="You're all caught up.">
                No questions or checkpoints are waiting on you. The next
                decision will appear here.
              </Empty>
            </section>
          ) : null}
        </div>
        <aside className="surface queue-card">
          <SectionHeading
            eyebrow="THE RETURN CHANNEL"
            title="Queued requests"
            action={
              <span className="count-pill">{snapshot.queue.queued.length}</span>
            }
          />
          <p className="aside-copy">
            Requests are durable. They take effect when the orchestrator handles
            and acknowledges them.
          </p>
          {snapshot.queue.queued.length ? (
            <div className="queue-list">
              {snapshot.queue.queued.map((command) => (
                <article key={command.seq}>
                  <div>
                    <span>#{command.seq}</span>
                    <strong>{title(command.type)}</strong>
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
                  <span className="status status-pending">
                    Awaiting acknowledgment
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="queue-empty">No requests waiting.</p>
          )}
          <footer>
            Acknowledged through <code>#{snapshot.queue.consumedSeq}</code>
          </footer>
        </aside>
      </div>
    </>
  );
}
