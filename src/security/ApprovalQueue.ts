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
    note: "Execution disabled. Approval can be recorded for UX testing only.",
    status: "pending"
  };
}

export function countPendingApprovals(records: ApprovalRecord[]): number {
  return records.filter((record) => record.status === "pending").length;
}
