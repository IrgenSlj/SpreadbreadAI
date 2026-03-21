import type { ApprovalDecision, WorkbookReviewSnapshot, WorkbookSummary } from "../../../packages/shared/src/index.js";

export interface StoredWorkbookRecord {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  storedAt: string;
  uploadPath: string;
  snapshot: WorkbookReviewSnapshot;
}

export type MutationFailureCode =
  | "already_applied"
  | "item_not_found"
  | "locked"
  | "not_found"
  | "nothing_to_apply"
  | "review_path_locked";

export type MutationResult =
  | { ok: true; review: WorkbookReviewSnapshot }
  | { ok: false; code: MutationFailureCode };

export interface StoreBackend {
  listStoredWorkbooks(): Promise<WorkbookSummary[]>;
  getStoredWorkbookReview(workbookId: string): Promise<WorkbookReviewSnapshot | null>;
  saveUploadedWorkbook(input: {
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<StoredWorkbookRecord>;
  updateStoredProposalDecision(input: {
    workbookId: string;
    decision: ApprovalDecision;
    reviewer: string;
    comment?: string;
  }): Promise<MutationResult>;
  updateStoredProposalItemDecision(input: {
    workbookId: string;
    diffId: string;
    decision: ApprovalDecision;
    reviewer: string;
    comment?: string;
  }): Promise<MutationResult>;
  applyApprovedProposalItems(input: {
    workbookId: string;
    actor: string;
    note?: string;
  }): Promise<MutationResult>;
}
