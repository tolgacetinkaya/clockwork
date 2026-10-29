import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { PanelSnapshot } from "../src/protocol.js";
import { usePanelUI } from "./state.js";
import { useI18n } from "./i18n.js";
import {
  companionState,
  companionPresentation,
  type CompanionObservation,
  petVariants,
  readPetPreferences,
} from "./companion-state.js";
import "./companion.css";

function storage() {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function Companion({ snapshot }: { snapshot?: PanelSnapshot }) {
  const { t, locale } = useI18n();
  const connection = usePanelUI(s => s.connection);
  const selectUnit = usePanelUI(s => s.selectUnit);
  const setView = usePanelUI(s => s.setView);
  const [prefs, setPrefs] = useState(() => readPetPreferences(storage()));
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const state = companionState(snapshot, connection);
  const previous = useRef<CompanionObservation | undefined>(undefined);
  const previousLocale = useRef(locale);
  const id = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const variant = petVariants.find(v => v.id === prefs.variant)!;

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  useEffect(() => {
    try {
      storage()?.setItem("clockwork.companion.v1", JSON.stringify(prefs));
    } catch { /* Preferences remain usable this session. */ }
  }, [prefs]);

  useEffect(() => {
    const observation = {
      stream: snapshot?.streamId,
      revision: snapshot?.revision ?? 0,
      kind: state.kind,
    };
    const presentation = companionPresentation(
      previous.current, observation, !prefs.muted && !prefs.hidden,
      previousLocale.current !== locale,
    );
    previous.current = observation;
    previousLocale.current = locale;
    if (presentation.action === "clear") setAnnouncement("");
    else if (presentation.action === "announce") setAnnouncement(t(presentation.message));
  }, [snapshot?.streamId, snapshot?.revision, state.kind, prefs.muted, prefs.hidden, locale]);

  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(""), 9000);
    return () => clearTimeout(timer);
  }, [announcement]);

  function close() {
    setOpen(false);
    launcher.current?.focus();
  }

  return (
    <aside
      className={`cw-companion ${prefs.hidden ? "is-hidden" : ""} state-${state.kind}`}
      style={{ "--pet-color": variant.color } as CSSProperties}
      aria-label={t("Clockwork companion")}
    >
      {announcement && (
        <div className="cw-pet-bubble">
          <span>{announcement}</span>
          <button
            aria-label={t("Dismiss update")}
            onClick={() => { setAnnouncement(""); launcher.current?.focus(); }}
          >×</button>
        </div>
      )}
      <span className="cw-pet-announcement" role="status" aria-live="polite">
        {announcement}
      </span>
      {open && (
        <section
          ref={panel} tabIndex={-1} id={id} className="cw-pet-panel"
          aria-label={t("Companion controls")}
          onKeyDown={event => { if (event.key === "Escape") close(); }}
        >
          <div className="cw-pet-heading">
            <strong>{t("Clockwork companion")}</strong>
            <button onClick={close} aria-label={t("Close companion")}>×</button>
          </div>
          <p className="cw-pet-status">{t(state.message)}</p>
          <p>{t("{accepted} of {total} units accepted", {
            accepted: state.accepted, total: state.total,
          })}</p>
          <p className="cw-pet-counts">{t("{workers} builders · {verifiers} verifiers", {
            workers: state.workers, verifiers: state.verifiers,
          })}</p>
          {state.tasks.slice(0, 3).map(unit => (
            <button className="cw-pet-task" key={unit} onClick={() => {
              setView("workboard");
              selectUnit(unit);
              close();
            }}>{t("Inspect task {id}", { id: unit })}</button>
          ))}
          {state.kind === "input" && (
            <button className="cw-pet-task" onClick={() => {
              setView("decisions"); close();
            }}>{t("Open decisions")}</button>
          )}
          <button className="cw-pet-task" onClick={() => {
            setView("team"); close();
          }}>{t("View team")}</button>
          <label className="cw-pet-select">
            {t("Creature")}
            <select value={prefs.variant} onChange={event => setPrefs({
              ...prefs, variant: event.target.value as typeof prefs.variant,
            })}>
              {petVariants.map(pet => (
                <option key={pet.id} value={pet.id}>{t(pet.name)}</option>
              ))}
            </select>
          </label>
          <label className="cw-pet-check">
            <input type="checkbox" checked={!prefs.muted} onChange={event =>
              setPrefs({ ...prefs, muted: !event.target.checked })
            } />
            {t("Announce status changes")}
          </label>
          <button className="cw-pet-task" onClick={() => {
            setPrefs({ ...prefs, hidden: !prefs.hidden }); close();
          }}>{t(prefs.hidden ? "Show creature" : "Hide creature")}</button>
        </section>
      )}
      <button
        ref={launcher} className="cw-pet-launcher" title={t(state.message)}
        aria-expanded={open} aria-controls={id}
        aria-label={t(prefs.hidden ? "Restore companion" : "Open companion")}
        onClick={() => {
          if (prefs.hidden) setPrefs({ ...prefs, hidden: false });
          setOpen(!open);
        }}
      >
        {prefs.hidden ? <span aria-hidden="true">⚙</span> : (
          <PetDrawing shape={variant.shape} kind={state.kind} />
        )}
        {!prefs.hidden && <span className="cw-pet-label">{t(state.message)}</span>}
      </button>
    </aside>
  );
}

function PetDrawing({ shape, kind }: {
  shape: typeof petVariants[number]["shape"];
  kind: CompanionObservation["kind"];
}) {
  const silhouette = shape === "moth"
    ? "M42 60Q0 30 19 82L42 88M98 60Q140 30 121 82L98 88"
    : shape === "scout"
      ? "M44 50L29 22L58 43M96 50L111 22L82 43"
      : "M41 89L23 103M99 89L117 103";
  return (
    <svg viewBox="0 0 140 130" aria-hidden="true">
      <ellipse className="cw-pet-shadow" cx="70" cy="117" rx="32" ry="5" />
      <g className="cw-pet-body">
        <path className="cw-pet-key" d="M112 66h12m-2-10v20m-6-20h12v20h-12z" />
        <path d={silhouette} fill="var(--pet-color)" stroke="#302d39" strokeWidth="4" />
        <path d="M48 96l-5 15m49-15 5 15" stroke="var(--pet-color)" strokeWidth="7" strokeLinecap="round" />
        <rect x="36" y="40" width="68" height="62" rx={shape === "rover" ? 18 : 30}
          fill="var(--pet-color)" stroke="#302d39" strokeWidth="4" />
        <path d="M70 39V26m-5-3h10" stroke="var(--pet-color)" strokeWidth="4" strokeLinecap="round" />
        <rect x="45" y="51" width="50" height="29" rx="14" fill="#292d3a" />
        <PetFace kind={kind} />
        <circle className="cw-pet-lamp" cx="70" cy="29" r="4" fill="#f9efd5" />
        <circle cx="42" cy="86" r="2" fill="#302d39" />
        <circle cx="98" cy="86" r="2" fill="#302d39" />
      </g>
    </svg>
  );
}

/** Faces remain legible without animation or color perception. */
function PetFace({ kind }: { kind: CompanionObservation["kind"] }) {
  const error = ["failed", "rework", "issues"].includes(kind);
  const passed = kind === "passed";
  const input = kind === "input";
  const verifying = kind === "verifying";
  const mouth = error ? "M64 91q6-6 12 0"
    : input ? "M67 87h6v6h-6z"
    : passed ? "M62 86q8 12 16 0"
    : "M64 88q6 5 12 0";
  return (
    <g className={`cw-pet-face face-${kind}`} strokeLinecap="round">
      {error ? (
        <path d="M54 60l8 9m0-9-8 9m24-9 8 9m0-9-8 9" stroke="#f7bfac" strokeWidth="3" />
      ) : passed ? (
        <path d="M53 66q5-9 10 0m14 0q5-9 10 0" stroke="#e8f6d8" strokeWidth="3" fill="none" />
      ) : (
        <g fill="#f9efd5">
          <ellipse cx="58" cy="65" rx={input ? 5 : 4} ry={input ? 8 : 6} />
          <ellipse cx="82" cy="65" rx="4" ry={input ? 8 : 6} />
        </g>
      )}
      {verifying && (
        <g fill="none" stroke="#8bd1d5" strokeWidth="2">
          <circle cx="82" cy="65" r="11" /><path d="M90 73l7 7" />
        </g>
      )}
      <path d={mouth} stroke="#302d39" fill="none" strokeWidth="3" />
    </g>
  );
}
