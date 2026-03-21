import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type ApprovalDecision,
  type WorkbookLibraryView,
  demoReviewSnapshot,
  type ProposalDetail,
  type ProposalDiffEntry,
  type ProposalItemComment,
  type ProposalItemStatus,
  type WorkbookReviewSnapshot,
  type WorkbookSketchBoard,
  type WorkbookSummary,
} from "../../../packages/shared/src/index.js";
import { parseWorkbookReviewSnapshot } from "./parser.js";
import type {
  LibraryViewDeletionResult,
  LibraryViewMutationResult,
  MutationFailureCode,
  MutationResult,
  SketchBoardMutationResult,
  TagsMutationResult,
  StoreBackend,
  StoredWorkbookRecord,
} from "./store-backend.js";

interface WorkbookStoreFile {
  records: StoredWorkbookRecord[];
  libraryViews?: WorkbookLibraryView[];
}

const dataRoot = path.resolve(process.cwd(), ".data");
const uploadsDir = path.join(dataRoot, "uploads");
const storeFilePath = path.join(dataRoot, "workbooks.json");
let storeMutationChain = Promise.resolve();
let demoSnapshotState = structuredClone(demoReviewSnapshot);
let demoLibraryViews: WorkbookLibraryView[] = [];

function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim();
  const fallback = trimmed.length > 0 ? trimmed : "workbook.xlsx";

  return fallback.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function createRecordId(fileName: string) {
  const normalized = sanitizeFileName(fileName)
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `wb_${normalized || "upload"}_${Date.now().toString(36)}`;
}

async function ensureStore() {
  await mkdir(uploadsDir, { recursive: true });
}

async function readStore(): Promise<WorkbookStoreFile> {
  await ensureStore();

  try {
    const raw = await readFile(storeFilePath, "utf8");
    const parsed = JSON.parse(raw) as WorkbookStoreFile;

    if (!Array.isArray(parsed.records)) {
      return { records: [] };
    }

    return parsed;
  } catch (error) {
    const isMissing =
      error instanceof Error && "code" in error && error.code === "ENOENT";

    if (isMissing) {
      return { records: [] };
    }

    throw error;
  }
}

async function writeStore(store: WorkbookStoreFile) {
  await ensureStore();
  await writeFile(storeFilePath, JSON.stringify(store, null, 2));
}

function normalizeWorkbookTags(tags: unknown[]): string[] {
  const normalized = new Map<string, string>();

  for (const tag of tags) {
    if (typeof tag !== "string") {
      continue;
    }

    const trimmed = tag.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (!normalized.has(key)) {
      normalized.set(key, trimmed);
    }
  }

  return [...normalized.values()];
}

function normalizeLibraryView(input: {
  id: string;
  name: string;
  updatedBy: string;
  archivedAt?: string;
  archivedBy?: string;
  description?: string;
  searchQuery?: string;
  tags: string[];
  sortBy: WorkbookLibraryView["sortBy"];
  sortDirection: WorkbookLibraryView["sortDirection"];
  pinned?: boolean;
  updatedAt?: string;
}): WorkbookLibraryView {
  return {
    id: input.id,
    name: input.name,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    updatedBy: input.updatedBy,
    archivedAt: input.archivedAt,
    archivedBy: input.archivedBy,
    description: input.description?.trim() || undefined,
    searchQuery: input.searchQuery?.trim() || undefined,
    tags: normalizeWorkbookTags(input.tags),
    sortBy: input.sortBy,
    sortDirection: input.sortDirection,
    pinned: input.pinned,
  };
}

async function runSerializedMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = storeMutationChain.then(operation, operation);
  storeMutationChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function deriveProposalStatus(diff: ProposalDiffEntry[]): ProposalDetail["status"] {
  if (diff.length === 0) {
    return "draft";
  }

  const approvedCount = diff.filter((entry) => entry.status === "approved").length;
  const rejectedCount = diff.filter((entry) => entry.status === "rejected").length;
  const pendingCount = diff.filter((entry) => entry.status === "pending").length;

  if (pendingCount === diff.length) {
    return "pending_approval";
  }

  if (approvedCount === diff.length) {
    return "approved";
  }

  if (rejectedCount === diff.length) {
    return "rejected";
  }

  return "pending_approval";
}

function itemDecisionToStatus(decision: ApprovalDecision): ProposalItemStatus {
  return decision === "approve" ? "approved" : "rejected";
}

function createCommentId(diffId: string) {
  return `${diffId}_comment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMentionHandles(values: unknown[]): string[] {
  const handles = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const normalized = value.trim().replace(/^@/, "").replace(/[.,;:!?]+$/g, "");
    if (normalized) {
      handles.add(normalized);
    }
  }

  return [...handles];
}

function extractMentions(body: string): string[] {
  const matches = body.matchAll(/(?:^|[^A-Za-z0-9._-])@([A-Za-z0-9._-]{2,64})/g);
  return normalizeMentionHandles([...matches].map((match) => match[1]));
}

function createSketchBoard(
  workbookId: string,
  title: string,
  updatedAt: string,
  updatedBy: string,
  notes?: string,
): WorkbookSketchBoard {
  return {
    id: `${workbookId}_sketch_board`,
    workbookId,
    title: `${title} Sketch Board`,
    updatedAt,
    updatedBy,
    nodes: [],
    links: [],
    notes: notes?.trim() || "Sketch board created for workbook review.",
  };
}

if (!demoSnapshotState.workbook.sketchBoard) {
  demoSnapshotState = {
    ...demoSnapshotState,
    workbook: {
      ...demoSnapshotState.workbook,
      sketchBoard: createSketchBoard(
        demoSnapshotState.workbook.id,
        demoSnapshotState.workbook.name,
        demoSnapshotState.workbook.lastReviewedAt,
        "system",
        "Generated from the demo workbook.",
      ),
    },
  };
}

function appendCommentToDiff(
  diff: ProposalDiffEntry[],
  input: {
    diffId: string;
    author: string;
    body: string;
    parentCommentId?: string;
    replyToCommentId?: string;
    mentions?: string[];
  },
  createdAt: string,
) {
  const target = diff.find((entry) => entry.id === input.diffId);

  if (!target) {
    return { error: "item_not_found" as const };
  }

  const comments = target.comments ?? [];
  const replyToCommentId = input.parentCommentId ?? input.replyToCommentId;
  if (replyToCommentId && !comments.some((comment) => comment.id === replyToCommentId)) {
    return { error: "comment_not_found" as const };
  }

  const comment: ProposalItemComment = {
    id: createCommentId(input.diffId),
    author: input.author,
    body: input.body,
    createdAt,
    parentCommentId: replyToCommentId,
    replyToCommentId,
    mentions: normalizeMentionHandles([
      ...extractMentions(input.body),
      ...(input.mentions ?? []),
    ]),
  };

  return {
    nextDiff: diff.map((entry) =>
      entry.id === input.diffId
        ? {
            ...entry,
            comments: [...comments, comment],
          }
        : entry,
    ),
    comment,
  };
}

function hasReviewedItems(diff: ProposalDiffEntry[]) {
  return diff.some((entry) => entry.status !== "pending");
}

function applyDecisionToAllItems(
  diff: ProposalDiffEntry[],
  decision: ApprovalDecision,
  reviewer: string,
  reviewedAt: string,
  comment?: string,
) {
  return diff.map((entry) => ({
    ...entry,
    status: itemDecisionToStatus(decision),
    reviewer,
    reviewedAt,
    reviewComment: comment,
  }));
}

function nextVersionId(currentVersionId: string): string {
  const match = currentVersionId.match(/^(.*?_v)(\d+)$/);

  if (!match) {
    return `${currentVersionId}_next`;
  }

  const prefix = match[1];
  const current = Number.parseInt(match[2], 10);
  return `${prefix}${String(current + 1).padStart(match[2].length, "0")}`;
}

function appendApplyResult(snapshot: WorkbookReviewSnapshot, actor: string, note?: string) {
  if (snapshot.proposal.status === "applied") {
    return null;
  }

  const reviewedAt = new Date().toISOString();
  const approvedItems = snapshot.proposal.diff.filter((entry) => entry.status === "approved");

  if (approvedItems.length === 0) {
    return null;
  }

  const versionId = nextVersionId(snapshot.workbook.latestVersionId);

  return {
    ...snapshot,
    workbook: {
      ...snapshot.workbook,
      latestVersionId: versionId,
      lastReviewedAt: reviewedAt,
      versions: [
        {
          id: versionId,
          createdAt: reviewedAt,
          createdBy: actor,
          note:
            note?.trim() ||
            `Applied ${approvedItems.length} approved proposal item${approvedItems.length === 1 ? "" : "s"}.`,
        },
        ...snapshot.workbook.versions,
      ],
    },
    proposal: {
      ...snapshot.proposal,
      status: "applied" as const,
      appliedAt: reviewedAt,
      appliedBy: actor,
      appliedVersionId: versionId,
      reviewedAt,
      reviewer: actor,
      reviewComment: note?.trim() || snapshot.proposal.reviewComment,
      diff: snapshot.proposal.diff.map((entry) =>
        entry.status === "approved"
          ? {
              ...entry,
              reviewComment:
                entry.reviewComment ??
                "Included in the applied workbook version.",
            }
          : entry,
      ),
    },
    auditEvents: [
      {
        id: `${snapshot.workbook.id}_audit_${snapshot.auditEvents.length + 1}`,
        workbookId: snapshot.workbook.id,
        actor,
        action: "proposal.applied",
        detail:
          note?.trim() ||
          `Applied ${approvedItems.length} approved proposal item${approvedItems.length === 1 ? "" : "s"} to workbook version ${versionId}.`,
        createdAt: reviewedAt,
      },
      ...snapshot.auditEvents,
    ],
  };
}

function mutationSuccess(review: WorkbookReviewSnapshot): MutationResult {
  return { ok: true, review };
}

function mutationFailure(code: MutationFailureCode): MutationResult {
  return { ok: false, code };
}

export function createFileStoreBackend(): StoreBackend {
  return {
    async listStoredWorkbooks(): Promise<WorkbookSummary[]> {
      const store = await readStore();
      const persisted = store.records.map((record) => ({
        id: record.snapshot.workbook.id,
        name: record.snapshot.workbook.name,
        latestVersionId: record.snapshot.workbook.latestVersionId,
        sheetCount: record.snapshot.workbook.sheetCount,
        createdAt: record.snapshot.workbook.createdAt,
        tags: record.snapshot.workbook.tags,
      }));

      return [
        {
          id: demoSnapshotState.workbook.id,
          name: demoSnapshotState.workbook.name,
          latestVersionId: demoSnapshotState.workbook.latestVersionId,
          sheetCount: demoSnapshotState.workbook.sheetCount,
          createdAt: demoSnapshotState.workbook.createdAt,
          tags: demoSnapshotState.workbook.tags,
        },
        ...persisted,
      ];
    },

    async getStoredWorkbookReview(workbookId: string): Promise<WorkbookReviewSnapshot | null> {
      if (workbookId === demoSnapshotState.workbook.id) {
        return demoSnapshotState;
      }

      const store = await readStore();
      const match = store.records.find((record) => record.snapshot.workbook.id === workbookId);

      return match?.snapshot ?? null;
    },

    async getStoredWorkbookTags(workbookId: string): Promise<string[] | null> {
      if (workbookId === demoSnapshotState.workbook.id) {
        return [...demoSnapshotState.workbook.tags];
      }

      const store = await readStore();
      const match = store.records.find((record) => record.snapshot.workbook.id === workbookId);

      return match?.snapshot.workbook.tags ?? null;
    },

    async getStoredSketchBoard(workbookId: string): Promise<WorkbookSketchBoard | null> {
      if (workbookId === demoSnapshotState.workbook.id) {
        return (
          demoSnapshotState.workbook.sketchBoard ??
          createSketchBoard(
            demoSnapshotState.workbook.id,
            demoSnapshotState.workbook.name,
            demoSnapshotState.workbook.lastReviewedAt,
            "system",
            "Generated from the demo workbook.",
          )
        );
      }

      const store = await readStore();
      const match = store.records.find((record) => record.snapshot.workbook.id === workbookId);

      if (!match) {
        return null;
      }

      if (!match.snapshot.workbook.sketchBoard) {
        match.snapshot = {
          ...match.snapshot,
          workbook: {
            ...match.snapshot.workbook,
            sketchBoard: createSketchBoard(
              match.snapshot.workbook.id,
              match.snapshot.workbook.name,
              match.snapshot.workbook.lastReviewedAt,
              "system",
            ),
          },
        };

        await writeStore(store);
      }

      return match.snapshot.workbook.sketchBoard ?? null;
    },

    async updateStoredWorkbookTags(input: {
      workbookId: string;
      tags: string[];
      updatedBy: string;
    }): Promise<TagsMutationResult> {
      const updatedAt = new Date().toISOString();
      const tags = normalizeWorkbookTags(input.tags);

      if (input.workbookId === demoSnapshotState.workbook.id) {
        demoSnapshotState = {
          ...demoSnapshotState,
          workbook: {
            ...demoSnapshotState.workbook,
            tags,
          },
          auditEvents: [
            ...demoSnapshotState.auditEvents,
            {
              id: `audit_${demoSnapshotState.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: input.updatedBy,
              action: "workbook.tags.updated",
              detail: `Workbook tags updated to ${tags.length > 0 ? tags.join(", ") : "none"}.`,
              createdAt: updatedAt,
            },
          ],
        };

        return { ok: true, tags };
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const record = store.records.find((entry) => entry.snapshot.workbook.id === input.workbookId);

        if (!record) {
          return { ok: false, code: "not_found" };
        }

        record.snapshot = {
          ...record.snapshot,
          workbook: {
            ...record.snapshot.workbook,
            tags,
          },
          auditEvents: [
            ...record.snapshot.auditEvents,
            {
              id: `${input.workbookId}_audit_${record.snapshot.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: input.updatedBy,
              action: "workbook.tags.updated",
              detail: `Workbook tags updated to ${tags.length > 0 ? tags.join(", ") : "none"}.`,
              createdAt: updatedAt,
            },
          ],
        };

        await writeStore(store);
        return { ok: true, tags };
      });
    },

    async saveUploadedWorkbook(input: {
      fileName: string;
      contentType: string;
      bytes: Uint8Array;
    }): Promise<StoredWorkbookRecord> {
      return runSerializedMutation(async () => {
        await ensureStore();

        const storedAt = new Date().toISOString();
        const recordId = createRecordId(input.fileName);
        const sanitizedFileName = sanitizeFileName(input.fileName);
        const uploadPath = path.join(uploadsDir, `${recordId}-${sanitizedFileName}`);

        await writeFile(uploadPath, input.bytes);

        try {
          const snapshot = parseWorkbookReviewSnapshot({
            workbookId: recordId,
            fileName: input.fileName,
            uploadedAt: storedAt,
            bytes: input.bytes,
          });

          const record: StoredWorkbookRecord = {
            id: recordId,
            fileName: input.fileName,
            contentType: input.contentType || "application/octet-stream",
            fileSize: input.bytes.byteLength,
            storedAt,
            uploadPath,
            snapshot,
          };

          const store = await readStore();
          store.records.unshift(record);
          await writeStore(store);

          return record;
        } catch (error) {
          await unlink(uploadPath).catch(() => undefined);
          throw error;
        }
      });
    },

    async updateStoredProposalDecision(input: {
      workbookId: string;
      decision: ApprovalDecision;
      reviewer: string;
      comment?: string;
    }): Promise<MutationResult> {
      if (input.workbookId === demoSnapshotState.workbook.id) {
        if (demoSnapshotState.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        if (hasReviewedItems(demoSnapshotState.proposal.diff)) {
          return mutationFailure("review_path_locked");
        }

        const reviewedAt = new Date().toISOString();
        const nextDiff = applyDecisionToAllItems(
          demoSnapshotState.proposal.diff,
          input.decision,
          input.reviewer,
          reviewedAt,
          input.comment,
        );

        demoSnapshotState = {
          ...demoSnapshotState,
          proposal: {
            ...demoSnapshotState.proposal,
            diff: nextDiff,
            status: deriveProposalStatus(nextDiff),
            reviewer: input.reviewer,
            reviewedAt,
            reviewComment: input.comment,
          },
          auditEvents: [
            ...demoSnapshotState.auditEvents,
            {
              id: `audit_${demoSnapshotState.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: input.reviewer,
              action:
                input.decision === "approve" ? "proposal.approved" : "proposal.rejected",
              detail:
                input.comment?.trim() ||
                (input.decision === "approve"
                  ? "Proposal approved in the review prototype."
                  : "Proposal rejected in the review prototype."),
              createdAt: reviewedAt,
            },
          ],
        };

        return mutationSuccess(demoSnapshotState);
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const record = store.records.find((entry) => entry.snapshot.workbook.id === input.workbookId);

        if (!record) {
          return mutationFailure("not_found");
        }

        if (record.snapshot.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        if (hasReviewedItems(record.snapshot.proposal.diff)) {
          return mutationFailure("review_path_locked");
        }

        const reviewedAt = new Date().toISOString();
        const nextDiff = applyDecisionToAllItems(
          record.snapshot.proposal.diff,
          input.decision,
          input.reviewer,
          reviewedAt,
          input.comment,
        );

        record.snapshot = {
          ...record.snapshot,
          proposal: {
            ...record.snapshot.proposal,
            diff: nextDiff,
            status: deriveProposalStatus(nextDiff),
            reviewer: input.reviewer,
            reviewedAt,
            reviewComment: input.comment,
          },
          auditEvents: [
            ...record.snapshot.auditEvents,
            {
              id: `${input.workbookId}_audit_${record.snapshot.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: input.reviewer,
              action:
                input.decision === "approve" ? "proposal.approved" : "proposal.rejected",
              detail:
                input.comment?.trim() ||
                (input.decision === "approve"
                  ? "Proposal approved in the review prototype."
                  : "Proposal rejected in the review prototype."),
              createdAt: reviewedAt,
            },
          ],
        };

        await writeStore(store);
        return mutationSuccess(record.snapshot);
      });
    },

    async updateStoredProposalItemDecision(input: {
      workbookId: string;
      diffId: string;
      decision: ApprovalDecision;
      reviewer: string;
      comment?: string;
    }): Promise<MutationResult> {
      const reviewedAt = new Date().toISOString();

      if (input.workbookId === demoSnapshotState.workbook.id) {
        if (demoSnapshotState.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        if (demoSnapshotState.proposal.status !== "pending_approval") {
          return mutationFailure("locked");
        }

        const hasMatch = demoSnapshotState.proposal.diff.some((entry) => entry.id === input.diffId);

        if (!hasMatch) {
          return mutationFailure("item_not_found");
        }

        const nextDiff = demoSnapshotState.proposal.diff.map((entry) =>
          entry.id === input.diffId
            ? {
                ...entry,
                status: itemDecisionToStatus(input.decision),
                reviewer: input.reviewer,
                reviewedAt,
                reviewComment: input.comment,
              }
            : entry,
        );

        demoSnapshotState = {
          ...demoSnapshotState,
          proposal: {
            ...demoSnapshotState.proposal,
            diff: nextDiff,
            status: deriveProposalStatus(nextDiff),
            reviewer: input.reviewer,
            reviewedAt,
            reviewComment: input.comment,
          },
          auditEvents: [
            ...demoSnapshotState.auditEvents,
            {
              id: `audit_${demoSnapshotState.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: input.reviewer,
              action:
                input.decision === "approve"
                  ? "proposal.item.approved"
                  : "proposal.item.rejected",
              detail:
                input.comment?.trim() ||
                `${input.decision === "approve" ? "Approved" : "Rejected"} proposal item ${input.diffId}.`,
              createdAt: reviewedAt,
            },
          ],
        };

        return mutationSuccess(demoSnapshotState);
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const record = store.records.find((entry) => entry.snapshot.workbook.id === input.workbookId);

        if (!record) {
          return mutationFailure("not_found");
        }

        if (record.snapshot.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        if (record.snapshot.proposal.status !== "pending_approval") {
          return mutationFailure("locked");
        }

        const hasMatch = record.snapshot.proposal.diff.some((entry) => entry.id === input.diffId);

        if (!hasMatch) {
          return mutationFailure("item_not_found");
        }

        const existing = record.snapshot.proposal.diff.find((entry) => entry.id === input.diffId);

        if (existing && existing.status !== "pending") {
          return mutationFailure("locked");
        }

        const nextDiff = record.snapshot.proposal.diff.map((entry) =>
          entry.id === input.diffId
            ? {
                ...entry,
                status: itemDecisionToStatus(input.decision),
                reviewer: input.reviewer,
                reviewedAt,
                reviewComment: input.comment,
              }
            : entry,
        );

        record.snapshot = {
          ...record.snapshot,
          proposal: {
            ...record.snapshot.proposal,
            diff: nextDiff,
            status: deriveProposalStatus(nextDiff),
            reviewer: input.reviewer,
            reviewedAt,
            reviewComment: input.comment,
          },
          auditEvents: [
            ...record.snapshot.auditEvents,
            {
              id: `${input.workbookId}_audit_${record.snapshot.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: input.reviewer,
              action:
                input.decision === "approve"
                  ? "proposal.item.approved"
                  : "proposal.item.rejected",
              detail:
                input.comment?.trim() ||
                `${input.decision === "approve" ? "Approved" : "Rejected"} proposal item ${input.diffId}.`,
              createdAt: reviewedAt,
            },
          ],
        };

        await writeStore(store);
        return mutationSuccess(record.snapshot);
      });
    },

    async appendStoredProposalItemComment(input: {
      workbookId: string;
      diffId: string;
      author: string;
      body: string;
      parentCommentId?: string;
      replyToCommentId?: string;
      mentions?: string[];
    }): Promise<MutationResult> {
      const createdAt = new Date().toISOString();

      if (input.workbookId === demoSnapshotState.workbook.id) {
        if (demoSnapshotState.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        const appended = appendCommentToDiff(demoSnapshotState.proposal.diff, input, createdAt);
        if ("error" in appended) {
          return mutationFailure(
            appended.error === "item_not_found" ? "item_not_found" : "comment_not_found",
          );
        }

        demoSnapshotState = {
          ...demoSnapshotState,
          proposal: {
            ...demoSnapshotState.proposal,
            diff: appended.nextDiff,
          },
          auditEvents: [
            ...demoSnapshotState.auditEvents,
            {
              id: `audit_${demoSnapshotState.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: input.author,
              action: "proposal.item.commented",
              detail: `Comment added to proposal item ${input.diffId}.`,
              createdAt,
            },
          ],
        };

        return mutationSuccess(demoSnapshotState);
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const record = store.records.find((entry) => entry.snapshot.workbook.id === input.workbookId);

        if (!record) {
          return mutationFailure("not_found");
        }

        if (record.snapshot.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        const appended = appendCommentToDiff(record.snapshot.proposal.diff, input, createdAt);
        if ("error" in appended) {
          return mutationFailure(
            appended.error === "item_not_found" ? "item_not_found" : "comment_not_found",
          );
        }

        record.snapshot = {
          ...record.snapshot,
          proposal: {
            ...record.snapshot.proposal,
            diff: appended.nextDiff,
          },
          auditEvents: [
            ...record.snapshot.auditEvents,
            {
              id: `${input.workbookId}_audit_${record.snapshot.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: input.author,
              action: "proposal.item.commented",
              detail: `Comment added to proposal item ${input.diffId}.`,
              createdAt,
            },
          ],
        };

        await writeStore(store);
        return mutationSuccess(record.snapshot);
      });
    },

    async updateStoredSketchBoard(input: {
      workbookId: string;
      title: string;
      updatedBy: string;
      nodes: WorkbookSketchBoard["nodes"];
      links: WorkbookSketchBoard["links"];
      notes?: string;
    }): Promise<SketchBoardMutationResult> {
      const updatedAt = new Date().toISOString();

      if (input.workbookId === demoSnapshotState.workbook.id) {
        const sketchBoard: WorkbookSketchBoard = {
          id: `${demoSnapshotState.workbook.id}_sketch_board`,
          workbookId: demoSnapshotState.workbook.id,
          title: input.title.trim() || `${demoSnapshotState.workbook.name} Sketch Board`,
          updatedAt,
          updatedBy: input.updatedBy,
          nodes: [...input.nodes],
          links: [...input.links],
          notes: input.notes?.trim() || undefined,
        };

        demoSnapshotState = {
          ...demoSnapshotState,
          workbook: {
            ...demoSnapshotState.workbook,
            sketchBoard,
          },
          auditEvents: [
            ...demoSnapshotState.auditEvents,
            {
              id: `audit_${demoSnapshotState.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: input.updatedBy,
              action: "sketch.updated",
              detail: "Workbook sketch board updated.",
              createdAt: updatedAt,
            },
          ],
        };

        return { ok: true, sketchBoard };
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const record = store.records.find((entry) => entry.snapshot.workbook.id === input.workbookId);

        if (!record) {
          return { ok: false, code: "not_found" };
        }

        const sketchBoard: WorkbookSketchBoard = {
          id: `${record.snapshot.workbook.id}_sketch_board`,
          workbookId: record.snapshot.workbook.id,
          title: input.title.trim() || `${record.snapshot.workbook.name} Sketch Board`,
          updatedAt,
          updatedBy: input.updatedBy,
          nodes: [...input.nodes],
          links: [...input.links],
          notes: input.notes?.trim() || undefined,
        };

        record.snapshot = {
          ...record.snapshot,
          workbook: {
            ...record.snapshot.workbook,
            sketchBoard,
          },
          auditEvents: [
            ...record.snapshot.auditEvents,
            {
              id: `${input.workbookId}_audit_${record.snapshot.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: input.updatedBy,
              action: "sketch.updated",
              detail: "Workbook sketch board updated.",
              createdAt: updatedAt,
            },
          ],
        };

        await writeStore(store);
        return { ok: true, sketchBoard };
      });
    },

    async listStoredWorkbookLibraryViews(options?: {
      includeArchived?: boolean;
    }): Promise<WorkbookLibraryView[]> {
      const store = await readStore();
      const views = Array.isArray(store.libraryViews) ? store.libraryViews : demoLibraryViews;
      return options?.includeArchived ? views : views.filter((view) => !view.archivedAt);
    },

    async saveStoredWorkbookLibraryView(input: {
      id: string;
      name: string;
      updatedBy: string;
      description?: string;
      searchQuery?: string;
      tags: string[];
      sortBy: WorkbookLibraryView["sortBy"];
      sortDirection: WorkbookLibraryView["sortDirection"];
      pinned?: boolean;
    }): Promise<LibraryViewMutationResult> {
      if (input.id.startsWith("demo_")) {
        const existingView = demoLibraryViews.find((entry) => entry.id === input.id);
        const view = normalizeLibraryView({
          ...input,
          updatedAt: new Date().toISOString(),
          archivedAt: existingView?.archivedAt,
          archivedBy: existingView?.archivedBy,
        });

        demoLibraryViews = [
          ...demoLibraryViews.filter((entry) => entry.id !== view.id),
          view,
        ];
        return { ok: true, view };
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const existingViews = Array.isArray(store.libraryViews) ? store.libraryViews : [];
        const existingView = existingViews.find((entry) => entry.id === input.id);
        const view = normalizeLibraryView({
          ...input,
          updatedAt: new Date().toISOString(),
          archivedAt: existingView?.archivedAt,
          archivedBy: existingView?.archivedBy,
        });
        const nextViews = [
          ...existingViews.filter((entry) => entry.id !== view.id),
          view,
        ];

        store.libraryViews = nextViews;
        await writeStore(store);
        return { ok: true, view };
      });
    },

    async archiveStoredWorkbookLibraryView(input: {
      id: string;
      archivedBy: string;
    }): Promise<LibraryViewMutationResult> {
      const archivedAt = new Date().toISOString();

      if (input.id.startsWith("demo_")) {
        const existingView = demoLibraryViews.find((entry) => entry.id === input.id);

        if (!existingView) {
          return { ok: false, code: "not_found" };
        }

        const view = normalizeLibraryView({
          ...existingView,
          updatedAt: archivedAt,
          updatedBy: input.archivedBy,
          archivedAt,
          archivedBy: input.archivedBy,
        });

        demoLibraryViews = [
          ...demoLibraryViews.filter((entry) => entry.id !== input.id),
          view,
        ];
        return { ok: true, view };
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const existingView = (store.libraryViews ?? []).find((entry) => entry.id === input.id);

        if (!existingView) {
          return { ok: false, code: "not_found" } as const;
        }

        const view = normalizeLibraryView({
          ...existingView,
          updatedAt: archivedAt,
          updatedBy: input.archivedBy,
          archivedAt,
          archivedBy: input.archivedBy,
        });

        store.libraryViews = [
          ...(store.libraryViews ?? []).filter((entry) => entry.id !== input.id),
          view,
        ];
        await writeStore(store);
        return { ok: true, view };
      });
    },

    async deleteStoredWorkbookLibraryView(input: {
      id: string;
    }): Promise<LibraryViewDeletionResult> {
      if (input.id.startsWith("demo_")) {
        const existingView = demoLibraryViews.find((entry) => entry.id === input.id);

        if (!existingView) {
          return { ok: false, code: "not_found" };
        }

        demoLibraryViews = demoLibraryViews.filter((entry) => entry.id !== input.id);
        return { ok: true, deletedId: input.id };
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const existingView = (store.libraryViews ?? []).find((entry) => entry.id === input.id);

        if (!existingView) {
          return { ok: false, code: "not_found" };
        }

        store.libraryViews = (store.libraryViews ?? []).filter((entry) => entry.id !== input.id);
        await writeStore(store);
        return { ok: true, deletedId: input.id };
      });
    },

    async applyApprovedProposalItems(input: {
      workbookId: string;
      actor: string;
      note?: string;
    }): Promise<MutationResult> {
      if (input.workbookId === demoSnapshotState.workbook.id) {
        const nextSnapshot = appendApplyResult(demoSnapshotState, input.actor, input.note);

        if (!nextSnapshot) {
          return mutationFailure(
            demoSnapshotState.proposal.status === "applied"
              ? "already_applied"
              : "nothing_to_apply",
          );
        }

        demoSnapshotState = nextSnapshot;
        return mutationSuccess(demoSnapshotState);
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const record = store.records.find((entry) => entry.snapshot.workbook.id === input.workbookId);

        if (!record) {
          return mutationFailure("not_found");
        }

        const nextSnapshot = appendApplyResult(record.snapshot, input.actor, input.note);

        if (!nextSnapshot) {
          return mutationFailure(
            record.snapshot.proposal.status === "applied"
              ? "already_applied"
              : "nothing_to_apply",
          );
        }

        record.snapshot = nextSnapshot;
        await writeStore(store);
        return mutationSuccess(record.snapshot);
      });
    },
  };
}
