import { create } from "zustand";

export type View = "overview" | "mission" | "workboard" | "team" | "activity" | "decisions";
export type Filter = "all" | "active" | "waiting" | "accepted" | "attention";
export type Connection = "connecting" | "live" | "reconnecting" | "stale";
interface UIState {
  view: View;
  search: string;
  filter: Filter;
  selectedUnit: string | null;
  drawer: "note" | "stop" | null;
  noteDraft: string;
  answerDraft: string;
  connection: Connection;
  lastHeartbeat: number;
  notice: string | null;
  setView: (view: View) => void;
  setSearch: (search: string) => void;
  setFilter: (filter: Filter) => void;
  selectUnit: (selectedUnit: string | null) => void;
  setDrawer: (drawer: UIState["drawer"]) => void;
  setNoteDraft: (noteDraft: string) => void;
  setAnswerDraft: (answerDraft: string) => void;
  setConnection: (connection: Connection) => void;
  heartbeat: () => void;
  notify: (notice: string | null) => void;
}
/** UI state only. Domain state belongs exclusively to the Query snapshot cache. */
export const usePanelUI = create<UIState>((set) => ({
  view: "overview",
  search: "",
  filter: "all",
  selectedUnit: null,
  drawer: null,
  noteDraft: "",
  answerDraft: "",
  connection: "connecting",
  lastHeartbeat: 0,
  notice: null,
  setView: (view) => set({ view }),
  setSearch: (search) => set({ search }),
  setFilter: (filter) => set({ filter }),
  selectUnit: (selectedUnit) => set({ selectedUnit }),
  setDrawer: (drawer) => set({ drawer }),
  setNoteDraft: (noteDraft) => set({ noteDraft }),
  setAnswerDraft: (answerDraft) => set({ answerDraft }),
  setConnection: (connection) => set({ connection }),
  heartbeat: () => set({ lastHeartbeat: Date.now(), connection: "live" }),
  notify: (notice) => set({ notice }),
}));
