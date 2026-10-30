export {};

declare global {
  interface Window {
    /** Set exclusively by the isolated desktop host preload. */
    readonly clockworkDesktop?: Readonly<{ isDesktop: true; onDragging?: (callback: (dragging: boolean) => void) => () => void }>;
  }
}
