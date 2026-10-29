# Security policy

## Supported versions

Clockwork is a pre-release prototype. Security fixes target the current `main`
branch until a supported release line is announced. There is no production
support guarantee or response-time SLA.

## Reporting a vulnerability

Do not post exploit details, credentials, or private ledgers in public issues.
Use [GitHub private vulnerability reporting](https://github.com/tolgacetinkaya/clockwork/security/advisories/new)
when it is available. If the repository does not offer that form, open a public
issue titled "Security contact request" with no technical details, and ask
[@tolgacetinkaya](https://github.com/tolgacetinkaya) to arrange a private channel.
The primary maintainer owns triage and coordinated disclosure.

Include the affected commit/version, minimal reproduction, impact, and proposed
fix if available. Use disposable files and redact secrets. Report whether the
hook was actually enabled in a live Claude Code session.

## Current boundaries

The hook is an approval boundary for cooperative execution. It is not an OS
sandbox, an authentication system, or a restriction on already approved shell
commands. The local panel has no authentication and should remain on loopback.
Do not publish its port or mount untrusted projects as writable host paths.
See [execution hardening](docs/execution-hardening.md) for known limits.
