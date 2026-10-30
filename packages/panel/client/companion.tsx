import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Settings2, X, Eye, ShieldCheck, Heart, Sparkles } from "lucide-react";
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
import { AnimatePresence, motion } from "motion/react";
import { useMotionEnabled } from "./animations.js";
import { PikoSprite } from "./piko-sprite.js";
import { petMotion, type PetReaction } from "./pet-motion.js";
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
  const motionEnabled = useMotionEnabled();
  const [reaction, setReaction] = useState<PetReaction>(null);
  const [playCount, setPlayCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  useEffect(() => window.clockworkDesktop?.onDragging?.(setDragging), []);
  useEffect(() => {
    if (!reaction) return;
    const timer = setTimeout(() => setReaction(null), 1000);
    return () => clearTimeout(timer);
  }, [reaction, playCount]);
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
    const visual = companionPresentation(previous.current, observation, !prefs.hidden, previousLocale.current !== locale);
    if (visual.action === "announce") {
      if (state.kind === "passed") setReaction("celebrate");
      else if (["input", "failed", "rework", "issues"].includes(state.kind)) setReaction("alert");
    } else if (visual.action === "clear") setReaction(null);
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
      <div className="cw-pet-heading">
        <div><strong>{t(variant.name).split(" · ")[0]}</strong><small>{t("Clockwork companion")}</small></div>
        <button ref={launcher} className="cw-pet-settings" aria-expanded={open} aria-controls={id}
          aria-label={t(prefs.hidden ? "Restore companion" : "Open companion")}
          onClick={() => { if (prefs.hidden) setPrefs({ ...prefs, hidden: false }); setOpen(!open); }}>
          {prefs.hidden ? <Eye size={16} /> : <Settings2 size={16} />}
        </button>
      </div>
      {!prefs.hidden && <>
        <div className="cw-pet-scene">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={`${locale}-${state.kind}`} className="cw-pet-bubble"
              initial={{ opacity: 0, y: !motionEnabled ? 0 : 5 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: !motionEnabled ? 0 : -4 }} transition={{ duration: !motionEnabled ? 0 : .18 }}>
              {t(state.message)}
            </motion.p>
          </AnimatePresence>
          <div className="cw-pet-ground" aria-hidden="true" />
          <motion.button type="button" className="cw-pet-play" aria-label={t(variant.name)}
            onClick={() => { setPlayCount(count => count + 1); setReaction("play"); }}
            whileHover={!motionEnabled ? undefined : { scale: 1.035 }} whileTap={!motionEnabled ? undefined : { scale: .96 }}>
            {variant.id === "puffin" ? <PikoSprite key={playCount} kind={state.kind} enabled={motionEnabled} reaction={reaction} dragging={dragging} /> :
              <motion.img key={`${variant.id}-${playCount}`} className="cw-pet-character" src={variant.image} alt="" width="180" height="180"
                animate={petMotion(state.kind, motionEnabled, reaction)} draggable={false} />}

          </motion.button>
          <AnimatePresence>
            {reaction === "play" && motionEnabled && [0, 1, 2].map(index => (
              <motion.span key={`${playCount}-${index}`} className="cw-pet-delight" aria-hidden="true"
                style={{ right: `${30 + index * 34}px` }} initial={{ opacity: 0, y: 0, scale: .5 }}
                animate={{ opacity: [0, 1, 0], y: -65 - index * 9, scale: [ .5, 1.1, .8 ], rotate: index % 2 ? 15 : -15 }}
                exit={{ opacity: 0 }} transition={{ duration: .95, delay: index * .08 }}>
                {index === 1 ? <Heart size={16} fill="currentColor" /> : <Sparkles size={17} />}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
        <p className="cw-pet-summary"><ShieldCheck size={14} aria-hidden="true" />{t("{accepted} of {total} units accepted", { accepted: state.accepted, total: state.total })}</p>
      </>}
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
            <button onClick={close} aria-label={t("Close companion")}><X size={16} /></button>
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

    </aside>
  );
}
