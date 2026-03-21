import { createFileStoreBackend } from "./file-store.js";
import { getPostgresConnectionInfo, hasPostgresConfig } from "./postgres.js";
import { createPostgresStoreBackend } from "./postgres-store.js";
import type {
  MutationResult,
  LibraryViewDeletionResult,
  ReviewerNotificationMutationResult,
  TagsMutationResult,
  LibraryViewMutationResult,
  SketchBoardMutationResult,
  StoreBackend,
  StoredWorkbookRecord,
} from "./store-backend.js";

export type {
  LibraryViewDeletionResult,
  LibraryViewMutationResult,
  MutationFailureCode,
  MutationResult,
  ReviewerNotificationMutationResult,
  TagsMutationResult,
  SketchBoardMutationResult,
  StoredWorkbookRecord,
} from "./store-backend.js";

const backend: StoreBackend = hasPostgresConfig()
  ? createPostgresStoreBackend()
  : createFileStoreBackend();

export async function getStoreRuntimeStatus() {
  const workbooks = await backend.listStoredWorkbooks();
  const postgres = getPostgresConnectionInfo();
  const mode = hasPostgresConfig() ? "postgres" as const : "file" as const;

  return {
    mode,
    backendMode: mode,
    backendLabel:
      mode === "postgres"
        ? `PostgreSQL ${postgres?.database ?? "database"}`
        : "Local file store",
    backendSource: "api" as const,
    updatedAt: new Date().toISOString(),
    workbookCount: workbooks.length,
    target:
      postgres
        ? {
            host: postgres.host,
            port: postgres.port,
            database: postgres.database,
          }
        : null,
  };
}

export function getStoreBackend() {
  return backend;
}

export function listStoredWorkbooks() {
  return backend.listStoredWorkbooks();
}

export function getStoredWorkbookReview(workbookId: string) {
  return backend.getStoredWorkbookReview(workbookId);
}

export function getStoredWorkbookTags(workbookId: string) {
  return backend.getStoredWorkbookTags(workbookId);
}

export function getStoredSketchBoard(workbookId: string) {
  return backend.getStoredSketchBoard(workbookId);
}

export function saveUploadedWorkbook(input: {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<StoredWorkbookRecord> {
  return backend.saveUploadedWorkbook(input);
}

export function updateStoredWorkbookTags(input: {
  workbookId: string;
  tags: string[];
  updatedBy: string;
}): Promise<TagsMutationResult> {
  return backend.updateStoredWorkbookTags(input);
}

export function updateStoredProposalDecision(input: {
  workbookId: string;
  decision: "approve" | "reject";
  reviewer: string;
  comment?: string;
}): Promise<MutationResult> {
  return backend.updateStoredProposalDecision(input);
}

export function updateStoredProposalItemDecision(input: {
  workbookId: string;
  diffId: string;
  decision: "approve" | "reject";
  reviewer: string;
  comment?: string;
}): Promise<MutationResult> {
  return backend.updateStoredProposalItemDecision(input);
}

export function appendStoredProposalItemComment(input: {
  workbookId: string;
  diffId: string;
  author: string;
  body: string;
  parentCommentId?: string;
  replyToCommentId?: string;
  mentions?: string[];
}): Promise<MutationResult> {
  return backend.appendStoredProposalItemComment(input);
}

export function updateStoredSketchBoard(input: {
  workbookId: string;
  title: string;
  updatedBy: string;
  nodes: import("../../../packages/shared/src/index.js").WorkbookSketchBoard["nodes"];
  links: import("../../../packages/shared/src/index.js").WorkbookSketchBoard["links"];
  notes?: string;
}): Promise<SketchBoardMutationResult> {
  return backend.updateStoredSketchBoard(input);
}

export function listStoredWorkbookLibraryViews(options?: {
  includeArchived?: boolean;
}) {
  return backend.listStoredWorkbookLibraryViews(options);
}

export function saveStoredWorkbookLibraryView(input: {
  id: string;
  name: string;
  updatedBy: string;
  description?: string;
  searchQuery?: string;
  tags: string[];
  sortBy: import("../../../packages/shared/src/index.js").WorkbookLibraryView["sortBy"];
  sortDirection: import("../../../packages/shared/src/index.js").WorkbookLibraryView["sortDirection"];
  pinned?: boolean;
}): Promise<LibraryViewMutationResult> {
  return backend.saveStoredWorkbookLibraryView(input);
}

export function archiveStoredWorkbookLibraryView(input: {
  id: string;
  archivedBy: string;
}): Promise<LibraryViewMutationResult> {
  return backend.archiveStoredWorkbookLibraryView(input);
}

export function deleteStoredWorkbookLibraryView(input: {
  id: string;
}): Promise<LibraryViewDeletionResult> {
  return backend.deleteStoredWorkbookLibraryView(input);
}

export function listReviewerNotifications(input: {
  reviewer: string;
  includeRead?: boolean;
}) {
  return backend.listReviewerNotifications(input);
}

export function markReviewerNotificationRead(input: {
  notificationId: string;
  reviewer: string;
}): Promise<ReviewerNotificationMutationResult> {
  return backend.markReviewerNotificationRead(input);
}

export function markReviewerNotificationUnread(input: {
  notificationId: string;
  reviewer: string;
}): Promise<ReviewerNotificationMutationResult> {
  return backend.markReviewerNotificationUnread(input);
}

export function applyApprovedProposalItems(input: {
  workbookId: string;
  actor: string;
  note?: string;
}): Promise<MutationResult> {
  return backend.applyApprovedProposalItems(input);
}
