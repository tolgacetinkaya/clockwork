/**
 * The single-page dashboard. Dependency-free vanilla JS/CSS, inlined — no
 * CDN, no build step (local-first rule, CONCEPT.md §13). All rendering is a
 * projection of /api/state + /api/budget + /api/changelog; the three control
 * buttons are the only writes, and they only ever POST /api/control.
 */

export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clockwork panel</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f5f6f8;
    --fg: #1a1d23;
    --muted: #6b7280;
    --card: #ffffff;
    --border: #e2e4e9;
    --accent: #3b5bfd;
    --danger: #d3423e;
    --warn: #b8860b;
    --ok: #1f8a4c;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14161a;
      --fg: #e7e9ee;
      --muted: #9aa0ac;
      --card: #1c1f26;
      --border: #2a2e37;
      --accent: #7c93ff;
      --danger: #ff6b66;
      --warn: #e0b24a;
      --ok: #4fd484;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--fg);
    padding: 1.5rem;
    line-height: 1.4;
  }
  h1 { font-size: 1.1rem; margin: 0 0 0.25rem; }
  h2 { font-size: 0.95rem; margin: 0 0 0.5rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
  }
  #header-line { color: var(--muted); font-size: 0.9rem; }
  #header-flags span {
    display: inline-block;
    margin-right: 0.5rem;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .flag-paused { background: var(--warn); color: #1a1d23; }
  .flag-outcome-done { background: var(--ok); color: #1a1d23; }
  .flag-outcome-abandoned { background: var(--danger); color: #1a1d23; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; }
  td.num, th.num { text-align: right; }
  .status-pill {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    color: #12141a;
  }
  .status-pending { background: #9aa0ac; }
  .status-running { background: #4a90e2; color: #fff; }
  .status-verifying { background: #a970e6; color: #fff; }
  .status-rework { background: var(--warn); }
  .status-accepted { background: var(--ok); }
  .status-failed { background: var(--danger); color: #fff; }
  .status-cancelled { background: #6b7280; color: #fff; }
  .status-blocked { background: #d47f1f; }
  .dev-pos { color: var(--danger); }
  .dev-neg { color: var(--ok); }
  .empty { color: var(--muted); font-style: italic; }
  #budget-bar-track {
    position: relative;
    height: 10px;
    border-radius: 999px;
    background: var(--border);
    overflow: hidden;
    margin: 0.5rem 0;
  }
  #budget-bar-fill {
    height: 100%;
    background: var(--accent);
    width: 0%;
  }
  #budget-bar-fill.over { background: var(--danger); }
  .controls { display: flex; gap: 0.5rem; }
  button {
    font: inherit;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--fg);
    cursor: pointer;
  }
  button:hover { border-color: var(--accent); }
  #kill-btn:hover { border-color: var(--danger); color: var(--danger); }
  ul { margin: 0.25rem 0 0; padding-left: 1.2rem; }
  #anomalies-card { display: none; }
  #anomalies-card.show { display: block; }
  #anomalies-card li { color: var(--danger); }
  #status-line { color: var(--muted); font-size: 0.8rem; margin-top: 1rem; }
  #commands-status { color: var(--muted); font-size: 0.8rem; }
  textarea, input[type="text"] {
    font: inherit;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.5rem;
    width: 100%;
    box-sizing: border-box;
  }
  .cmd-box { margin-top: 0.6rem; }
  .cmd-box textarea { display: block; margin-bottom: 0.4rem; resize: vertical; }
  .cmd-feedback { color: var(--muted); font-size: 0.8rem; margin-left: 0.5rem; }
  li.checkpoint-row { list-style: none; margin-left: -1.2rem; margin-bottom: 0.5rem; }
  li.checkpoint-row .checkpoint-controls { display: flex; gap: 0.4rem; align-items: center; margin-top: 0.3rem; }
  li.checkpoint-row .checkpoint-note { flex: 1; }
</style>
</head>
<body>
  <h1>Clockwork — management panel</h1>
  <div id="header-line">loading…</div>
  <div id="header-flags"></div>

  <div class="card">
    <h2>Controls</h2>
    <div class="controls">
      <button id="pause-btn" type="button">Pause</button>
      <button id="resume-btn" type="button">Resume</button>
      <button id="kill-btn" type="button">Kill</button>
    </div>
  </div>

  <div class="card">
    <h2>Budget</h2>
    <div id="budget-summary" class="empty">no data yet</div>
    <div id="budget-bar-track"><div id="budget-bar-fill"></div></div>
  </div>

  <div class="card">
    <h2>Work units</h2>
    <table id="units-table">
      <thead>
        <tr>
          <th>Unit</th>
          <th>Status</th>
          <th>Agent</th>
          <th class="num">Rework</th>
          <th class="num">Spent</th>
          <th class="num">Estimated</th>
        </tr>
      </thead>
      <tbody id="units-body">
        <tr><td colspan="6" class="empty">no data yet</td></tr>
      </tbody>
    </table>
  </div>

  <div class="card">
    <h2>Open checkpoints</h2>
    <ul id="checkpoints-list"><li class="empty">none</li></ul>
  </div>

  <div class="card">
    <h2>Pending questions</h2>
    <ul id="questions-list"><li class="empty">none</li></ul>
    <div class="cmd-box">
      <textarea id="answers-text" rows="3" placeholder="Type your answer(s) here..."></textarea>
      <button id="answers-btn" type="button">Send answers</button>
      <span id="answers-feedback" class="cmd-feedback"></span>
    </div>
  </div>

  <div class="card">
    <h2>Operator note</h2>
    <div class="cmd-box">
      <textarea id="note-text" rows="2" placeholder="Free-form note for the orchestrator..."></textarea>
      <button id="note-btn" type="button">Send note</button>
      <span id="note-feedback" class="cmd-feedback"></span>
    </div>
  </div>

  <div class="card" id="anomalies-card">
    <h2>Anomalies</h2>
    <ul id="anomalies-list"></ul>
  </div>

  <div id="status-line"></div>
  <div id="commands-status"></div>

<script>
(function () {
  "use strict";

  var POLL_MS = 2000;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderHeader(state, control) {
    var parts = [];
    parts.push("run: " + esc(state.runId || "(none)"));
    parts.push("phase: " + esc(state.phase || "-"));
    parts.push("spec: v" + esc(state.specVersion == null ? "-" : state.specVersion) + (state.specApproved ? " (approved)" : ""));
    el("header-line").textContent = parts.join("  ·  ");

    var flags = [];
    if (state.paused) flags.push('<span class="flag-paused">PAUSED</span>');
    else if (control.paused) flags.push('<span class="flag-paused">PAUSE REQUESTED</span>');
    if (control.kill) flags.push('<span class="flag-paused">STOP REQUESTED</span>');
    if (state.outcome) {
      flags.push('<span class="flag-outcome-' + esc(state.outcome) + '">' + esc(state.outcome.toUpperCase()) + '</span>');
    }
    el("header-flags").innerHTML = flags.join("");
  }

  function statusPill(status) {
    return '<span class="status-pill status-' + esc(status) + '">' + esc(status) + '</span>';
  }

  function renderUnits(state) {
    var ids = Object.keys(state.units || {});
    var body = el("units-body");
    if (!ids.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">no work units yet</td></tr>';
      return;
    }
    body.innerHTML = ids.map(function (id) {
      var u = state.units[id];
      return "<tr>" +
        "<td><code>" + esc(id) + "</code></td>" +
        "<td>" + statusPill(u.status) + "</td>" +
        "<td>" + esc(u.agent || "-") + "</td>" +
        '<td class="num">' + esc(u.reworkAttempts) + "</td>" +
        '<td class="num">' + esc(u.spent) + "</td>" +
        '<td class="num">' + esc(u.estimated || "-") + "</td>" +
        "</tr>";
    }).join("");
  }

  function renderCheckpoints(state) {
    var list = state.openCheckpoints || [];
    var el2 = el("checkpoints-list");
    el2.innerHTML = list.length
      ? list.map(function (c) {
          return '<li class="checkpoint-row" data-ref="' + esc(c.ref) + '">' +
            "<code>" + esc(c.ref) + "</code> — " + esc(c.kind) + (c.blocking ? " (blocking)" : "") +
            '<div class="checkpoint-controls">' +
            '<input type="text" class="checkpoint-note" placeholder="note (optional)">' +
            '<button type="button" class="resolve-btn" data-ref="' + esc(c.ref) + '">Resolve</button>' +
            '<span class="cmd-feedback"></span>' +
            "</div></li>";
        }).join("")
      : '<li class="empty">none</li>';
  }

  function renderQuestions(state) {
    var list = state.pendingQuestions || [];
    var el2 = el("questions-list");
    el2.innerHTML = list.length
      ? list.map(function (q) { return "<li>" + esc(q) + "</li>"; }).join("")
      : '<li class="empty">none</li>';
  }

  function renderAnomalies(state) {
    var list = state.anomalies || [];
    var card = el("anomalies-card");
    if (!list.length) {
      card.classList.remove("show");
      return;
    }
    card.classList.add("show");
    el("anomalies-list").innerHTML = list.map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("");
  }

  function renderBudget(report) {
    var summary = el("budget-summary");
    var fill = el("budget-bar-fill");
    if (report.target !== null) {
      var pct = report.target > 0 ? Math.min(100, Math.round((report.totalSpent / report.target) * 100)) : 0;
      summary.textContent = "target " + report.target + " · spent " + report.totalSpent +
        " · remaining " + report.remaining + (report.exhausted ? " · TARGET REACHED" : "");
      summary.classList.remove("empty");
      fill.style.width = pct + "%";
      fill.classList.toggle("over", report.totalSpent > report.target);
    } else {
      summary.textContent = "spent " + report.totalSpent + " (no target set)";
      summary.classList.remove("empty");
      fill.style.width = "0%";
      fill.classList.remove("over");
    }
    if (report.unattributed > 0) {
      summary.textContent += " · unattributed " + report.unattributed;
    }
  }

  function poll() {
    Promise.all([
      fetch("/api/state").then(function (r) { return r.json(); }),
      fetch("/api/budget").then(function (r) { return r.json(); }),
      fetch("/api/control").then(function (r) { return r.json(); }),
    ]).then(function (results) {
      var state = results[0];
      var budget = results[1];
      renderHeader(state, results[2]);
      renderUnits(state);
      renderCheckpoints(state);
      renderQuestions(state);
      renderAnomalies(state);
      renderBudget(budget);
      el("status-line").textContent = "updated " + new Date().toLocaleTimeString();
    }).catch(function (err) {
      el("status-line").textContent = "poll failed: " + err;
    });
    pollCommands();
  }

  function pollCommands() {
    fetch("/api/commands").then(function (r) { return r.json(); }).then(function (status) {
      var queued = status.queued || [];
      el("commands-status").textContent = "queued commands: " + queued.length +
        " (consumed up to seq " + status.consumedSeq + ")";
    }).catch(function () { /* non-fatal: leave the last known status visible */ });
  }

  function sendCommand(type, data, feedbackEl) {
    if (feedbackEl) feedbackEl.textContent = "sending…";
    return fetch("/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: type, data: data }),
    }).then(function (r) {
      if (!r.ok) {
        return r.json().then(function (body) {
          throw new Error((body && body.error) || "request failed");
        });
      }
      return r.json();
    }).then(function () {
      if (feedbackEl) feedbackEl.textContent = "queued — waiting for orchestrator";
      pollCommands();
    }).catch(function (err) {
      if (feedbackEl) feedbackEl.textContent = "failed: " + (err && err.message ? err.message : err);
    });
  }

  function sendControl(patch, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    fetch("/api/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then(poll).catch(function (err) {
      el("status-line").textContent = "control failed: " + err;
    });
  }

  el("pause-btn").addEventListener("click", function () {
    sendControl({ paused: true }, "Pause the run at the next unit boundary?");
  });
  el("resume-btn").addEventListener("click", function () {
    sendControl({ paused: false }, null);
  });
  el("kill-btn").addEventListener("click", function () {
    sendControl({ kill: true }, "Kill the run? This stops execution and cannot be undone from the panel.");
  });

  el("answers-btn").addEventListener("click", function () {
    var text = el("answers-text").value.trim();
    if (!text) return;
    sendCommand("answer_questions", { text: text }, el("answers-feedback")).then(function () {
      el("answers-text").value = "";
    });
  });

  el("note-btn").addEventListener("click", function () {
    var text = el("note-text").value.trim();
    if (!text) return;
    sendCommand("note", { text: text }, el("note-feedback")).then(function () {
      el("note-text").value = "";
    });
  });

  el("checkpoints-list").addEventListener("click", function (e) {
    var target = e.target;
    if (!target || !target.classList || !target.classList.contains("resolve-btn")) return;
    var ref = target.getAttribute("data-ref");
    var row = target.closest ? target.closest("li") : null;
    var noteInput = row ? row.querySelector(".checkpoint-note") : null;
    var feedback = row ? row.querySelector(".cmd-feedback") : null;
    var note = noteInput ? noteInput.value.trim() : "";
    var data = note ? { ref: ref, note: note } : { ref: ref };
    sendCommand("resolve_checkpoint", data, feedback);
  });

  poll();
  setInterval(poll, POLL_MS);
})();
</script>
</body>
</html>
`;
}
