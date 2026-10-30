import type { LedgerEvent } from "@clockwork/core";

/** Only the matching recorded checkpoint can explain a gate. */
export function checkpointDetails(events: LedgerEvent[], ref: string) {
  const data = [...events].reverse().find((event) => event.type === "interaction.checkpoint_raised" && event.data?.ref === ref)?.data;
  const failures = data?.failures;
  return {
    message: typeof data?.message === "string" ? data.message : null,
    failures: failures && typeof failures === "object" && !Array.isArray(failures)
      ? Object.entries(failures).filter((entry): entry is [string, string] => typeof entry[1] === "string") : [],
    workspace: typeof data?.integration_workspace === "string" && !/[\x00-\x1f\x7f]/.test(data.integration_workspace) ? data.integration_workspace : null,
  };
}
