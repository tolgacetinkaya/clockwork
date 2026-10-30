export interface WorkArea { x: number; y: number; width: number; height: number }
export function normalizePanelUrl(raw?: string): string;
export function clampWindowBounds(saved: unknown, display: { workArea: WorkArea }): WorkArea;
