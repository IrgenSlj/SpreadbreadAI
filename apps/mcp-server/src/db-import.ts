import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  ReviewerNotification,
  ReviewerProfile,
  ReviewerSession,
  WorkbookReviewSnapshot,
  WorkbookVersionSummary,
} from "../../../packages/shared/src/index.js";
import { hasPostgresConfig } from "./postgres.js";
import { importReviewerState, importStoredWorkbookRecords } from "./postgres-store.js";
import type { StoredWorkbookRecord } from "./store-backend.js";

interface FileStorePayload {
  records: StoredWorkbookRecord[];
  notifications?: ReviewerNotification[];
  reviewerProfiles?: ReviewerProfile[];
  reviewers?: ReviewerProfile[];
  currentReviewerSession?: ReviewerSession;
}

const dataRoot = path.resolve(process.cwd(), ".data");
const storeFilePath = path.join(dataRoot, "workbooks.json");

async function readFileStorePayload(): Promise<FileStorePayload> {
  try {
    const raw = await readFile(storeFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<FileStorePayload>;

    if (!Array.isArray(parsed.records)) {
      return { records: [] };
    }

    return { records: parsed.records as StoredWorkbookRecord[] };
  } catch (error) {
    const isMissing =
      error instanceof Error && "code" in error && error.code === "ENOENT";

    if (isMissing) {
      return { records: [] };
    }

    throw error;
  }
}

function normalizeSnapshot(snapshot: WorkbookReviewSnapshot): WorkbookReviewSnapshot {
  const versions = Array.isArray(snapshot.workbook.versions) ? snapshot.workbook.versions : [];

  if (versions.length > 0) {
    return snapshot;
  }

  const inferredVersion: WorkbookVersionSummary = {
    id: snapshot.workbook.latestVersionId,
    createdAt: snapshot.workbook.lastReviewedAt || snapshot.workbook.createdAt,
    createdBy: snapshot.proposal.appliedBy || snapshot.proposal.reviewer || "system",
    note:
      snapshot.proposal.appliedVersionId === snapshot.workbook.latestVersionId
        ? "Recovered applied workbook version from legacy file-store snapshot"
        : "Recovered initial workbook version from legacy file-store snapshot",
  };

  return {
    ...snapshot,
    workbook: {
      ...snapshot.workbook,
      versions: [inferredVersion],
    },
  };
}

async function main() {
  if (!hasPostgresConfig()) {
    throw new Error("DATABASE_URL is required to import file-store data into PostgreSQL");
  }

  const payload = await readFileStorePayload();

  if (payload.records.length === 0) {
    console.log("[db-import] no file-store records found");
    return;
  }

  const normalizedRecords = payload.records.map((record) => ({
    ...record,
    snapshot: normalizeSnapshot(record.snapshot),
  }));

  const result = await importStoredWorkbookRecords({
    records: normalizedRecords,
    notifications: Array.isArray(payload.notifications) ? payload.notifications : [],
  });

  const reviewerState = await importReviewerState({
    profiles:
      Array.isArray(payload.reviewerProfiles) && payload.reviewerProfiles.length > 0
        ? payload.reviewerProfiles
        : Array.isArray(payload.reviewers)
          ? payload.reviewers
          : undefined,
    currentReviewerSession: payload.currentReviewerSession ?? null,
  });

  console.log(
    JSON.stringify(
      {
        status: "ok",
        imported: result.imported,
        skipped: result.skipped,
        workbookIds: result.workbookIds,
        reviewerProfilesImported: reviewerState.importedProfiles,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[db-import] fatal error", error);
  process.exitCode = 1;
});
