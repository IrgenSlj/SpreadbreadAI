import { createFileStoreBackend } from "./file-store.js";
import { hasPostgresConfig } from "./postgres.js";
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

export function applyApprovedProposalItems(input: {
  workbookId: string;
  actor: string;
  note?: string;
}): Promise<MutationResult> {
  return backend.applyApprovedProposalItems(input);
}
