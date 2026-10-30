export type PetPlacement = { version: 1; mode: "floating" | "docked"; x: number; y: number };
export const petPlacementStorageKey = "clockwork.companion.position.v1";

/** Preferences are optional and untrusted; unavailable storage never blocks the pet. */
export function readPetPlacement(storage?: { getItem(key: string): string | null }): PetPlacement | null {
  try {
    const raw = storage?.getItem(petPlacementStorageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const placement = value as Partial<PetPlacement>;
    if (placement.version !== 1 || (placement.mode !== "floating" && placement.mode !== "docked") ||
      typeof placement.x !== "number" || !Number.isFinite(placement.x) ||
      typeof placement.y !== "number" || !Number.isFinite(placement.y)) return null;
    return { version: 1, mode: placement.mode, x: placement.x, y: placement.y };
  } catch { return null; }
}

type Position = { x: number; y: number };
type Size = { width: number; height: number };
/** Reconcile saved or dragged coordinates with the current viewport after resize.
 * Oversized pets anchor at zero; margins shrink when space cannot accommodate them.
 */
export function clampPetPosition(position: Position, viewport: Size, pet: Size, margin = 8): Position {
  const finiteSize = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  const inset = finiteSize(margin);
  const axis = (coordinate: number, available: number, size: number) => {
    const room = Math.max(0, finiteSize(available) - finiteSize(size));
    const minimum = Math.min(inset, room / 2);
    return Math.min(Math.max(Number.isFinite(coordinate) ? coordinate : minimum, minimum), room - minimum);
  };
  return { x: axis(position.x, viewport.width, pet.width), y: axis(position.y, viewport.height, pet.height) };
}
