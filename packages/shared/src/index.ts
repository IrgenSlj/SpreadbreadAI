export type EntityId = string;

export type WorkbookId = EntityId;
export type WorkbookVersionId = EntityId;
export type ProposalId = EntityId;
export type ApprovalRequestId = EntityId;

export interface WorkbookSummary {
  id: WorkbookId;
  name: string;
  latestVersionId: WorkbookVersionId;
  sheetCount: number;
  createdAt: string;
}

export interface ProposalSummary {
  id: ProposalId;
  workbookId: WorkbookId;
  title: string;
  status: "draft" | "pending_approval" | "approved" | "rejected" | "applied";
  createdAt: string;
}
