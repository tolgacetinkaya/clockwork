import type { PanelSnapshot } from "../src/protocol.js";
import type { Connection } from "./state.js";
export const companionMessages = {
    offline: "Connection interrupted · showing last snapshot",
    loading: "Waiting for a snapshot",
    demo: "Recorded demo · no live agents",
    issues: "Snapshot needs attention",
    input: "Your input is needed",
    stopped: "Run stopped",
    stop_requested: "Stop requested · activity may continue",
    pause_requested: "Pause requested · activity may continue",
    paused: "Run paused",
    rework: "Work needs attention",
    working: "Production activity recorded",
    verifying: "Verification activity recorded",
    passed: "Combined verification passed",
    failed: "Combined verification failed",
    complete: "Run complete · combined checks not recorded",
    ungated: "Run complete · global gates not configured",
    idle: "Ready when you are",
} as const;
export function companionState(snapshot: PanelSnapshot | undefined, connection: Connection) {
    const units = Object.entries(snapshot?.state.units ?? {});
    const accepted = units.filter(([, u]) => u.status === "accepted").length;
    const active = connection === "live"
        && snapshot?.mode === "workspace"
        && !snapshot.state.outcome
        && !snapshot.state.paused
        && ![
        "completed", "stopped", "error"
    ].includes(snapshot.launch?.status ?? "");
    const workers = active ? snapshot.agents.filter(a => a.status === "working").length : 0;
    const verifiers = active ? snapshot.agents.filter(a => a.status === "verifying").length : 0;
    const tasks = active ? units.filter(([, u]) => u.status === "running" || u.status === "verifying").map(([id]) => id) : [];
    let kind: keyof typeof companionMessages = "idle";
    // A new launch can retain a previous result; only terminal launch evidence is current.
    const gate = snapshot?.launch?.status === "completed" ? snapshot.launch.result?.integrationVerification?.status : undefined;
    if (connection !== "live")
        kind = snapshot ? "offline" : "loading";
    else if (!snapshot)
        kind = "loading";
    else if (snapshot.mode === "recorded-demo")
        kind = "demo";
    else if (snapshot.issues.length || snapshot.state.anomalies.length)
        kind = "issues";
    else if (snapshot.state.pendingQuestions.length || snapshot.state.openCheckpoints.some(c => c.blocking))
        kind = "input";
    else if (snapshot.state.outcome === "abandoned" || snapshot.launch?.status === "stopped")
        kind = "stopped";
    else if (snapshot.state.paused)
        kind = "paused";
    else if (snapshot.control.kill && !snapshot.state.outcome && snapshot.launch?.status !== "completed")
        kind = "stop_requested";
    else if (snapshot.control.paused && !snapshot.state.outcome && snapshot.launch?.status !== "completed")
        kind = "pause_requested";
    else if (snapshot.launch?.status === "error" || units.some(([, u]) => u.status === "failed" || u.status === "rework"))
        kind = "rework";
    else if (workers)
        kind = "working";
    else if (verifiers)
        kind = "verifying";
    else if (gate === "failed")
        kind = "failed";
    else if (gate === "passed")
        kind = "passed";
    else if (snapshot.launch?.status !== "running" && (snapshot.state.outcome === "done" || snapshot.launch?.status === "completed"))
        kind = gate === "not_configured" ? "ungated" : "complete";
    return {
        kind,
        message: companionMessages[kind],
        accepted,
        total: units.length,
        workers,
        verifiers,
        tasks
    };
}
// Stable legacy IDs preserve existing saved creature choices.
export const petVariants = [
    { id: "brass", name: "Kara · Owl", color: "#e8b968", image: "/assets/arcade/owl.png" },
    { id: "mint", name: "Moss · Turtle", color: "#a7cc6c", image: "/assets/arcade/turtle.png" },
    { id: "violet", name: "Nova · Fox", color: "#bba3ee", image: "/assets/arcade/fox.png" },
    { id: "puffin", name: "Piko · Puffin", color: "#efb36f", image: "/assets/arcade/puffin.png" },
] as const;
export type PetPreferences = {
    version: 1;
    variant: typeof petVariants[number]["id"];
    hidden: boolean;
    muted: boolean;
};
export const defaultPetPreferences: PetPreferences = {
    version: 1,
    variant: "puffin",
    hidden: false,
    muted: true
};
export function readPetPreferences(storage?: {
    getItem: (key: string) => string | null;
}): PetPreferences {
    try {
        const p = JSON.parse(storage?.getItem("clockwork.companion.v1") ?? "null");
        if (p?.version === 1)
            return {
                version: 1,
                variant: petVariants.some(v => v.id === p.variant) ? p.variant : "puffin",
                hidden: p.hidden === true,
                muted: p.muted !== false
            };
    }
    catch { /* Session defaults survive denied or damaged storage. */
    }
    return {
        ...defaultPetPreferences
    };
}
export type CompanionKind = keyof typeof companionMessages;
export interface CompanionObservation {
    stream: string | undefined;
    revision: number;
    kind: CompanionKind;
}
const quietTransitions: readonly CompanionKind[] = [
    "working", "verifying", "idle", "loading", "demo"
];
/** Only announce newly observed transitions. Connection recovery never replays cached outcomes. */
export function companionAnnouncement(previous: CompanionObservation | undefined, current: CompanionObservation, enabled: boolean): string | undefined {
    if (!enabled || !previous || !current.stream || previous.stream !== current.stream)
        return;
    if (previous.kind === current.kind || quietTransitions.includes(current.kind))
        return;
    if (current.kind === "offline")
        return companionMessages.offline;
    if (previous.kind === "offline" || previous.kind === "loading")
        return;
    if (current.revision <= previous.revision)
        return;
    return companionMessages[current.kind];
}



export type CompanionPresentation =
  | { action: "announce"; message: string }
  | { action: "clear" }
  | { action: "keep" };

/** A heartbeat preserves a bubble; a changed context must never retain old guidance. */
export function companionPresentation(
  previous: CompanionObservation | undefined,
  current: CompanionObservation,
  enabled: boolean,
  localeChanged = false,
): CompanionPresentation {
  if (!enabled || localeChanged) return { action: "clear" };
  const message = companionAnnouncement(previous, current, enabled);
  if (message) return { action: "announce", message };
  if (!previous || previous.stream !== current.stream || previous.kind !== current.kind) {
    return { action: "clear" };
  }
  return { action: "keep" };
}
