import type {
  ApprovalDecision,
  WorkbookLibraryView,
  WorkbookReviewSnapshot,
  WorkbookSketchBoard,
  WorkbookSummary,
} from "../../../packages/shared/src/index.js";

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
  | "comment_not_found"
  | "item_not_found"
  | "locked"
  | "not_found"
  | "nothing_to_apply"
  | "review_path_locked";

export type MutationResult =
  | { ok: true; review: WorkbookReviewSnapshot }
  | { ok: false; code: MutationFailureCode };

export type TagsMutationResult =
  | { ok: true; tags: string[] }
  | { ok: false; code: MutationFailureCode };

export type SketchBoardMutationResult =
  | { ok: true; sketchBoard: WorkbookSketchBoard }
  | { ok: false; code: MutationFailureCode };

export type LibraryViewMutationResult =
  | { ok: true; view: WorkbookLibraryView }
  | { ok: false; code: MutationFailureCode };

export interface StoreBackend {
  listStoredWorkbooks(): Promise<WorkbookSummary[]>;
  getStoredWorkbookReview(workbookId: string): Promise<WorkbookReviewSnapshot | null>;
  getStoredWorkbookTags(workbookId: string): Promise<string[] | null>;
  saveUploadedWorkbook(input: {
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<StoredWorkbookRecord>;
  updateStoredWorkbookTags(input: {
    workbookId: string;
    tags: string[];
    updatedBy: string;
  }): Promise<TagsMutationResult>;
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
  appendStoredProposalItemComment(input: {
    workbookId: string;
    diffId: string;
    author: string;
    body: string;
    parentCommentId?: string;
    replyToCommentId?: string;
    mentions?: string[];
  }): Promise<MutationResult>;
  getStoredSketchBoard(workbookId: string): Promise<WorkbookSketchBoard | null>;
  updateStoredSketchBoard(input: {
    workbookId: string;
    title: string;
    updatedBy: string;
    nodes: WorkbookSketchBoard["nodes"];
    links: WorkbookSketchBoard["links"];
    notes?: string;
  }): Promise<SketchBoardMutationResult>;
  listStoredWorkbookLibraryViews(): Promise<WorkbookLibraryView[]>;
  saveStoredWorkbookLibraryView(input: {
    id: string;
    name: string;
    updatedBy: string;
    description?: string;
    searchQuery?: string;
    tags: string[];
    sortBy: WorkbookLibraryView["sortBy"];
    sortDirection: WorkbookLibraryView["sortDirection"];
    pinned?: boolean;
  }): Promise<LibraryViewMutationResult>;
  applyApprovedProposalItems(input: {
    workbookId: string;
    actor: string;
    note?: string;
  }): Promise<MutationResult>;
}
