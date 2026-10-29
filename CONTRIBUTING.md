# Contributing to Clockwork

Clockwork is an early prototype. Small, focused fixes, reproducible bug reports,
documentation, and adapter feedback are welcome. Discuss larger architecture
changes in an issue before implementation.

## Local development

Use Node.js 24 or newer and npm:

```sh
npm ci
npm run check
```

`npm run check` runs TypeScript, the test suite, and public-file checks. Commit
`package-lock.json` when changing dependencies. No AI credentials are required
for tests. Docker changes should also pass `docker compose build` and a local
health check. A passing unit suite is separate from plugin-enabled acceptance.

## Issues and classification

Use the bug, feature, or documentation form. Include the version/commit, OS,
steps to reproduce, expected behavior, and redacted output as applicable.
Do not attach API keys, full conversation dumps, raw ledgers, or `.env` files.
Use [SECURITY.md](SECURITY.md) for vulnerabilities.

Maintainers assign a type, area, priority, and status from `.github/labels.json`.
New reports start as `status:triage`; priority is assigned after reproduction.
Use `good first issue` only when scope and acceptance criteria are clear.

## Pull requests

1. Fork the repository and create a focused branch.
2. Explain the problem, resulting behavior, and related issue.
3. Add meaningful tests for behavioral changes, and run the relevant checks.
4. Use the PR template and distinguish executed checks from checks still pending.
5. Respond to maintainer review. Do not merge with unresolved blocking comments.

Keep core rules in `packages/core`; adapters and the panel should use them.
Treat specifications and the event dictionary as contracts. Document data
migrations and compatibility implications. Keep docs and code in English.
AI-assisted contributions are welcome: contributors remain responsible for
reviewing the result and reporting what was actually validated.

## Review and maintenance

See [MAINTAINERS.md](MAINTAINERS.md). CI must pass before merge. Another maintainer
reviews when available. While there is one maintainer, that maintainer can merge
their own PR after checks and documented self-review; this is not an independent
approval. CODEOWNERS requests ownership review but does not enforce branch rules.

## License and conduct

Contributions are accepted under the [MIT license](LICENSE). Contribute only
material you have the right to submit. Communicate respectfully, explain
technical disagreements, and keep discussion focused on the project. Harassment
or publication of private information may be moderated by the maintainer.
