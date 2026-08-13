import type { SafetyDecision } from "./SafetyPolicy";

export type ApprovalStatus = "approved" | "denied" | "pending";

export interface ApprovalRecord {
  createdAt: string;
  decidedAt?: string;
  decision: SafetyDecision;
  id: string;
  note: string;
  status: ApprovalStatus;
}

export function createApprovalRecord(
  id: string,
  decision: SafetyDecision
): ApprovalRecord {
  return {
    createdAt: new Date().toISOString(),
    decision,
    id,
    // Approving a proposed edit really does write the file. The previous note
    // claimed execution was disabled and approval was "for UX testing only",
    // which was left over from before applyProposedEdit was implemented and
    // understated what approval does.
    note: decision.request.kind === "write"
      ? "Approving this lets the reviewed edit be applied to the vault file."
      : "Recorded for the audit log. This action was refused and cannot be approved.",
    status: "pending"
  };
}

export function countPendingApprovals(records: ApprovalRecord[]): number {
  return records.filter((record) => record.status === "pending").length;
}
