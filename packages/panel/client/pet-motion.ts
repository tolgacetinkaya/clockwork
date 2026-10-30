import type { CompanionKind } from "./companion-state.js";

type PetAnimation = {
  x?: number | number[]; y?: number | number[]; rotate?: number | number[];
  scaleX?: number | number[]; scaleY?: number | number[];
  transition: { duration: number; ease?: "easeInOut"; repeat?: number; repeatDelay?: number };
};

export type PetReaction = "play" | "celebrate" | "alert" | null;

/** Passed/demo snapshots never imply a fresh celebratory event. */
export function petMotion(kind: CompanionKind, enabled: boolean, reaction: PetReaction): PetAnimation {
  if (!enabled) return { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1, transition: { duration: 0 } };
  if (reaction === "play" || reaction === "celebrate") return {
    x: [0, -5, 5, 0], y: [0, -26, -7, 0], rotate: [0, -10, 9, 0],
    scaleX: [1, 1.04, .96, 1], scaleY: [1, .96, 1.04, 1],
    transition: { duration: .8, ease: "easeInOut" },
  };
  if (reaction === "alert") return { rotate: [0, -8, 8, -4, 0], y: [0, -7, 0], transition: { duration: .7 } };
  if (kind === "working") return {
    x: [0, -8, 0, 8, 0], y: [0, -7, 0, -7, 0], rotate: [0, -4, 0, 4, 0],
    scaleY: [1, 1.025, 1, 1.025, 1], scaleX: 1,
    transition: { duration: 1.6, repeat: Infinity, ease: "easeInOut" },
  };
  if (kind === "verifying") return {
    x: [0, -3, -3, 0], y: [0, -3, -3, 0], rotate: [0, -7, -7, 0], scaleX: 1, scaleY: [1, 1.02, 1.02, 1],
    transition: { duration: 3.4, repeat: Infinity, repeatDelay: .4, ease: "easeInOut" },
  };
  // Breathing and an occasional curious look are cosmetic, including offline/demo.
  return {
    x: 0, y: [0, -3, 0, 0, 0], rotate: [0, 0, 0, 4, 0], scaleX: [1, 1.012, 1, 1, 1], scaleY: [1, 1.025, 1, 1, 1],
    transition: { duration: 5.5, repeat: Infinity, repeatDelay: .6, ease: "easeInOut" },
  };
}
