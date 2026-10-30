import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";
import { motion, useMotionValue } from "motion/react";
import { GripHorizontal, PanelBottom, RotateCcw, MoveUpRight } from "lucide-react";
import type { PanelSnapshot } from "../src/protocol.js";
import { Companion } from "./companion.js";
import { useI18n } from "./i18n.js";
import { clampPetPosition, readPetPlacement } from "./companion-position.js";
import "./floating-companion.css";

export function FloatingCompanion({ snapshot }: { snapshot?: PanelSnapshot }) {
  const { t } = useI18n();
  const [initial] = useState(() => {
    try { return readPetPlacement(window.localStorage); } catch { return null; }
  });
  const [mode, setMode] = useState(initial?.mode ?? "floating");
  const [ready, setReady] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const x = useMotionValue(initial?.x ?? 0), y = useMotionValue(initial?.y ?? 0);
  const drag = useRef<{ id: number; pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const initialized = useRef(false);
  const persist = useCallback((nextMode = mode) => {
    try { window.localStorage.setItem("clockwork.companion.position.v1", JSON.stringify({ version: 1, mode: nextMode, x: x.get(), y: y.get() })); } catch { /* Session-only positioning remains usable. */ }
  }, [mode, x, y]);
  const place = useCallback((nextX: number, nextY: number) => {
    if (!box.current) return;
    const bounds = box.current.getBoundingClientRect();
    const next = clampPetPosition({ x: nextX, y: nextY }, { width: window.innerWidth, height: window.innerHeight }, bounds);
    x.set(next.x); y.set(next.y);
  }, [x, y]);
  const reset = useCallback(() => { place(window.innerWidth, window.innerHeight); persist(); }, [place, persist]);
  useEffect(() => {
    if (mode !== "floating") return;
    const measure = () => {
      if (!initialized.current && !initial) place(window.innerWidth, window.innerHeight);
      else place(x.get(), y.get());
      initialized.current = true;
      setReady(true); persist();
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (box.current) observer.observe(box.current);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [mode, initial, place, persist, x, y]);
  function begin(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, pointerX: event.clientX, pointerY: event.clientY, x: x.get(), y: y.get() };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (start?.id === event.pointerId) place(start.x + event.clientX - start.pointerX, start.y + event.clientY - start.pointerY);
  }
  function finish() { if (drag.current) { drag.current = null; persist(); } }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const amount = event.shiftKey ? 64 : 16;
    const delta = { ArrowLeft: [-amount, 0], ArrowRight: [amount, 0], ArrowUp: [0, -amount], ArrowDown: [0, amount] }[event.key];
    if (delta) { event.preventDefault(); place(x.get() + delta[0]!, y.get() + delta[1]!); persist(); }
    if (event.key === "Home") { event.preventDefault(); reset(); }
  }
  function changeMode() {
    const next = mode === "floating" ? "docked" : "floating";
    setMode(next); persist(next);
  }
  const toolbar = <div className="cw-float-toolbar">
    {mode === "floating" && <button type="button" className="cw-float-grip" aria-label={t("Move companion")} title={t("Drag to move; arrow keys move by 16 pixels.")}
      onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={keyboard}>
      <GripHorizontal size={20} aria-hidden="true"/><span>{t("Move companion")}</span>
    </button>}
    <button type="button" aria-label={t(mode === "floating" ? "Dock companion" : "Float companion")} title={t(mode === "floating" ? "Dock companion" : "Float companion")} onClick={changeMode}>
      {mode === "floating" ? <PanelBottom size={16}/> : <MoveUpRight size={16}/>}</button>
    {mode === "floating" && <button type="button" aria-label={t("Reset companion position")} title={t("Reset companion position")} onClick={reset}><RotateCcw size={15}/></button>}
  </div>;
  if (mode === "docked") return <div className="cw-companion-docked">{toolbar}<Companion snapshot={snapshot}/></div>;
  if (typeof document === "undefined") return null;
  return createPortal(<motion.div ref={box} className="cw-companion-floating" style={{ x, y, visibility: ready ? "visible" : "hidden" }}>
    {toolbar}<Companion snapshot={snapshot}/>
  </motion.div>, document.body);
}
