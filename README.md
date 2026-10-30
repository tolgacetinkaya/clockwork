# Clockwork

**AI teams, shaped by the task.**

Clockwork is an experimental, local-first framework for planning and running
specialized AI teams. It decomposes work into units, records a reviewable team
specification, tracks dependencies and budgets, and keeps an append-only event
ledger for verification and session recovery.

The core is platform-independent TypeScript. The current execution adapter is
for Claude Code; other coding-agent adapters are planned.

## Current status

This is an early prototype, with automated tests and archived regression
fixtures. It is intended for developers who can inspect the code and approve
execution. Real plugin-enabled Claude Code acceptance remains an open gate.
It is not a hardened execution sandbox.

Implemented:

- YAML team specifications, dependency checks, and versioned amendments.
- Event admission, state replay, budget accounting, and retrospective records.
- Claude Code prompt generation and a PreToolUse approval hook.
- A local management panel, control requests, and a durable command queue.

The panel uses React 19, Tailwind CSS, and a shared SSE stream. Overview,
workboard, team, activity, and decisions share one TanStack Query cache; Zustand
keeps UI state separate. The panel container
shows recorded activity; it does not start an orchestrator or AI agents.

## Get started

Requires **Node.js 24 or newer**, npm, and Git. Docker is optional. Claude Code
is needed only for the execution integration, not for tests or the demo panel.

```sh
git clone https://github.com/tolgacetinkaya/clockwork.git
cd clockwork
npm ci
npm run check
npm run -s clockwork -- status
```

For a target project, initialize state using the source CLI:

```sh
node "/absolute/path/to/clockwork/node_modules/tsx/dist/cli.mjs" "/absolute/path/to/clockwork/packages/cli/src/bin.ts" init
```

Replace both absolute paths with your checkout location and run from the target
project directory. This creates `.teamsmith/`; it does not launch agents.
For source development, `npm run -s clockwork -- <command>` runs the same CLI
inside this repository. Packages have not been published to npm.

## Explore the panel

```sh
docker compose up -d --build
```

Open <http://localhost:47831>. Only the host loopback interface is published.
Set `CLOCKWORK_PANEL_PORT` to choose another host port. Stop with
`docker compose down`; the named data volume survives.

The demo copies a historical GP-1 ledger fixture into a persistent volume on
first launch. Commands and control requests affect the copy. With no command
consumer running in the demo, queued notes wait to be handled.

Without Docker, `npm run -s clockwork -- ui --port 47831` serves the current
project's state. A new project initially has no run history.

## Execution boundaries

The active Claude hook checks ownership, canonical paths, pause/kill state,
and recorded budgets. Shell commands, spawns, and unknown tools require
approval. Approved shell commands can access the host; use an OS or container
sandbox when isolation is required. Pause/kill blocks future tool mutations
and does not terminate already running processes.

Panel commands are delivered at least once. `commands pull` reads pending
commands; `commands ack <seq>` acknowledges an applied prefix. Consumers must
reconcile duplicate delivery against the ledger. See
[execution hardening](docs/execution-hardening.md) for installation boundaries,
storage recovery, and known limitations.

For frontend development, run the API on 47831 and `npm run panel:dev` in a
second terminal. Vite uses 47832 and proxies API/SSE. See
[panel architecture](docs/panel-architecture.md) for ownership and recovery.

## Claude Code integration

The plugin entry point is `plugin/`, containing the orchestrator skill and hook
registration. Install dependencies at this repository's root before loading
that directory with your Claude Code version's local-plugin mechanism. The
hook wiring resolves the adjacent source checkout and `node_modules`.

For external worktrees, set `CLOCKWORK_PROJECT_ROOT` to the absolute initialized
project root in the trusted launcher's environment. Confirm that the plugin
and hook are active in the actual session before relying on the guard.
Pure hook tests do not prove that a live Claude session loaded it.

## Architecture and development

```text
packages/core/            Specs, ledger, budget, queue, verification, recall
packages/adapter-claude/  Guard hook and agent prompt builders
packages/cli/             CLI entry point
packages/panel/           Local HTTP server and management panel
plugin/                   Claude Code plugin and orchestrator skill
assets/playbooks/         Domain guidance
packages/core/test/fixtures/historical/  Reviewed regression data
```

```sh
npm test
npm run typecheck
npm run check:public
```

CI runs a clean install, TypeScript checks, tests, and public-file checks on
Linux and Windows using Node.js 24. A separate job builds and smoke-tests the
Docker panel. Tests require no AI API key and make no model calls.
Raw `runs/` workspaces, machine guard configurations, credentials, and local
state are excluded from Git. Tests and the Docker demo use committed fixtures.

[CONCEPT.md](CONCEPT.md) and [ROADMAP.md](ROADMAP.md) preserve the original design
and planning history; aspirational sections are not current feature claims.

## Compatibility

Clockwork was originally called Teamsmith. Existing `.teamsmith/` state,
`.teamsmith-worktrees/`, `teamsmith_version` fields, and schema identifiers
retain their names so earlier data remains readable.
`TEAMSMITH_PROJECT_ROOT` remains a fallback for `CLOCKWORK_PROJECT_ROOT`.
The Compose volume defaults to `teamsmith_panel-data` to preserve older local
installations. After moving a previous checkout, stop its old container with
`docker compose -p teamsmith down`, then recreate from this folder. Avoid
`--volumes` when preserving state.

## Contribute

Start with [CONTRIBUTING.md](CONTRIBUTING.md). The primary maintainer and review,
triage, and release responsibilities are listed in [MAINTAINERS.md](MAINTAINERS.md).
Report vulnerabilities using [SECURITY.md](SECURITY.md), without public exploit
details. Release preparation is described in [docs/releasing.md](docs/releasing.md).

## License

[MIT](LICENSE). Bundled fonts retain their OFL license; see
[third-party notices](THIRD_PARTY_NOTICES.md).
