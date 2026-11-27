export {
  CONTROL_FILE,
  GUARD_FILE,
  CLOCKWORK_DIR,
  readGuardFiles,
  validConfig,
} from "./guard/config.js";
export type { ControlState, GuardConfig, GuardFiles } from "./guard/config.js";
export {
  DEFAULT_CLASS2_PATTERNS,
  DEFAULT_CLASS3_PATTERNS,
  decide,
  matchScope,
  normalize,
} from "./guard/decide.js";
export type { Decision, GuardContext, HookToolCall, PermissionDecision } from "./guard/decide.js";
export { handleHookInput } from "./guard/hook.js";
export type { HookOutput } from "./guard/hook.js";
export {
  buildAgentDefinition,
  buildUnitPrompt,
  buildVerifierPrompt,
} from "./spawn/translate.js";

export { sessionPolicy, sessionEnv, IdlePolicy } from "./session/policy.js";
export type { SessionPolicy } from "./session/policy.js";
export { ManagedClaudeSession, usageSnapshot } from "./session/runtime.js";
export type { SessionEvent, UsageSnapshot, QueryFactory } from "./session/runtime.js";
