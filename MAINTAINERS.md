# Maintainers

| Maintainer | Role | Scope |
| --- | --- | --- |
| [@tolgacetinkaya](https://github.com/tolgacetinkaya) | Primary maintainer | Core, adapter, CLI, panel, repository administration, and releases |

## Responsibilities

- Triage issues: reproduce, classify type/area/priority, and keep status current.
- Review pull requests for correctness, compatibility, security, and useful tests.
- Keep dependency updates and CI maintained; do not enable automatic merging.
- Handle private vulnerability reports and publish coordinated fixes.
- Maintain the roadmap and changelog; validate, tag, and document releases.
- Keep contributor guidance and maintainer ownership accurate.

There is currently one maintainer. Do not represent automated review or
self-review as independent human approval. Contributor PRs require maintainer
review. Maintainer PRs still use CI and a recorded self-review until another
maintainer is available. Additional maintainers are added through a reviewed PR
that updates this file and CODEOWNERS, followed by explicit access changes.

## Merge and release policy

Use PRs for changes after the initial import. Require successful `CI / Verify
(ubuntu-latest)` and `CI / Verify (windows-latest)` checks, the Docker smoke check,
and resolved review conversations. Prefer squash merges. Version releases with
SemVer; pre-1.0 compatibility breaks must be called out in the changelog.
See [releasing.md](docs/releasing.md).

These are project policies. Repository-level enforcement must be configured
separately by an administrator; see [repository setup](docs/repository-setup.md).
