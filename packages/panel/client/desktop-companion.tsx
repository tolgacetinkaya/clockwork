import { Companion } from "./companion.js";
import { useLivePanel, useSnapshot } from "./live.js";
import "./desktop-companion.css";

/** Desktop owns one live subscription and one instance of the existing companion. */
export function DesktopCompanion() {
  useLivePanel();
  const { data: snapshot } = useSnapshot();
  return <main className="cw-desktop-companion"><Companion snapshot={snapshot} /></main>;
}
