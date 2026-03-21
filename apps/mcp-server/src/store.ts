import { createFileStoreBackend } from "./file-store.js";
import { getPostgresConnectionInfo, hasPostgresConfig } from "./postgres.js";
import { createPostgresStoreBackend } from "./postgres-store.js";
import type {
  MutationResult,
  SketchBoardMutationResult,
  StoreBackend,
  StoredWorkbookRecord,
} from "./store-backend.js";

export type {
  MutationFailureCode,
  MutationResult,
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

export function applyApprovedProposalItems(input: {
  workbookId: string;
  actor: string;
  note?: string;
}): Promise<MutationResult> {
  return backend.applyApprovedProposalItems(input);
}
