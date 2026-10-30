import type { CSSProperties } from "react";
import type { CompanionKind } from "./companion-state.js";
import type { PetReaction } from "./pet-motion.js";

export const pikoSpriteRows = { idle: 0, walk: 1, work: 2, attention: 3, success: 4 } as const;
export type PikoPose = keyof typeof pikoSpriteRows;

/** Cosmetics never turn a historical snapshot into a new success. */
export function pikoPose(kind: CompanionKind, enabled: boolean, reaction: PetReaction, dragging = false): PikoPose {
  if (!enabled) return "idle";
  if (dragging) return "walk";
  if (reaction === "celebrate") return "success";
  if (reaction === "play" || reaction === "alert") return "attention";
  if (kind === "working" || kind === "verifying") return "work";
  return "idle";
}

/** Original 4-column, 5-row atlas; percentages select cells without modifying pixels. */
export function PikoSprite({ kind, enabled, reaction, dragging = false }: {
  kind: CompanionKind; enabled: boolean; reaction: PetReaction; dragging?: boolean;
}) {
  const pose = pikoPose(kind, enabled, reaction, dragging);
  return <span aria-hidden="true" className={`cw-pet-character cw-piko-sprite pose-${pose}${enabled ? " is-animated" : ""}`}
    data-pose={pose} style={{ "--sprite-row": `${pikoSpriteRows[pose] * 25}%` } as CSSProperties} />;
}
