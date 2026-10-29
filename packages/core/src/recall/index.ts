/**
 * Recall — consumes retro records to give INTAKE/DRAFT prior experience
 * (CONCEPT.md §6.2, §7, §10). Barrel export for the module; wiring into
 * `@clockwork/core`'s public surface is done by the package's index.ts.
 */

export type {
  BuildExperiencePriorOptions,
  ExperienceConfidence,
  ExperiencePrior,
  ExperienceWarning,
  ExperienceWarningReason,
  LoadRetroRecordsResult,
  MatchingRun,
  RetroLoadError,
  TeamSizeNorm,
  UnitEstimationCalibration,
} from "./types.js";
export { loadRetroRecords, validateRetroRecord } from "./retro-loader.js";
export { buildExperiencePrior } from "./experience-prior.js";
export type { PlaybookMeta, PlaybookProvenance } from "./playbook.js";
export { appendConfirmation, parsePlaybookMeta, promoteToConfirmed } from "./playbook.js";
