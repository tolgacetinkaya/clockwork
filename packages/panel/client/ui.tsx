import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import {
  X,
  ArrowUpRight,
  CircleCheck,
  Circle,
  LoaderCircle,
  AlertCircle,
  Ban,
  Clock3,
} from "lucide-react";
import { title } from "./format.js";

export function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 36 36" fill="none">
        <path
          d="M18 6v5m0 14v5M6 18h5m14 0h5M9.5 9.5l3.6 3.6m9.8 9.8 3.6 3.6m0-17-3.6 3.6m-9.8 9.8-3.6 3.6"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle
          cx="18"
          cy="18"
          r="6.5"
          stroke="currentColor"
          strokeWidth="2.5"
        />
      </svg>
    </span>
  );
}
export function Avatar({
  name,
  index = 0,
  small = false,
}: {
  name: string;
  index?: number;
  small?: boolean;
}) {
  const words = name
    .replace(/^builder-/, "")
    .split(/[-_ ]/)
    .filter(Boolean);
  const initials =
    words.length > 1
      ? `${words[0]![0]}${words[1]![0]}`
      : (words[0]?.slice(0, 2) ?? "AI");
  return (
    <span
      className={`avatar avatar-${index % 5} ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      {initials.toUpperCase()}
    </span>
  );
}
export function Status({ value }: { value: string }) {
  const labels: Record<string, string> = {
    pending: "Queued",
    running: "In progress",
    verifying: "In review",
    rework: "Rework",
    accepted: "Accepted",
    failed: "Failed",
    cancelled: "Cancelled",
    blocked: "Blocked",
    completed: "Completed",
    working: "Working",
    idle: "No active work",
    attention: "Needs attention",
  };
  const Icon =
    value === "accepted" || value === "completed"
      ? CircleCheck
      : ["failed", "blocked", "attention"].includes(value)
        ? AlertCircle
        : value === "cancelled"
          ? Ban
          : ["running", "working", "verifying", "rework"].includes(value)
            ? LoaderCircle
            : Clock3;
  return (
    <span className={`status status-${value}`}>
      <Icon size={13} strokeWidth={1.8} />
      {labels[value] ?? title(value)}
    </span>
  );
}
export function SectionHeading({
  eyebrow,
  title: heading,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{heading}</h2>
      </div>
      {action}
    </div>
  );
}
export function Empty({
  title: heading,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Circle size={23} />
      </span>
      <h3>{heading}</h3>
      <p>{children}</p>
    </div>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function Dialog({
  title: heading,
  eyebrow,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`drawer ${wide ? "drawer-wide" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby="drawer-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="drawer-content">
        <header className="drawer-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id="drawer-title">{heading}</h2>
          </div>
          <button
            autoFocus
            className="icon-button"
            onClick={onClose}
            aria-label="Close details"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
