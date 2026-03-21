import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ApprovalDecision,
  ProposalDetail,
  ProposalDiffEntry,
  ProposalItemStatus,
  WorkbookDetail,
  WorkbookNamedRange,
  WorkbookReviewSnapshot,
  WorkbookRisk,
  WorkbookSheetSummary,
  WorkbookSummary,
  WorkbookVersionSummary,
} from "../../../packages/shared/src/index.js";
import { parseWorkbookReviewSnapshot } from "./parser.js";
import { withTransaction } from "./postgres.js";
import type {
  MutationFailureCode,
  MutationResult,
  StoreBackend,
  StoredWorkbookRecord,
} from "./store-backend.js";

type PgClient = Parameters<typeof withTransaction>[0] extends (client: infer T) => Promise<unknown>
  ? T
  : never;

const dataRoot = path.resolve(process.cwd(), ".data");
const uploadsDir = path.join(dataRoot, "uploads");

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

async function ensureUploadsDir() {
  await mkdir(uploadsDir, { recursive: true });
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

function mutationSuccess(review: WorkbookReviewSnapshot): MutationResult {
  return { ok: true, review };
}

function mutationFailure(code: MutationFailureCode): MutationResult {
  return { ok: false, code };
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

async function insertSnapshot(
  client: PgClient,
  snapshot: WorkbookReviewSnapshot,
  uploadPath: string | null,
) {
  const workbook = snapshot.workbook;
  const latestVersion = workbook.versions[0];

  await client.query(
    `insert into workbooks (id, name, owner, status, created_at, last_reviewed_at, latest_version_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (id) do update set
       name = excluded.name,
       owner = excluded.owner,
       status = excluded.status,
       created_at = excluded.created_at,
       last_reviewed_at = excluded.last_reviewed_at,
       latest_version_id = excluded.latest_version_id`,
    [
      workbook.id,
      workbook.name,
      workbook.owner,
      workbook.status,
      workbook.createdAt,
      workbook.lastReviewedAt,
      workbook.latestVersionId,
    ],
  );

  await client.query(
    `insert into workbook_versions (id, workbook_id, created_at, created_by, note, artifact_path)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do nothing`,
    [
      latestVersion.id,
      workbook.id,
      latestVersion.createdAt,
      latestVersion.createdBy,
      latestVersion.note,
      uploadPath,
    ],
  );

  for (const sheet of workbook.sheets) {
    await client.query(
      `insert into workbook_sheets
       (workbook_version_id, name, rows, columns_count, formula_cells, populated_cells, risk_count, sample_rows_json)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       on conflict (workbook_version_id, name) do update set
         rows = excluded.rows,
         columns_count = excluded.columns_count,
         formula_cells = excluded.formula_cells,
         populated_cells = excluded.populated_cells,
         risk_count = excluded.risk_count,
         sample_rows_json = excluded.sample_rows_json`,
      [
        latestVersion.id,
        sheet.name,
        sheet.rows,
        sheet.columns,
        sheet.formulaCells,
        sheet.populatedCells,
        sheet.riskCount,
        JSON.stringify(sheet.sampleRows),
      ],
    );
  }

  for (const namedRange of workbook.namedRanges) {
    await client.query(
      `insert into workbook_named_ranges (workbook_version_id, name, sheet_name, reference)
       values ($1, $2, $3, $4)
       on conflict (workbook_version_id, name) do update set
         sheet_name = excluded.sheet_name,
         reference = excluded.reference`,
      [latestVersion.id, namedRange.name, namedRange.sheetName ?? null, namedRange.reference],
    );
  }

  for (const risk of workbook.risks) {
    await client.query(
      `insert into workbook_risks (workbook_version_id, id, label, severity, location, summary)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (workbook_version_id, id) do update set
         label = excluded.label,
         severity = excluded.severity,
         location = excluded.location,
         summary = excluded.summary`,
      [latestVersion.id, risk.id, risk.label, risk.severity, risk.location, risk.summary],
    );
  }

  const proposal = snapshot.proposal;
  await client.query(
    `insert into proposals
     (id, workbook_id, workbook_version_id, title, status, created_at, requested_by, summary, approval_required, reviewer, reviewed_at, review_comment, applied_at, applied_by, applied_version_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     on conflict (id) do update set
       workbook_version_id = excluded.workbook_version_id,
       title = excluded.title,
       status = excluded.status,
       requested_by = excluded.requested_by,
       summary = excluded.summary,
       approval_required = excluded.approval_required,
       reviewer = excluded.reviewer,
       reviewed_at = excluded.reviewed_at,
       review_comment = excluded.review_comment,
       applied_at = excluded.applied_at,
       applied_by = excluded.applied_by,
       applied_version_id = excluded.applied_version_id`,
    [
      proposal.id,
      workbook.id,
      latestVersion.id,
      proposal.title,
      proposal.status,
      proposal.createdAt,
      proposal.requestedBy,
      proposal.summary,
      proposal.approvalRequired,
      proposal.reviewer ?? null,
      proposal.reviewedAt ?? null,
      proposal.reviewComment ?? null,
      proposal.appliedAt ?? null,
      proposal.appliedBy ?? null,
      proposal.appliedVersionId ?? null,
    ],
  );

  for (const item of proposal.diff) {
    await client.query(
      `insert into proposal_items
       (id, proposal_id, kind, cell, before_value, after_value, rationale, status, reviewer, reviewed_at, review_comment)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (id) do update set
         kind = excluded.kind,
         cell = excluded.cell,
         before_value = excluded.before_value,
         after_value = excluded.after_value,
         rationale = excluded.rationale,
         status = excluded.status,
         reviewer = excluded.reviewer,
         reviewed_at = excluded.reviewed_at,
         review_comment = excluded.review_comment`,
      [
        item.id,
        proposal.id,
        item.kind,
        item.cell,
        item.before ?? null,
        item.after ?? null,
        item.rationale,
        item.status,
        item.reviewer ?? null,
        item.reviewedAt ?? null,
        item.reviewComment ?? null,
      ],
    );
  }

  for (const event of snapshot.auditEvents) {
    await client.query(
      `insert into audit_events (id, workbook_id, actor, action, detail, created_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do nothing`,
      [event.id, event.workbookId, event.actor, event.action, event.detail, event.createdAt],
    );
  }
}

async function buildWorkbookSummaryRows(client: PgClient): Promise<WorkbookSummary[]> {
  const result = await client.query<{
    id: string;
    name: string;
    latest_version_id: string;
    created_at: string;
    sheet_count: string;
  }>(
    `select
       w.id,
       w.name,
       w.latest_version_id,
       w.created_at,
       count(ws.name)::text as sheet_count
     from workbooks w
     left join workbook_sheets ws on ws.workbook_version_id = w.latest_version_id
     group by w.id, w.name, w.latest_version_id, w.created_at
     order by w.created_at desc`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    latestVersionId: row.latest_version_id,
    sheetCount: Number.parseInt(row.sheet_count, 10),
    createdAt: row.created_at,
  }));
}

async function loadSnapshot(client: PgClient, workbookId: string): Promise<WorkbookReviewSnapshot | null> {
  const workbookResult = await client.query<{
    id: string;
    name: string;
    owner: string;
    status: "healthy" | "needs_review";
    created_at: string;
    last_reviewed_at: string;
    latest_version_id: string;
  }>(
    `select id, name, owner, status, created_at, last_reviewed_at, latest_version_id
     from workbooks
     where id = $1`,
    [workbookId],
  );

  const workbookRow = workbookResult.rows[0];
  if (!workbookRow) {
    return null;
  }

  const [versionsResult, sheetsResult, rangesResult, risksResult, proposalResult, itemsResult, auditsResult] =
    await Promise.all([
      client.query<{
        id: string;
        created_at: string;
        created_by: string;
        note: string;
      }>(
        `select id, created_at, created_by, note
         from workbook_versions
         where workbook_id = $1
         order by created_at desc`,
        [workbookId],
      ),
      client.query<{
        name: string;
        rows: number;
        columns_count: number;
        formula_cells: number;
        populated_cells: number;
        risk_count: number;
        sample_rows_json: string[][];
      }>(
        `select name, rows, columns_count, formula_cells, populated_cells, risk_count, sample_rows_json
         from workbook_sheets
         where workbook_version_id = $1
         order by name asc`,
        [workbookRow.latest_version_id],
      ),
      client.query<{
        name: string;
        sheet_name: string | null;
        reference: string;
      }>(
        `select name, sheet_name, reference
         from workbook_named_ranges
         where workbook_version_id = $1
         order by name asc`,
        [workbookRow.latest_version_id],
      ),
      client.query<{
        id: string;
        label: string;
        severity: "low" | "medium" | "high";
        location: string;
        summary: string;
      }>(
        `select id, label, severity, location, summary
         from workbook_risks
         where workbook_version_id = $1
         order by id asc`,
        [workbookRow.latest_version_id],
      ),
      client.query<{
        id: string;
        workbook_id: string;
        title: string;
        status: ProposalDetail["status"];
        created_at: string;
        requested_by: string;
        summary: string;
        approval_required: boolean;
        reviewer: string | null;
        reviewed_at: string | null;
        review_comment: string | null;
        applied_at: string | null;
        applied_by: string | null;
        applied_version_id: string | null;
      }>(
        `select
           id, workbook_id, title, status, created_at, requested_by, summary,
           approval_required, reviewer, reviewed_at, review_comment, applied_at, applied_by, applied_version_id
         from proposals
         where workbook_id = $1
         order by created_at desc
         limit 1`,
        [workbookId],
      ),
      client.query<{
        id: string;
        proposal_id: string;
        kind: ProposalDiffEntry["kind"];
        cell: string;
        before_value: string | null;
        after_value: string | null;
        rationale: string;
        status: ProposalItemStatus;
        reviewer: string | null;
        reviewed_at: string | null;
        review_comment: string | null;
      }>(
        `select
           id, proposal_id, kind, cell, before_value, after_value, rationale,
           status, reviewer, reviewed_at, review_comment
         from proposal_items
         where proposal_id in (
           select id from proposals where workbook_id = $1 order by created_at desc limit 1
         )
         order by id asc`,
        [workbookId],
      ),
      client.query<{
        id: string;
        workbook_id: string;
        actor: string;
        action: string;
        detail: string;
        created_at: string;
      }>(
        `select id, workbook_id, actor, action, detail, created_at
         from audit_events
         where workbook_id = $1
         order by created_at desc, id desc`,
        [workbookId],
      ),
    ]);

  const proposalRow = proposalResult.rows[0];
  if (!proposalRow) {
    return null;
  }

  const versions: WorkbookVersionSummary[] = versionsResult.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    note: row.note,
  }));
  const sheets: WorkbookSheetSummary[] = sheetsResult.rows.map((row) => ({
    name: row.name,
    rows: Number(row.rows),
    columns: Number(row.columns_count),
    formulaCells: Number(row.formula_cells),
    populatedCells: Number(row.populated_cells),
    riskCount: Number(row.risk_count),
    sampleRows: Array.isArray(row.sample_rows_json) ? row.sample_rows_json : [],
  }));
  const namedRanges: WorkbookNamedRange[] = rangesResult.rows.map((row) => ({
    name: row.name,
    sheetName: row.sheet_name ?? undefined,
    reference: row.reference,
  }));
  const risks: WorkbookRisk[] = risksResult.rows.map((row) => ({
    id: row.id,
    label: row.label,
    severity: row.severity,
    location: row.location,
    summary: row.summary,
  }));
  const diff: ProposalDiffEntry[] = itemsResult.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    cell: row.cell,
    before: row.before_value ?? undefined,
    after: row.after_value ?? undefined,
    rationale: row.rationale,
    status: row.status,
    reviewer: row.reviewer ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewComment: row.review_comment ?? undefined,
  }));

  const workbook: WorkbookDetail = {
    id: workbookRow.id,
    name: workbookRow.name,
    latestVersionId: workbookRow.latest_version_id,
    sheetCount: sheets.length,
    createdAt: workbookRow.created_at,
    owner: workbookRow.owner,
    status: workbookRow.status,
    lastReviewedAt: workbookRow.last_reviewed_at,
    sheets,
    risks,
    namedRanges,
    versions,
  };

  return {
    workbook,
    proposal: {
      id: proposalRow.id,
      workbookId: proposalRow.workbook_id,
      title: proposalRow.title,
      status: proposalRow.status,
      createdAt: proposalRow.created_at,
      requestedBy: proposalRow.requested_by,
      summary: proposalRow.summary,
      approvalRequired: proposalRow.approval_required,
      diff,
      reviewer: proposalRow.reviewer ?? undefined,
      reviewedAt: proposalRow.reviewed_at ?? undefined,
      reviewComment: proposalRow.review_comment ?? undefined,
      appliedAt: proposalRow.applied_at ?? undefined,
      appliedBy: proposalRow.applied_by ?? undefined,
      appliedVersionId: proposalRow.applied_version_id ?? undefined,
    },
    auditEvents: auditsResult.rows.map((row) => ({
      id: row.id,
      workbookId: row.workbook_id,
      actor: row.actor,
      action: row.action,
      detail: row.detail,
      createdAt: row.created_at,
    })),
  };
}

async function appendAuditEvent(
  client: PgClient,
  workbookId: string,
  actor: string,
  action: string,
  detail: string,
) {
  const createdAt = new Date().toISOString();
  await client.query(
    `insert into audit_events (id, workbook_id, actor, action, detail, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [`${workbookId}_audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, workbookId, actor, action, detail, createdAt],
  );
}

export function createPostgresStoreBackend(): StoreBackend {
  return {
    async listStoredWorkbooks(): Promise<WorkbookSummary[]> {
      return withTransaction((client) => buildWorkbookSummaryRows(client));
    },

    async getStoredWorkbookReview(workbookId: string): Promise<WorkbookReviewSnapshot | null> {
      return withTransaction((client) => loadSnapshot(client, workbookId));
    },

    async saveUploadedWorkbook(input): Promise<StoredWorkbookRecord> {
      await ensureUploadsDir();

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

        await withTransaction(async (client) => {
          await insertSnapshot(client, snapshot, uploadPath);
          return null;
        });

        return {
          id: recordId,
          fileName: input.fileName,
          contentType: input.contentType || "application/octet-stream",
          fileSize: input.bytes.byteLength,
          storedAt,
          uploadPath,
          snapshot,
        };
      } catch (error) {
        await unlink(uploadPath).catch(() => undefined);
        throw error;
      }
    },

    async updateStoredProposalDecision(input): Promise<MutationResult> {
      return withTransaction(async (client) => {
        const current = await loadSnapshot(client, input.workbookId);
        if (!current) {
          return mutationFailure("not_found");
        }

        if (current.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        if (current.proposal.diff.some((entry) => entry.status !== "pending")) {
          return mutationFailure("review_path_locked");
        }

        const reviewedAt = new Date().toISOString();
        const nextDiff = current.proposal.diff.map((entry) => ({
          ...entry,
          status: itemDecisionToStatus(input.decision),
          reviewer: input.reviewer,
          reviewedAt,
          reviewComment: input.comment,
        }));
        const nextStatus = deriveProposalStatus(nextDiff);

        await client.query(
          `update proposals
           set status = $2, reviewer = $3, reviewed_at = $4, review_comment = $5
           where id = $1`,
          [current.proposal.id, nextStatus, input.reviewer, reviewedAt, input.comment ?? null],
        );
        await client.query(
          `update proposal_items
           set status = $2, reviewer = $3, reviewed_at = $4, review_comment = $5
           where proposal_id = $1`,
          [current.proposal.id, itemDecisionToStatus(input.decision), input.reviewer, reviewedAt, input.comment ?? null],
        );
        await appendAuditEvent(
          client,
          input.workbookId,
          input.reviewer,
          input.decision === "approve" ? "proposal.approved" : "proposal.rejected",
          input.comment?.trim() ||
            (input.decision === "approve"
              ? "Proposal approved in the PostgreSQL workflow."
              : "Proposal rejected in the PostgreSQL workflow."),
        );

        const review = await loadSnapshot(client, input.workbookId);
        return review ? mutationSuccess(review) : mutationFailure("not_found");
      });
    },

    async updateStoredProposalItemDecision(input): Promise<MutationResult> {
      return withTransaction(async (client) => {
        const current = await loadSnapshot(client, input.workbookId);
        if (!current) {
          return mutationFailure("not_found");
        }

        if (current.proposal.status === "applied" || current.proposal.status !== "pending_approval") {
          return mutationFailure("locked");
        }

        const existing = current.proposal.diff.find((entry) => entry.id === input.diffId);
        if (!existing) {
          return mutationFailure("item_not_found");
        }
        if (existing.status !== "pending") {
          return mutationFailure("locked");
        }

        const reviewedAt = new Date().toISOString();
        await client.query(
          `update proposal_items
           set status = $2, reviewer = $3, reviewed_at = $4, review_comment = $5
           where id = $1`,
          [input.diffId, itemDecisionToStatus(input.decision), input.reviewer, reviewedAt, input.comment ?? null],
        );

        const nextDiff = current.proposal.diff.map((entry) =>
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
        const nextStatus = deriveProposalStatus(nextDiff);

        await client.query(
          `update proposals
           set status = $2, reviewer = $3, reviewed_at = $4, review_comment = $5
           where id = $1`,
          [current.proposal.id, nextStatus, input.reviewer, reviewedAt, input.comment ?? null],
        );
        await appendAuditEvent(
          client,
          input.workbookId,
          input.reviewer,
          input.decision === "approve" ? "proposal.item.approved" : "proposal.item.rejected",
          input.comment?.trim() ||
            `${input.decision === "approve" ? "Approved" : "Rejected"} proposal item ${input.diffId}.`,
        );

        const review = await loadSnapshot(client, input.workbookId);
        return review ? mutationSuccess(review) : mutationFailure("not_found");
      });
    },

    async applyApprovedProposalItems(input): Promise<MutationResult> {
      return withTransaction(async (client) => {
        const current = await loadSnapshot(client, input.workbookId);
        if (!current) {
          return mutationFailure("not_found");
        }

        if (current.proposal.status === "applied") {
          return mutationFailure("already_applied");
        }

        const approvedItems = current.proposal.diff.filter((entry) => entry.status === "approved");
        if (approvedItems.length === 0) {
          return mutationFailure("nothing_to_apply");
        }

        const reviewedAt = new Date().toISOString();
        const nextVersion: WorkbookVersionSummary = {
          id: nextVersionId(current.workbook.latestVersionId),
          createdAt: reviewedAt,
          createdBy: input.actor,
          note:
            input.note?.trim() ||
            `Applied ${approvedItems.length} approved proposal item${approvedItems.length === 1 ? "" : "s"}.`,
        };

        await client.query(
          `insert into workbook_versions (id, workbook_id, created_at, created_by, note, artifact_path)
           values ($1, $2, $3, $4, $5, null)`,
          [nextVersion.id, current.workbook.id, nextVersion.createdAt, nextVersion.createdBy, nextVersion.note],
        );
        await client.query(
          `insert into workbook_sheets (workbook_version_id, name, rows, columns_count, formula_cells, populated_cells, risk_count, sample_rows_json)
           select $2, name, rows, columns_count, formula_cells, populated_cells, risk_count, sample_rows_json
           from workbook_sheets
           where workbook_version_id = $1`,
          [current.workbook.latestVersionId, nextVersion.id],
        );
        await client.query(
          `insert into workbook_named_ranges (workbook_version_id, name, sheet_name, reference)
           select $2, name, sheet_name, reference
           from workbook_named_ranges
           where workbook_version_id = $1`,
          [current.workbook.latestVersionId, nextVersion.id],
        );
        await client.query(
          `insert into workbook_risks (workbook_version_id, id, label, severity, location, summary)
           select $2, id, label, severity, location, summary
           from workbook_risks
           where workbook_version_id = $1`,
          [current.workbook.latestVersionId, nextVersion.id],
        );
        await client.query(
          `update workbooks
           set latest_version_id = $2, last_reviewed_at = $3
           where id = $1`,
          [current.workbook.id, nextVersion.id, reviewedAt],
        );
        await client.query(
          `update proposals
           set status = 'applied',
               reviewer = $2,
               reviewed_at = $3,
               review_comment = coalesce($4, review_comment),
               applied_at = $3,
               applied_by = $2,
               applied_version_id = $5
           where id = $1`,
          [current.proposal.id, input.actor, reviewedAt, input.note?.trim() ?? null, nextVersion.id],
        );
        await client.query(
          `update proposal_items
           set review_comment = coalesce(review_comment, 'Included in the applied workbook version.')
           where proposal_id = $1 and status = 'approved'`,
          [current.proposal.id],
        );
        await appendAuditEvent(
          client,
          input.workbookId,
          input.actor,
          "proposal.applied",
          input.note?.trim() ||
            `Applied ${approvedItems.length} approved proposal item${approvedItems.length === 1 ? "" : "s"} to workbook version ${nextVersion.id}.`,
        );

        const review = await loadSnapshot(client, input.workbookId);
        return review ? mutationSuccess(review) : mutationFailure("not_found");
      });
    },
  };
}
