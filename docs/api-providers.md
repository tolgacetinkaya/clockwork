# API providers and arbitrary model IDs

Clockwork supports local Codex and OpenAI-compatible Chat Completions providers in
the same approved plan. Presets cover Z.ai / GLM, Qwen / Alibaba Model Studio,
DeepSeek and Kimi / Moonshot. Custom providers can use another compatible service
or a local server. Model IDs are open-ended, including older and small models.
Availability in a model list does not establish tool-calling or coding ability.
Execution requires chat completions with function tools and valid usage counters.
Image generation, embedding, audio-only and other non-chat endpoints need their
own adapters and cannot execute a coding mission through this protocol.

## Host configuration

Create a private JSON file outside the target repository. It contains environment
variable names only. Set the actual keys in the launching process environment.
Never paste keys into the panel, specification or model IDs.

```json
{
  "sandboxImage": "your-trusted-linux-build-image:tag",
  "maxRounds": 24,
  "maxInputBytes": 2000000,
  "providers": {
    "zai": {},
    "qwen": {
      "baseUrl": "https://YOUR_WORKSPACE.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
    },
    "deepseek": {},
    "kimi": {},
    "local": {
      "baseUrl": "http://127.0.0.1:8000/v1",
      "apiKeyEnv": "LOCAL_MODEL_API_KEY",
      "maxOutputTokens": 4096
    }
  }
}
```

Default credential variable names are `ZAI_API_KEY`, `DASHSCOPE_API_KEY`,
`DEEPSEEK_API_KEY` and `MOONSHOT_API_KEY`. API accounts and coding subscriptions
can use different endpoints and billing. Configure the endpoint actually enabled
for your account. Qwen requires an explicit regional/account endpoint. Custom
connections require HTTPS or explicit loopback HTTP. Redirects are rejected.
Even a local server needs a non-empty credential variable (use its documented
dummy value when it deliberately has no authentication).

Each provider can set `maxOutputTokens` and `options` containing its supported
`thinking`, `enable_thinking`, `reasoning_effort`, `temperature` or `top_p` values.
There are no guessed model aliases, temperature defaults or automatic fallbacks.
Provider reasoning continuation is preserved in memory for tool turns and is not
stored in the ledger. All models must produce a locally validated final JSON
report; native JSON-schema response mode is not assumed.

## Launch and choose models

Use the source CLI command from `codex-local.md` as `cw`, from the target clean,
committed Git repository. API tools require a running Linux Docker engine and a
trusted local image with `/bin/sh`, `sleep`, and your project's dependencies.
Images are never downloaded automatically. Install dependencies into that image
before starting; tool containers have no network. Builds can use writable `/tmp`.
Docker is invoked through its standard absolute installation path. For another
installation, set `dockerExecutable` to a trusted absolute host path in the config.
The source mount is writable for production and read-only for planning/review.

```sh
cw providers --providers-config /absolute/private/providers.json
cw providers models deepseek --providers-config /absolute/private/providers.json
cw ui --enable-execution --port 47833 --providers-config /absolute/private/providers.json --planner-model deepseek::YOUR_MODEL
```

`providers models` calls the configured `/models` endpoint without an inference
request. A service that does not implement model listing returns an explicit
error; you can still enter its documented model ID manually.

In Mission control enter, for example, `qwen::YOUR_MODEL` for production and
`kimi::YOUR_MODEL` for independent verification. Final review inherits the
verifier unless overridden. Use `zai::YOUR_MODEL` or `deepseek::YOUR_MODEL` in any
role. Plain IDs retain local Codex behavior; `codex::YOUR_MODEL` is explicit.
The host must enable each API provider. The browser cannot select endpoints,
credentials, images or Docker permissions. Save, review, approve and start the
plan normally. Provider-qualified IDs are recorded in approval/recovery model
selection and the actual selected provider is recorded in agent events.

The CLI alias `cw agent team` (or `produce` / `verify`) uses the same workflow as
`cw codex team`, with the same model flags and `--providers-config` option.

## Execution and evidence

The API agent requests `execute_command`; Clockwork runs the exact command in a
fresh container mounting only the worktree. Containers use no network, dropped
capabilities, a read-only root, resource limits and no host API-key environment.
Each tool container is removed and its absence checked before a command receipt
is delivered. Cancellation also reconciles the container by its unique name.
Git metadata outside the mounted worktree is inaccessible. Source ownership,
test-integrity, independent verification and final integration checks remain the
common runner's responsibility.

Model/tool progress and actual command exit codes flow into the existing event
ledger and panel. Total input, cached input and output include every API round.
Cached input is included in total input, not added twice. Missing usage, uncertain
requests, truncated output, unsupported tools, repeated call IDs and invalid
reports stop the run. Transport failures are not retried automatically. Round and
output limits bound calls, but task token estimates are not a hard monetary cap.
This version uses complete HTTP responses, so model progress is request-level,
not token-by-token streaming. A long model request remains visible to the watchdog.

Changing the configured endpoint/image or account during interrupted work requires
operator review. Provider identity in the ledger is the requested route, not
independent attestation of the model actually served. No live-provider quality or
cost claim follows from deterministic adapter tests.

## Verification

`npm run check` covers offline provider loops, routing, usage and CLI integration.
To also run actual Docker isolation tests with a trusted local Node image:

```sh
CLOCKWORK_TEST_SANDBOX_IMAGE=your-local-node-image:tag npx vitest run packages/adapter-api/test/docker.integration.test.ts
```

Official API references checked on 2026-11-06:

- [Z.ai Chat Completions](https://docs.z.ai/api-reference/llm/chat-completion)
- [Qwen compatible API and regional endpoints](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)
- [DeepSeek thinking and tool continuation](https://api-docs.deepseek.com/guides/thinking_mode/)
- [Kimi API](https://platform.kimi.ai/docs/get-your-api-key)
