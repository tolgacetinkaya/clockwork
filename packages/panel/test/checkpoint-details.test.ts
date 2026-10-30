import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "@clockwork/core";
import { checkpointDetails } from "../client/checkpoint-details.js";
const event = (data: Record<string, unknown>) => ({ type: "interaction.checkpoint_raised", data }) as LedgerEvent;
describe("checkpoint recovery details", () => {
  it("uses the latest matching gate and retains reasons as plain text", () => {
    const events = [event({ ref: "team-one", message: "old" }), event({ ref: "team-other", message: "unrelated" }), event({ ref: "team-one", message: "Review integration", failures: { api: "<script>text only</script>", ignored: 7 }, integration_workspace: "G:/preserved/team" })];
    expect(checkpointDetails(events, "team-one")).toEqual({ message: "Review integration", failures: [["api", "<script>text only</script>"]], workspace: "G:/preserved/team" });
  });
  it("handles expired event windows and rejects control characters in workspace values", () => {
    expect(checkpointDetails([], "team-one")).toEqual({ message: null, failures: [], workspace: null });
    expect(checkpointDetails([event({ ref: "team-one", failures: [], integration_workspace: "bad\npath" })], "team-one").workspace).toBeNull();
  });
});
