import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  demoReviewSnapshot,
  type WorkbookReviewSnapshot,
  type WorkbookSummary,
} from "../../../packages/shared/src/index.js";
import { parseWorkbookReviewSnapshot } from "./parser.js";

export interface StoredWorkbookRecord {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  storedAt: string;
  uploadPath: string;
  snapshot: WorkbookReviewSnapshot;
}

interface WorkbookStoreFile {
  records: StoredWorkbookRecord[];
}

const dataRoot = path.resolve(process.cwd(), ".data");
const uploadsDir = path.join(dataRoot, "uploads");
const storeFilePath = path.join(dataRoot, "workbooks.json");

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

export async function listStoredWorkbooks(): Promise<WorkbookSummary[]> {
  const store = await readStore();
  const persisted = store.records.map((record) => ({
    id: record.snapshot.workbook.id,
    name: record.snapshot.workbook.name,
    latestVersionId: record.snapshot.workbook.latestVersionId,
    sheetCount: record.snapshot.workbook.sheetCount,
    createdAt: record.snapshot.workbook.createdAt,
  }));

  return [
    {
      id: demoReviewSnapshot.workbook.id,
      name: demoReviewSnapshot.workbook.name,
      latestVersionId: demoReviewSnapshot.workbook.latestVersionId,
      sheetCount: demoReviewSnapshot.workbook.sheetCount,
      createdAt: demoReviewSnapshot.workbook.createdAt,
    },
    ...persisted,
  ];
}

export async function getStoredWorkbookReview(
  workbookId: string,
): Promise<WorkbookReviewSnapshot | null> {
  if (workbookId === demoReviewSnapshot.workbook.id) {
    return demoReviewSnapshot;
  }

  const store = await readStore();
  const match = store.records.find((record) => record.snapshot.workbook.id === workbookId);

  return match?.snapshot ?? null;
}

export async function saveUploadedWorkbook(input: {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<StoredWorkbookRecord> {
  await ensureStore();

  const storedAt = new Date().toISOString();
  const recordId = createRecordId(input.fileName);
  const sanitizedFileName = sanitizeFileName(input.fileName);
  const uploadPath = path.join(uploadsDir, `${recordId}-${sanitizedFileName}`);

  await writeFile(uploadPath, input.bytes);

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
}
