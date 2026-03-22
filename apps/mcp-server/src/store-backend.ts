import type {
  ApprovalDecision,
  ReviewerNotification,
  ReviewerNotificationFeed,
  ReviewerProfile,
  ReviewerSession,
  WorkbookAccessRole,
  WorkbookAccessState,
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
  access?: WorkbookAccessState;
}

export type MutationFailureCode =
  | "already_applied"
  | "comment_not_found"
  | "item_not_found"
  | "locked"
  | "forbidden"
  | "not_found"
  | "nothing_to_apply"
  | "review_path_locked";

export type MutationResult =
  | { ok: true; review: WorkbookReviewSnapshot }
  | { ok: false; code: MutationFailureCode };

export type TagsMutationResult =
  | { ok: true; tags: string[] }
  | { ok: false; code: MutationFailureCode | "forbidden" };

export type SketchBoardMutationResult =
  | { ok: true; sketchBoard: WorkbookSketchBoard }
  | { ok: false; code: MutationFailureCode | "forbidden" };

export type LibraryViewMutationResult =
  | { ok: true; view: WorkbookLibraryView }
  | { ok: false; code: MutationFailureCode | "forbidden" };

export type LibraryViewDeletionResult =
  | { ok: true; deletedId: string }
  | { ok: false; code: MutationFailureCode | "forbidden" };

export type ReviewerNotificationMutationResult =
  | { ok: true; notification: ReviewerNotification }
  | { ok: false; code: MutationFailureCode };

export type ReviewerSessionMutationResult =
  | { ok: true; session: ReviewerSession }
  | { ok: false; code: MutationFailureCode };

export type WorkbookAccessMutationResult =
  | { ok: true; access: WorkbookAccessState }
  | { ok: false; code: MutationFailureCode | "forbidden" };

export interface StoreBackend {
  listReviewerProfiles(): Promise<ReviewerProfile[]>;
  getReviewerSession(): Promise<ReviewerSession | null>;
  setReviewerSession(input: {
    reviewerProfileId?: string;
    reviewerHandle?: string;
  }): Promise<ReviewerSessionMutationResult>;
  listStoredWorkbooks(): Promise<WorkbookSummary[]>;
  getStoredWorkbookReview(workbookId: string): Promise<WorkbookReviewSnapshot | null>;
  getStoredWorkbookAccess(workbookId: string): Promise<WorkbookAccessState | null>;
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
  updateStoredWorkbookAccess(input: {
    workbookId: string;
    updatedBy: string;
    assignments: Array<{
      reviewerProfileId?: string;
      reviewerHandle: string;
      assignmentRole: WorkbookAccessRole;
    }>;
  }): Promise<WorkbookAccessMutationResult>;
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
  listStoredWorkbookLibraryViews(options?: {
    includeArchived?: boolean;
  }): Promise<WorkbookLibraryView[]>;
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
  archiveStoredWorkbookLibraryView(input: {
    id: string;
    archivedBy: string;
  }): Promise<LibraryViewMutationResult>;
  deleteStoredWorkbookLibraryView(input: {
    id: string;
  }): Promise<LibraryViewDeletionResult>;
  listReviewerNotifications(input: {
    reviewer: string;
    includeRead?: boolean;
  }): Promise<ReviewerNotificationFeed>;
  markReviewerNotificationRead(input: {
    notificationId: string;
    reviewer: string;
  }): Promise<ReviewerNotificationMutationResult>;
  markReviewerNotificationUnread(input: {
    notificationId: string;
    reviewer: string;
  }): Promise<ReviewerNotificationMutationResult>;
  applyApprovedProposalItems(input: {
    workbookId: string;
    actor: string;
    note?: string;
  }): Promise<MutationResult>;
}
