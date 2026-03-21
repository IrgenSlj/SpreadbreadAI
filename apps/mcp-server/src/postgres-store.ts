import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ApprovalDecision,
  ReviewerNotification,
  ReviewerNotificationFeed,
  WorkbookLibraryView,
  ProposalDetail,
  ProposalDiffEntry,
  ProposalItemComment,
  ProposalItemStatus,
  WorkbookDetail,
  WorkbookNamedRange,
  WorkbookReviewSnapshot,
  WorkbookRisk,
  WorkbookSheetSummary,
  WorkbookSketchBoard,
  WorkbookSummary,
  WorkbookVersionSummary,
} from "../../../packages/shared/src/index.js";
import { parseWorkbookReviewSnapshot } from "./parser.js";
import { withTransaction } from "./postgres.js";
import type {
  LibraryViewDeletionResult,
  MutationFailureCode,
  MutationResult,
  LibraryViewMutationResult,
  ReviewerNotificationMutationResult,
  SketchBoardMutationResult,
  TagsMutationResult,
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

function createNotificationId(scope: string) {
  return `notif_${scope}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createReviewerNotification(input: {
  reviewer: string;
  title: string;
  body: string;
  action: string;
  createdAt: string;
  workbookId?: string;
  proposalId?: string;
  proposalItemId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}): ReviewerNotification {
  return {
    id: createNotificationId(input.action.replace(/[^a-z0-9]+/gi, "_").toLowerCase()),
    reviewer: normalizeReviewer(input.reviewer),
    title: input.title,
    body: input.body,
    action: input.action,
    createdAt: input.createdAt,
    workbookId: input.workbookId,
    proposalId: input.proposalId,
    proposalItemId: input.proposalItemId,
    metadata: input.metadata,
  };
}

function normalizeReviewer(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function buildCommentNotifications(input: {
  workbookId: string;
  workbookName: string;
  proposalId: string;
  proposalItemId: string;
  proposalCell: string;
  author: string;
  comment: ProposalItemComment;
  repliedToComment?: ProposalItemComment;
}): ReviewerNotification[] {
  const createdAt = input.comment.createdAt;
  const notifications: ReviewerNotification[] = [];
  const authorHandle = normalizeReviewer(input.author);
  const recipients = new Set<string>();

  for (const mention of input.comment.mentions ?? []) {
    const reviewer = normalizeReviewer(mention);
    if (reviewer && reviewer !== authorHandle) {
      recipients.add(reviewer);
    }
  }

  for (const reviewer of recipients) {
    notifications.push(
      createReviewerNotification({
        reviewer,
        title: "Mention",
        body: `${input.author} mentioned you on ${input.proposalCell} in ${input.workbookName}.`,
        action: "proposal.item.mention",
        createdAt,
        workbookId: input.workbookId,
        proposalId: input.proposalId,
        proposalItemId: input.proposalItemId,
        metadata: {
          commentId: input.comment.id,
          cell: input.proposalCell,
          author: input.author,
        },
      }),
    );
  }

  const repliedToAuthor = normalizeReviewer(input.repliedToComment?.author ?? "");
  if (repliedToAuthor && repliedToAuthor !== authorHandle && !recipients.has(repliedToAuthor)) {
    notifications.push(
      createReviewerNotification({
        reviewer: repliedToAuthor,
        title: "Reply",
        body: `${input.author} replied to your comment on ${input.proposalCell} in ${input.workbookName}.`,
        action: "proposal.item.reply",
        createdAt,
        workbookId: input.workbookId,
        proposalId: input.proposalId,
        proposalItemId: input.proposalItemId,
        metadata: {
          commentId: input.comment.id,
          replyToCommentId: input.repliedToComment?.id ?? null,
          cell: input.proposalCell,
          author: input.author,
        },
      }),
    );
  }

  return notifications;
}

function normalizeReviewerNotification(row: {
  id: string;
  reviewer: string;
  title: string;
  body: string;
  action: string;
  created_at: string;
  read_at: string | null;
  workbook_id: string | null;
  proposal_id: string | null;
  proposal_item_id: string | null;
  metadata_json: unknown;
}): ReviewerNotification {
  const metadata =
    row.metadata_json && typeof row.metadata_json === "object" && !Array.isArray(row.metadata_json)
      ? (row.metadata_json as Record<string, string | number | boolean | null>)
      : undefined;

  return {
    id: row.id,
    reviewer: row.reviewer,
    title: row.title,
    body: row.body,
    action: row.action,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
    workbookId: row.workbook_id ?? undefined,
    proposalId: row.proposal_id ?? undefined,
    proposalItemId: row.proposal_item_id ?? undefined,
    metadata,
  };
}

function normalizeWorkbookTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

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

function normalizeProposalItemStatus(
  status: ProposalItemStatus | null | undefined,
): ProposalItemStatus {
  return status === "approved" || status === "rejected" || status === "pending"
    ? status
    : "pending";
}

function normalizeProposalItemComments(value: unknown): ProposalItemComment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : "";
    const author = typeof candidate.author === "string" ? candidate.author : "";
    const body = typeof candidate.body === "string" ? candidate.body : "";
    const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : "";
    const parentCommentId =
      typeof candidate.parentCommentId === "string" ? candidate.parentCommentId : undefined;
    const replyToCommentId =
      typeof candidate.replyToCommentId === "string" ? candidate.replyToCommentId : undefined;
    const mentions = Array.isArray(candidate.mentions)
      ? normalizeMentionHandles(candidate.mentions)
      : undefined;

    if (!id || !author || !body || !createdAt) {
      return [];
    }

    return [
      {
        id,
        author,
        body,
        createdAt,
        parentCommentId,
        replyToCommentId: replyToCommentId ?? parentCommentId,
        mentions: mentions && mentions.length > 0 ? mentions : undefined,
      },
    ];
  });
}

function normalizeWorkbookSketchBoard(
  value: unknown,
  workbookId: string,
  workbookName: string,
  updatedAt: string,
): WorkbookSketchBoard {
  if (!value || typeof value !== "object") {
    return createSketchBoard(workbookId, workbookName, updatedAt, "system");
  }

  const candidate = value as Record<string, unknown>;
  const title = typeof candidate.title === "string" ? candidate.title : `${workbookName} Sketch Board`;
  const updatedBy = typeof candidate.updatedBy === "string" ? candidate.updatedBy : "system";
  const nodes = Array.isArray(candidate.nodes) ? candidate.nodes : [];
  const links = Array.isArray(candidate.links) ? candidate.links : [];
  const notes = typeof candidate.notes === "string" ? candidate.notes : undefined;

  return {
    id:
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id
        : `${workbookId}_sketch_board`,
    workbookId,
    title,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : updatedAt,
    updatedBy,
    nodes: nodes.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }

      const node = entry as Record<string, unknown>;
      const id = typeof node.id === "string" ? node.id : "";
      const label = typeof node.label === "string" ? node.label : "";
      const x = typeof node.x === "number" ? node.x : Number.NaN;
      const y = typeof node.y === "number" ? node.y : Number.NaN;
      const width = typeof node.width === "number" ? node.width : Number.NaN;
      const height = typeof node.height === "number" ? node.height : Number.NaN;
      const color = typeof node.color === "string" ? node.color : undefined;

      if (!id || !label || Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(width) || Number.isNaN(height)) {
        return [];
      }

      return [
        {
          id,
          label,
          x,
          y,
          width,
          height,
          color,
        },
      ];
    }),
    links: links.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }

      const link = entry as Record<string, unknown>;
      const id = typeof link.id === "string" ? link.id : "";
      const fromNodeId = typeof link.fromNodeId === "string" ? link.fromNodeId : "";
      const toNodeId = typeof link.toNodeId === "string" ? link.toNodeId : "";
      const label = typeof link.label === "string" ? link.label : undefined;

      if (!id || !fromNodeId || !toNodeId) {
        return [];
      }

      return [
        {
          id,
          fromNodeId,
          toNodeId,
          label,
        },
      ];
    }),
    notes,
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
  const versions = [...workbook.versions].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
  const latestVersion = versions[0];

  await client.query(
    `insert into workbooks (id, name, owner, status, created_at, last_reviewed_at, latest_version_id, tags_json, sketch_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
     on conflict (id) do update set
       name = excluded.name,
       owner = excluded.owner,
       status = excluded.status,
       created_at = excluded.created_at,
       last_reviewed_at = excluded.last_reviewed_at,
       latest_version_id = excluded.latest_version_id,
       tags_json = excluded.tags_json,
       sketch_json = excluded.sketch_json`,
    [
      workbook.id,
      workbook.name,
      workbook.owner,
      workbook.status,
      workbook.createdAt,
      workbook.lastReviewedAt,
      workbook.latestVersionId,
      JSON.stringify(workbook.tags ?? []),
      JSON.stringify(
        workbook.sketchBoard ??
          createSketchBoard(workbook.id, workbook.name, workbook.lastReviewedAt, "system"),
      ),
    ],
  );

  for (const version of versions) {
    await client.query(
      `insert into workbook_versions (id, workbook_id, created_at, created_by, note, artifact_path)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do nothing`,
      [
        version.id,
        workbook.id,
        version.createdAt,
        version.createdBy,
        version.note,
        version.id === latestVersion.id ? uploadPath : null,
      ],
    );
  }

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
       (id, proposal_id, kind, cell, before_value, after_value, rationale, status, reviewer, reviewed_at, review_comment, comments_json)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       on conflict (id) do update set
         kind = excluded.kind,
         cell = excluded.cell,
         before_value = excluded.before_value,
         after_value = excluded.after_value,
         rationale = excluded.rationale,
         status = excluded.status,
         reviewer = excluded.reviewer,
         reviewed_at = excluded.reviewed_at,
         review_comment = excluded.review_comment,
         comments_json = excluded.comments_json`,
      [
        item.id,
        proposal.id,
        item.kind,
        item.cell,
        item.before ?? null,
        item.after ?? null,
        item.rationale,
        normalizeProposalItemStatus(item.status),
        item.reviewer ?? null,
        item.reviewedAt ?? null,
        item.reviewComment ?? null,
        JSON.stringify(item.comments ?? []),
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

async function deleteWorkbookById(client: PgClient, workbookId: string) {
  await client.query(
    `delete from audit_events where workbook_id = $1`,
    [workbookId],
  );
  await client.query(
    `delete from proposal_items
     where proposal_id in (select id from proposals where workbook_id = $1)`,
    [workbookId],
  );
  await client.query(`delete from proposals where workbook_id = $1`, [workbookId]);
  await client.query(
    `delete from workbook_sheets
     where workbook_version_id in (select id from workbook_versions where workbook_id = $1)`,
    [workbookId],
  );
  await client.query(
    `delete from workbook_named_ranges
     where workbook_version_id in (select id from workbook_versions where workbook_id = $1)`,
    [workbookId],
  );
  await client.query(
    `delete from workbook_risks
     where workbook_version_id in (select id from workbook_versions where workbook_id = $1)`,
    [workbookId],
  );
  await client.query(`delete from workbook_versions where workbook_id = $1`, [workbookId]);
  await client.query(`delete from workbooks where id = $1`, [workbookId]);
}

async function buildWorkbookSummaryRows(client: PgClient): Promise<WorkbookSummary[]> {
  const result = await client.query<{
    id: string;
    name: string;
    latest_version_id: string;
    created_at: string;
    sheet_count: string;
    tags_json: unknown;
  }>(
    `select
       w.id,
       w.name,
       w.latest_version_id,
       w.created_at,
       w.tags_json,
       count(ws.name)::text as sheet_count
     from workbooks w
     left join workbook_sheets ws on ws.workbook_version_id = w.latest_version_id
     group by w.id, w.name, w.latest_version_id, w.created_at, w.tags_json
     order by w.created_at desc`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    latestVersionId: row.latest_version_id,
    sheetCount: Number.parseInt(row.sheet_count, 10),
    createdAt: row.created_at,
    tags: normalizeWorkbookTags(row.tags_json),
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
    tags_json: unknown;
    sketch_json: unknown;
  }>(
    `select id, name, owner, status, created_at, last_reviewed_at, latest_version_id, tags_json, sketch_json
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
        comments_json: unknown;
      }>(
        `select
           id, proposal_id, kind, cell, before_value, after_value, rationale,
           status, reviewer, reviewed_at, review_comment, comments_json
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
    status: normalizeProposalItemStatus(row.status),
    reviewer: row.reviewer ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewComment: row.review_comment ?? undefined,
    comments: normalizeProposalItemComments(row.comments_json),
  }));

  const workbook: WorkbookDetail = {
    id: workbookRow.id,
    name: workbookRow.name,
    latestVersionId: workbookRow.latest_version_id,
    sheetCount: sheets.length,
    createdAt: workbookRow.created_at,
    tags: normalizeWorkbookTags(workbookRow.tags_json),
    owner: workbookRow.owner,
    status: workbookRow.status,
    lastReviewedAt: workbookRow.last_reviewed_at,
    sheets,
    risks,
    namedRanges,
    versions,
    sketchBoard: normalizeWorkbookSketchBoard(
      workbookRow.sketch_json,
      workbookRow.id,
      workbookRow.name,
      workbookRow.last_reviewed_at,
    ),
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

async function appendReviewerNotification(
  client: PgClient,
  input: {
    reviewer: string;
    title: string;
    body: string;
    action: string;
    createdAt: string;
    workbookId?: string;
    proposalId?: string;
    proposalItemId?: string;
    metadata?: Record<string, string | number | boolean | null>;
  },
) {
  const notification = createReviewerNotification(input);
  await client.query(
    `insert into reviewer_notifications
     (id, reviewer, title, body, action, created_at, read_at, workbook_id, proposal_id, proposal_item_id, metadata_json)
     values ($1, $2, $3, $4, $5, $6, null, $7, $8, $9, $10::jsonb)`,
    [
      notification.id,
      notification.reviewer,
      notification.title,
      notification.body,
      notification.action,
      notification.createdAt,
      notification.workbookId ?? null,
      notification.proposalId ?? null,
      notification.proposalItemId ?? null,
      JSON.stringify(notification.metadata ?? {}),
    ],
  );
  return notification;
}

async function insertReviewerNotification(
  client: PgClient,
  notification: ReviewerNotification,
) {
  await client.query(
    `insert into reviewer_notifications
     (id, reviewer, title, body, action, created_at, read_at, workbook_id, proposal_id, proposal_item_id, metadata_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     on conflict (id) do update set
       reviewer = excluded.reviewer,
       title = excluded.title,
       body = excluded.body,
       action = excluded.action,
       created_at = excluded.created_at,
       read_at = excluded.read_at,
       workbook_id = excluded.workbook_id,
       proposal_id = excluded.proposal_id,
       proposal_item_id = excluded.proposal_item_id,
       metadata_json = excluded.metadata_json`,
    [
      notification.id,
      notification.reviewer,
      notification.title,
      notification.body,
      notification.action,
      notification.createdAt,
      notification.readAt ?? null,
      notification.workbookId ?? null,
      notification.proposalId ?? null,
      notification.proposalItemId ?? null,
      JSON.stringify(notification.metadata ?? {}),
    ],
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

    async getStoredWorkbookTags(workbookId: string): Promise<string[] | null> {
      return withTransaction(async (client) => {
        const current = await loadSnapshot(client, workbookId);
        return current?.workbook.tags ?? null;
      });
    },

    async getStoredSketchBoard(workbookId: string): Promise<WorkbookSketchBoard | null> {
      return withTransaction(async (client) => {
        const snapshot = await loadSnapshot(client, workbookId);
        return snapshot?.workbook.sketchBoard ?? null;
      });
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

    async updateStoredWorkbookTags(input: {
      workbookId: string;
      tags: string[];
      updatedBy: string;
    }): Promise<TagsMutationResult> {
      return withTransaction(async (client) => {
        const current = await loadSnapshot(client, input.workbookId);
        if (!current) {
          return { ok: false, code: "not_found" };
        }

        const updatedAt = new Date().toISOString();
        const tags = normalizeWorkbookTags(input.tags);

        await client.query(
          `update workbooks
           set tags_json = $2::jsonb
           where id = $1`,
          [current.workbook.id, JSON.stringify(tags)],
        );
        await appendAuditEvent(
          client,
          input.workbookId,
          input.updatedBy,
          "workbook.tags.updated",
          `Workbook tags updated to ${tags.length > 0 ? tags.join(", ") : "none"}.`,
        );

        return { ok: true, tags };
      });
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
        await appendReviewerNotification(client, {
          reviewer: input.reviewer,
          title: "Proposal review recorded",
          body: `${current.workbook.name} was ${input.decision}d by ${input.reviewer}.`,
          action: input.decision === "approve" ? "proposal.approved" : "proposal.rejected",
          createdAt: reviewedAt,
          workbookId: input.workbookId,
          proposalId: current.proposal.id,
        });

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
        await appendReviewerNotification(client, {
          reviewer: input.reviewer,
          title: "Proposal item reviewed",
          body: `${current.workbook.name} item ${input.diffId} was ${input.decision}d by ${input.reviewer}.`,
          action:
            input.decision === "approve"
              ? "proposal.item.approved"
              : "proposal.item.rejected",
          createdAt: reviewedAt,
          workbookId: input.workbookId,
          proposalId: current.proposal.id,
          proposalItemId: input.diffId,
        });

        const review = await loadSnapshot(client, input.workbookId);
        return review ? mutationSuccess(review) : mutationFailure("not_found");
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
      return withTransaction(async (client) => {
        const current = await loadSnapshot(client, input.workbookId);
        if (!current) {
          return mutationFailure("not_found");
        }

        if (current.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        const existing = current.proposal.diff.find((entry) => entry.id === input.diffId);
        if (!existing) {
          return mutationFailure("item_not_found");
        }

        const comments = existing.comments ?? [];
        const replyToCommentId = input.parentCommentId ?? input.replyToCommentId;
        const repliedToComment = replyToCommentId
          ? comments.find((comment) => comment.id === replyToCommentId)
          : undefined;
        if (replyToCommentId && !repliedToComment) {
          return mutationFailure("comment_not_found");
        }

        const createdAt = new Date().toISOString();
        const comment = {
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

        await client.query(
          `update proposal_items
           set comments_json = $2::jsonb
           where id = $1`,
          [input.diffId, JSON.stringify([...comments, comment])],
        );
        await appendAuditEvent(
          client,
          input.workbookId,
          input.author,
          "proposal.item.commented",
          `Comment added to proposal item ${input.diffId}.`,
        );
        for (const notification of buildCommentNotifications({
          workbookId: input.workbookId,
          workbookName: current.workbook.name,
          proposalId: current.proposal.id,
          proposalItemId: input.diffId,
          proposalCell: existing.cell,
          author: input.author,
          comment,
          repliedToComment,
        })) {
          await appendReviewerNotification(client, notification);
        }

        const review = await loadSnapshot(client, input.workbookId);
        return review ? mutationSuccess(review) : mutationFailure("not_found");
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
      return withTransaction(async (client) => {
        const current = await loadSnapshot(client, input.workbookId);
        if (!current) {
          return { ok: false, code: "not_found" };
        }

        const updatedAt = new Date().toISOString();
        const sketchBoard: WorkbookSketchBoard = {
          id: `${current.workbook.id}_sketch_board`,
          workbookId: current.workbook.id,
          title: input.title.trim() || `${current.workbook.name} Sketch Board`,
          updatedAt,
          updatedBy: input.updatedBy,
          nodes: [...input.nodes],
          links: [...input.links],
          notes: input.notes?.trim() || undefined,
        };

        await client.query(
          `update workbooks
           set sketch_json = $2::jsonb
           where id = $1`,
          [current.workbook.id, JSON.stringify(sketchBoard)],
        );
        await appendAuditEvent(
          client,
          input.workbookId,
          input.updatedBy,
          "sketch.updated",
          "Workbook sketch board updated.",
        );

        return { ok: true, sketchBoard };
      });
    },

    async listStoredWorkbookLibraryViews(options?: {
      includeArchived?: boolean;
    }): Promise<WorkbookLibraryView[]> {
      return withTransaction(async (client) => {
        const result = await client.query<{
          id: string;
          name: string;
          updated_at: string;
          updated_by: string;
          archived_at: string | null;
          archived_by: string | null;
          description: string | null;
          search_query: string | null;
          tags_json: unknown;
          sort_by: string;
          sort_direction: string;
          pinned: boolean;
        }>(
          `select id, name, updated_at, updated_by, archived_at, archived_by, description, search_query, tags_json, sort_by, sort_direction, pinned
           from workbook_library_views
           ${options?.includeArchived ? "" : "where archived_at is null"}
           order by updated_at desc, id desc`,
        );

        return result.rows.map((row) =>
          normalizeLibraryView({
            id: row.id,
            name: row.name,
            updatedBy: row.updated_by,
            updatedAt: row.updated_at,
            archivedAt: row.archived_at ?? undefined,
            archivedBy: row.archived_by ?? undefined,
            description: row.description ?? undefined,
            searchQuery: row.search_query ?? undefined,
            tags: normalizeWorkbookTags(row.tags_json),
            sortBy: row.sort_by as WorkbookLibraryView["sortBy"],
            sortDirection: row.sort_direction as WorkbookLibraryView["sortDirection"],
            pinned: row.pinned,
          }),
        );
      });
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
      return withTransaction(async (client) => {
        const updatedAt = new Date().toISOString();
        const existing = await client.query<{
          archived_at: string | null;
          archived_by: string | null;
        }>(
          `select archived_at, archived_by from workbook_library_views where id = $1`,
          [input.id],
        );
        const view = normalizeLibraryView({
          ...input,
          updatedAt,
          archivedAt: existing.rows[0]?.archived_at ?? undefined,
          archivedBy: existing.rows[0]?.archived_by ?? undefined,
        });

        await client.query(
          `insert into workbook_library_views
           (id, name, updated_at, updated_by, archived_at, archived_by, description, search_query, tags_json, sort_by, sort_direction, pinned)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
           on conflict (id) do update set
             name = excluded.name,
             updated_at = excluded.updated_at,
             updated_by = excluded.updated_by,
             archived_at = workbook_library_views.archived_at,
             archived_by = workbook_library_views.archived_by,
             description = excluded.description,
             search_query = excluded.search_query,
             tags_json = excluded.tags_json,
             sort_by = excluded.sort_by,
             sort_direction = excluded.sort_direction,
             pinned = excluded.pinned`,
          [
            view.id,
            view.name,
            view.updatedAt,
            view.updatedBy,
            view.archivedAt ?? null,
            view.archivedBy ?? null,
            view.description ?? null,
            view.searchQuery ?? null,
            JSON.stringify(view.tags),
            view.sortBy,
            view.sortDirection,
            view.pinned ?? false,
          ],
        );

        return { ok: true, view };
      });
    },

    async archiveStoredWorkbookLibraryView(input: {
      id: string;
      archivedBy: string;
    }): Promise<LibraryViewMutationResult> {
      return withTransaction(async (client) => {
        const existing = await client.query<{
          id: string;
          name: string;
          updated_at: string;
          updated_by: string;
          archived_at: string | null;
          archived_by: string | null;
          description: string | null;
          search_query: string | null;
          tags_json: unknown;
          sort_by: string;
          sort_direction: string;
          pinned: boolean;
        }>(
          `select id, name, updated_at, updated_by, archived_at, archived_by, description, search_query, tags_json, sort_by, sort_direction, pinned
           from workbook_library_views
           where id = $1`,
          [input.id],
        );

        const existingRow = existing.rows[0];
        if (!existingRow) {
          return { ok: false, code: "not_found" };
        }

        const archivedAt = new Date().toISOString();
        const view = normalizeLibraryView({
          id: existingRow.id,
          name: existingRow.name,
          updatedAt: archivedAt,
          updatedBy: input.archivedBy,
          archivedAt,
          archivedBy: input.archivedBy,
          description: existingRow.description ?? undefined,
          searchQuery: existingRow.search_query ?? undefined,
          tags: normalizeWorkbookTags(existingRow.tags_json),
          sortBy: existingRow.sort_by as WorkbookLibraryView["sortBy"],
          sortDirection: existingRow.sort_direction as WorkbookLibraryView["sortDirection"],
          pinned: existingRow.pinned,
        });

        await client.query(
          `update workbook_library_views
           set updated_at = $2,
               updated_by = $3,
               archived_at = $4,
               archived_by = $5
           where id = $1`,
          [input.id, view.updatedAt, view.updatedBy, view.archivedAt, view.archivedBy],
        );

        return { ok: true, view };
      });
    },

    async deleteStoredWorkbookLibraryView(input: {
      id: string;
    }): Promise<LibraryViewDeletionResult> {
      return withTransaction(async (client) => {
        const result = await client.query<{ id: string }>(
          `delete from workbook_library_views where id = $1 returning id`,
          [input.id],
        );

        if (!result.rows[0]) {
          return { ok: false, code: "not_found" };
        }

        return { ok: true, deletedId: result.rows[0].id };
      });
    },

    async listReviewerNotifications(input: {
      reviewer: string;
      includeRead?: boolean;
    }): Promise<ReviewerNotificationFeed> {
      return withTransaction(async (client) => {
        const reviewer = normalizeReviewer(input.reviewer);
        const result = await client.query<{
          id: string;
          reviewer: string;
          title: string;
          body: string;
          action: string;
          created_at: string;
          read_at: string | null;
          workbook_id: string | null;
          proposal_id: string | null;
          proposal_item_id: string | null;
          metadata_json: unknown;
        }>(
          `select id, reviewer, title, body, action, created_at, read_at, workbook_id, proposal_id, proposal_item_id, metadata_json
           from reviewer_notifications
           where reviewer = $1
             ${input.includeRead ? "" : "and read_at is null"}
           order by created_at desc, id desc`,
          [reviewer],
        );

        const notifications = result.rows
          .map((row) => normalizeReviewerNotification(row))
          .filter(
            (notification) =>
              notification.action === "proposal.item.mention" ||
              notification.action === "proposal.item.reply",
          );

        return {
          reviewer,
          unreadCount: notifications.filter((notification) => !notification.readAt).length,
          notifications,
        };
      });
    },

    async markReviewerNotificationRead(input: {
      notificationId: string;
      reviewer: string;
    }): Promise<ReviewerNotificationMutationResult> {
      return withTransaction(async (client) => {
        const reviewer = normalizeReviewer(input.reviewer);
        const readAt = new Date().toISOString();
        const result = await client.query<{
          id: string;
          reviewer: string;
          title: string;
          body: string;
          action: string;
          created_at: string;
          read_at: string | null;
          workbook_id: string | null;
          proposal_id: string | null;
          proposal_item_id: string | null;
          metadata_json: unknown;
        }>(
          `update reviewer_notifications
           set read_at = $3
           where id = $1 and reviewer = $2
           returning id, reviewer, title, body, action, created_at, read_at, workbook_id, proposal_id, proposal_item_id, metadata_json`,
          [input.notificationId, reviewer, readAt],
        );

        const row = result.rows[0];
        if (!row) {
          return { ok: false, code: "not_found" };
        }

        return {
          ok: true,
          notification: normalizeReviewerNotification(row),
        };
      });
    },

    async markReviewerNotificationUnread(input: {
      notificationId: string;
      reviewer: string;
    }): Promise<ReviewerNotificationMutationResult> {
      return withTransaction(async (client) => {
        const reviewer = normalizeReviewer(input.reviewer);
        const result = await client.query<{
          id: string;
          reviewer: string;
          title: string;
          body: string;
          action: string;
          created_at: string;
          read_at: string | null;
          workbook_id: string | null;
          proposal_id: string | null;
          proposal_item_id: string | null;
          metadata_json: unknown;
        }>(
          `update reviewer_notifications
           set read_at = null
           where id = $1 and reviewer = $2
           returning id, reviewer, title, body, action, created_at, read_at, workbook_id, proposal_id, proposal_item_id, metadata_json`,
          [input.notificationId, reviewer],
        );

        const row = result.rows[0];
        if (!row) {
          return { ok: false, code: "not_found" };
        }

        return {
          ok: true,
          notification: normalizeReviewerNotification(row),
        };
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
        await appendReviewerNotification(client, {
          reviewer: input.actor,
          title: "Approved items applied",
          body: `${current.workbook.name} was advanced to ${nextVersion.id}.`,
          action: "proposal.applied",
          createdAt: reviewedAt,
          workbookId: input.workbookId,
          proposalId: current.proposal.id,
        });

        const review = await loadSnapshot(client, input.workbookId);
        return review ? mutationSuccess(review) : mutationFailure("not_found");
      });
    },
  };
}

export async function importStoredWorkbookRecords(input: {
  records: StoredWorkbookRecord[];
  notifications?: ReviewerNotification[];
}) {
  return withTransaction(async (client) => {
    let imported = 0;

    for (const record of input.records) {
      await deleteWorkbookById(client, record.snapshot.workbook.id);
      await insertSnapshot(client, record.snapshot, record.uploadPath);
      imported += 1;
    }

    for (const notification of input.notifications ?? []) {
      await insertReviewerNotification(client, notification);
    }

    return {
      imported,
      skipped: 0,
      workbookIds: input.records.map((record) => record.snapshot.workbook.id),
    };
  });
}
