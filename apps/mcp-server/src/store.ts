import { createFileStoreBackend } from "./file-store.js";
import { getPostgresConnectionInfo, hasPostgresConfig } from "./postgres.js";
import { createPostgresStoreBackend } from "./postgres-store.js";
import type {
  MutationResult,
  StoreBackend,
  StoredWorkbookRecord,
} from "./store-backend.js";

export type { MutationFailureCode, MutationResult, StoredWorkbookRecord } from "./store-backend.js";

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
}): Promise<MutationResult> {
  return backend.appendStoredProposalItemComment(input);
}

export function applyApprovedProposalItems(input: {
  workbookId: string;
  actor: string;
  note?: string;
}): Promise<MutationResult> {
  return backend.applyApprovedProposalItems(input);
}
