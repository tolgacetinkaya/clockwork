import { useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "motion/react";

const visibilityListeners = new Set<() => void>();
const notifyVisibility = () => visibilityListeners.forEach(listener => listener());
function subscribeVisibility(listener: () => void) {
  if (!visibilityListeners.size) document.addEventListener("visibilitychange", notifyVisibility);
  visibilityListeners.add(listener);
  return () => {
    visibilityListeners.delete(listener);
    if (!visibilityListeners.size) document.removeEventListener("visibilitychange", notifyVisibility);
  };
}
const visibleSnapshot = () => document.visibilityState !== "hidden";
const serverVisibleSnapshot = () => true;

/** One shared visibility subscription; decorative loops stop off screen. */
export function useMotionEnabled() {
  const reduced = useReducedMotion();
  const visible = useSyncExternalStore(subscribeVisibility, visibleSnapshot, serverVisibleSnapshot);
  return visible && !reduced;
}

/** Cosmetic breathing never signals activity; stronger movement needs ledger activity. */
export function AnimatedPortrait({ src, active = false, alt = "", className }: {
  src: string; active?: boolean; alt?: string; className?: string;
}) {
  const enabled = useMotionEnabled();
  const phase = [...src].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 7 / 7;
  return <motion.img src={src} alt={alt} className={className}
    initial={false}
    animate={enabled ? active ? { y: [0, -7, 0], rotate: [0, -3, 0, 3, 0], scale: 1 }
      : { y: [0, -2, 0], rotate: 0, scale: [1, 1.018, 1] }
      : { y: 0, rotate: 0, scale: 1 }}
    transition={enabled ? { duration: active ? 1.8 : 4.8, delay: phase, repeat: Infinity, ease: "easeInOut" } : { duration: 0 }}
    whileHover={enabled ? { rotate: -5, scale: 1.07, transition: { type: "spring", stiffness: 250, damping: 14 } } : undefined}
    style={{ transformOrigin: "50% 85%" }} />;
}
