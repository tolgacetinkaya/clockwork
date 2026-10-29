# Repository administration

Public repository: <https://github.com/tolgacetinkaya/clockwork>
Primary maintainer: `@tolgacetinkaya`.

## Included in source control

- CODEOWNERS and maintenance responsibilities.
- Structured bug, feature, and documentation forms; PR template.
- Type/area/priority/status labels in `.github/labels.json`.
- A trusted default-branch workflow that creates/updates those labels on a
  labels change, or manually through Actions. It never runs on fork PR code.
- CI for Node.js 24 on Linux and Windows, and Docker build/health smoke.
- Dependabot for npm and pinned GitHub Actions, with no automatic merge.
- Categorized generated release notes and a manual release checklist.

## Administrator settings

A file in this repository cannot enable these settings by itself. A repository
administrator should verify and apply them in GitHub Settings:

1. Enable Actions for GitHub-hosted runners and allow the pinned official actions.
2. Enable private vulnerability reporting and available secret scanning/push
   protection. Until private reporting is enabled, SECURITY.md documents a
   contact-request fallback that must not contain exploit details.
3. Protect `main` against deletion and force pushes; require a PR, resolved review
   conversations, and the green checks named `Verify (ubuntu-latest)`,
   `Verify (windows-latest)`, and `Docker smoke`. Wait for one complete CI run so
   those contexts exist. Match names to the observed run before saving rules.
4. For a sole maintainer, require zero independent approvals rather than locking
   the maintainer out of every own PR. Raise this to one CODEOWNER approval when
   a second reviewer with suitable access is available. Keep bypass permissions
   narrow and do not report self-review as independent approval.
5. Prefer squash merging and delete merged PR branches. Leave automatic merging
   disabled until an explicit policy is adopted.
6. Grant future maintainers only the necessary access and update MAINTAINERS.md
   and CODEOWNERS together. No extra collaborator is implied by a Git identity.

No rule or protection should be described as enabled solely because its desired
configuration appears here. Verify active settings through GitHub before claiming
repository-level enforcement.

## Local Git authentication

The `origin` remote uses the public HTTPS repository URL. GitHub connector login
and terminal `gh` login can be different accounts. For terminal pushes, sign in
as an account with write access to this repository; never commit tokens or copy
connector credentials into Git configuration.
