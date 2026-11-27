# Project profiles

A project profile reuses operator-defined rules for goal planning, producers, independent reviewers, and final integration review. It also controls which model routes Clockwork may use for those runs.

## Set up a profile

From the project you want Clockwork to operate on, create `.teamsmith/project-profile.json`. Keep it under operator control. The directory is local state and is ignored by Git in Clockwork. For another project, exclude its `.teamsmith/` directory from version control as well.

```json
{
  "version": 1,
  "rules": [
    { "id": "stable-api", "instruction": "Preserve existing public API responses unless the approved plan changes them." },
    { "id": "test-evidence", "instruction": "Provide the observed result for each acceptance check." }
  ],
  "egress": {
    "allowCodex": true,
    "apiEndpoints": {}
  }
}
```

Use a positive integer for the version and increment it when publishing a local rule or policy change. Give each rule a stable, lowercase ID. List rules in the order you want Clockwork to add them to the request. Instructions are one line and each can contain at most 500 characters. Keep credentials and private values out of these rules. Use the local profile file to inspect their wording.

For a configured API route, add its alias and exact base URL to the `apiEndpoints` object. For example, `"deepseek": "https://api.deepseek.com"` permits the `deepseek` alias at that base URL. Set `allowCodex` to `false` to disallow the native Codex route. An empty API map and `allowCodex: false` deny model dispatch on all managed routes. Projects without a profile retain their existing route selection. An invalid profile stops the managed flow.

## Review a plan and its work

In Mission control, generate or save a plan. Review its profile version and rule IDs before approving it. Clockwork also binds approval to a digest of the profile. Editing a rule without changing the version still invalidates approval. Regenerate a generated plan, or save a new manual draft, after changing the profile. An already started run requires the original approved profile for recovery.

From the CLI, `clockwork profile` displays the version, digest, and rule IDs. For a project with a profile, pass `--actor user --profile-digest <digest>` to the normal `clockwork event spec.approved` command. The CLI `plan` result contains the profile receipt used for that proposal.

Open a task's **Applied project rules** section for the version and rule IDs used in each Clockwork request. The ledger stores receipt metadata. Reports authored by the model remain separate and may quote material supplied to it. Receipt presence records request preparation by Clockwork. A rule still needs acceptance evidence where applicable.

## What the destination policy covers

API permission allows the full model request, including goal and rule text, command output, and continuation messages. An allowed loopback service can forward requests elsewhere. `allowCodex` permits the native Codex client and its configured provider connection. Clockwork can check permission before launching that client. Once launched, the client owns its subsequent network requests. The separately invoked Claude chat and third-party tools have their own policy boundaries.

Clockwork checks the active profile before API requests and native Codex launch. A policy change cannot recall a request already sent. Destination permission is separate from file ownership, sandboxing, and credential handling. Use the profile for work that may be sent to the selected provider, and keep sensitive material out of the worker's accessible context.
