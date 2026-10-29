# Release process

Releases are owned by the primary maintainer. Publication is manual; CI does not
publish npm packages, Docker images, or GitHub releases automatically.

1. Triage open release blockers, especially execution and data-integrity issues.
2. Choose a SemVer version. Keep root/workspace versions aligned and update the
   lockfile with `npm install --package-lock-only --ignore-scripts`.
3. Move applicable `Unreleased` changelog entries into a dated version section.
   Call out breaking data/API changes, migrations, and known limitations.
4. Open a release PR. Require CI on both platforms and the Docker health smoke
   test. Record any real Claude Code acceptance separately; do not substitute
   unit tests for actual plugin loading.
5. After review/merge, tag the exact green `main` commit as `vX.Y.Z`. Do not move
   published tags. Create a draft GitHub release with generated notes and verify
   its content against the changelog before publishing it.
6. If necessary, announce regressions and ship a new patch version. Use Git
   reverts and new releases rather than rewriting shared history.

`.github/release.yml` groups generated notes by issue/PR type labels. npm scope
ownership and package publishing remain separate future work.
