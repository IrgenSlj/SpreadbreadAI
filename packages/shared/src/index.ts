export type EntityId = string;

export type WorkbookId = EntityId;
export type WorkbookVersionId = EntityId;
export type ProposalId = EntityId;
export type ApprovalRequestId = EntityId;

export type ProposalStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "applied";

export type ApprovalDecision = "approve" | "reject";
export type ProposalItemStatus = "pending" | "approved" | "rejected";
export type ReviewerRole = "Approver" | "Reviewer" | "Analyst";

export type RiskSeverity = "low" | "medium" | "high";
export type DiffKind = "remove" | "add" | "update" | "comment";

export interface ProposalItemComment {
  id: EntityId;
  author: string;
  body: string;
  createdAt: string;
  parentCommentId?: EntityId;
  replyToCommentId?: EntityId;
  mentions?: string[];
}

export interface ReviewerProfile {
  id: EntityId;
  handle: string;
  displayName: string;
  role?: ReviewerRole;
  team?: string;
  email?: string;
  color?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewerProfileDirectory {
  currentReviewerProfileId?: EntityId;
  profiles: ReviewerProfile[];
}

export interface ReviewerSession {
  reviewerProfileId: EntityId;
  signedInAt: string;
  updatedAt: string;
  currentProfile?: ReviewerProfile;
}

export interface ReviewerNotification {
  id: EntityId;
  reviewer: string;
  title: string;
  body: string;
  action: string;
  createdAt: string;
  readAt?: string;
  workbookId?: WorkbookId;
  proposalId?: ProposalId;
  proposalItemId?: EntityId;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ReviewerNotificationFeed {
  reviewer: string;
  unreadCount: number;
  notifications: ReviewerNotification[];
}

export interface WorkbookSketchNode {
  id: EntityId;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  linkKind?: "sheet" | "proposal" | "risk";
  linkTargetId?: string;
}

export interface WorkbookSketchLink {
  id: EntityId;
  fromNodeId: EntityId;
  toNodeId: EntityId;
  label?: string;
}

export interface WorkbookSketchBoard {
  id: EntityId;
  workbookId: WorkbookId;
  title: string;
  updatedAt: string;
  updatedBy: string;
  nodes: WorkbookSketchNode[];
  links: WorkbookSketchLink[];
  notes?: string;
}

export interface WorkbookSheetSummary {
  name: string;
  rows: number;
  columns: number;
  formulaCells: number;
  populatedCells: number;
  riskCount: number;
  sampleRows: string[][];
}

export interface WorkbookNamedRange {
  name: string;
  sheetName?: string;
  reference: string;
}

export interface WorkbookRisk {
  id: EntityId;
  label: string;
  severity: RiskSeverity;
  location: string;
  summary: string;
}

export interface WorkbookSummary {
  id: WorkbookId;
  name: string;
  latestVersionId: WorkbookVersionId;
  sheetCount: number;
  createdAt: string;
  tags: string[];
}

export interface WorkbookVersionSummary {
  id: WorkbookVersionId;
  createdAt: string;
  createdBy: string;
  note: string;
}

export interface WorkbookDetail extends WorkbookSummary {
  owner: string;
  status: "healthy" | "needs_review";
  lastReviewedAt: string;
  sheets: WorkbookSheetSummary[];
  risks: WorkbookRisk[];
  namedRanges: WorkbookNamedRange[];
  versions: WorkbookVersionSummary[];
  sketchBoard?: WorkbookSketchBoard;
}

export type WorkbookLibraryViewSortKey =
  | "createdAt"
  | "lastReviewedAt"
  | "name"
  | "sheetCount";

export type WorkbookLibraryViewSortDirection = "asc" | "desc";

export interface WorkbookLibraryView {
  id: EntityId;
  name: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt?: string;
  archivedBy?: string;
  description?: string;
  searchQuery?: string;
  tags: string[];
  sortBy: WorkbookLibraryViewSortKey;
  sortDirection: WorkbookLibraryViewSortDirection;
  pinned?: boolean;
}

export interface ProposalDiffEntry {
  id: EntityId;
  kind: DiffKind;
  cell: string;
  before?: string;
  after?: string;
  rationale: string;
  status: ProposalItemStatus;
  reviewer?: string;
  reviewedAt?: string;
  reviewComment?: string;
  comments?: ProposalItemComment[];
}

export interface ProposalSummary {
  id: ProposalId;
  workbookId: WorkbookId;
  title: string;
  status: ProposalStatus;
  createdAt: string;
}

export interface ProposalDetail extends ProposalSummary {
  requestedBy: string;
  summary: string;
  approvalRequired: boolean;
  diff: ProposalDiffEntry[];
  reviewer?: string;
  reviewedAt?: string;
  reviewComment?: string;
  appliedAt?: string;
  appliedBy?: string;
  appliedVersionId?: string;
}

export interface AuditEvent {
  id: EntityId;
  workbookId: WorkbookId;
  actor: string;
  action: string;
  detail: string;
  createdAt: string;
}

export interface WorkbookReviewSnapshot {
  workbook: WorkbookDetail;
  proposal: ProposalDetail;
  auditEvents: AuditEvent[];
}

export interface SketchBoardNode {
  id: EntityId;
  label: string;
  x: number;
  y: number;
  color: "green" | "lime" | "mint";
  linkKind?: "sheet" | "proposal" | "risk";
  linkTargetId?: string;
}

export interface SketchBoardConnection {
  id: EntityId;
  fromNodeId: EntityId;
  toNodeId: EntityId;
}

const demoWorkbook: WorkbookDetail = {
  id: "wb_q2_forecast",
  name: "Q2 Forecast",
  latestVersionId: "wbv_014",
  sheetCount: 4,
  createdAt: "2026-03-17T08:20:00.000Z",
  tags: ["finance", "forecast", "q2"],
  owner: "FP&A",
  status: "needs_review",
  lastReviewedAt: "2026-03-19T07:10:00.000Z",
  sheets: [
    {
      name: "Assumptions",
      rows: 42,
      columns: 8,
      formulaCells: 12,
      populatedCells: 88,
      riskCount: 1,
      sampleRows: [["Region", "Growth"], ["NA", "1.12"], ["EMEA", "1.09"]],
    },
    {
      name: "Pipeline",
      rows: 312,
      columns: 15,
      formulaCells: 29,
      populatedCells: 1134,
      riskCount: 2,
      sampleRows: [["Rep", "Stage", "Amount"], ["A. Lee", "Commit", "42000"]],
    },
    {
      name: "Forecast",
      rows: 144,
      columns: 18,
      formulaCells: 61,
      populatedCells: 510,
      riskCount: 3,
      sampleRows: [["Month", "Quota", "Forecast"], ["Apr", "500000", "478000"]],
    },
    {
      name: "Summary",
      rows: 28,
      columns: 10,
      formulaCells: 16,
      populatedCells: 74,
      riskCount: 0,
      sampleRows: [["Metric", "Value"], ["ARR", "2.1M"]],
    },
  ],
  risks: [
    {
      id: "risk_formula_chain",
      label: "Broken formula chain",
      severity: "high",
      location: "Forecast!G18:G20",
      summary: "Three adjacent cells no longer reference the pipeline rollup.",
    },
    {
      id: "risk_reference_drift",
      label: "External reference drift",
      severity: "medium",
      location: "Pipeline!B4",
      summary: "A source workbook reference points to last month's pricing extract.",
    },
    {
      id: "risk_stale_inputs",
      label: "Stale inputs",
      severity: "medium",
      location: "Assumptions!C6:C9",
      summary: "Growth assumptions have not been updated since the last forecast cycle.",
    },
  ],
  namedRanges: [
    { name: "growth_assumptions", sheetName: "Assumptions", reference: "Assumptions!C6:C9" },
    { name: "forecast_rollup", sheetName: "Forecast", reference: "Forecast!B4:G18" },
  ],
  versions: [
    {
      id: "wbv_014",
      createdAt: "2026-03-19T07:10:00.000Z",
      createdBy: "system",
      note: "Upload normalization snapshot",
    },
  ],
};

const demoProposal: ProposalDetail = {
  id: "prop_q2_refresh",
  workbookId: "wb_q2_forecast",
  title: "Q2 forecast refresh from revised pipeline data",
  status: "pending_approval",
  createdAt: "2026-03-19T08:02:00.000Z",
  requestedBy: "claude-code",
  summary:
    "Refresh revenue assumptions, repair the broken chain in the forecast rollup, and attach reviewer commentary before close.",
  approvalRequired: true,
  reviewer: "Finance Manager",
  reviewedAt: "2026-03-19T08:10:00.000Z",
  reviewComment: "Approved after validating pipeline updates and commentary.",
  diff: [
    {
      id: "diff_assumption",
      kind: "update",
      cell: "Assumptions!C7",
      before: "1.18",
      after: "1.24",
      rationale: "Aligns growth rate with revised pipeline coverage.",
      status: "approved",
      reviewer: "Finance Manager",
      reviewedAt: "2026-03-19T08:09:00.000Z",
      reviewComment: "Validated against revised coverage assumptions.",
      comments: [
        {
          id: "diff_assumption_comment_1",
          author: "Finance Manager",
          body: "Keep this aligned with the revised pipeline extract before close.",
          createdAt: "2026-03-19T08:07:00.000Z",
        },
      ],
    },
    {
      id: "diff_formula_fix",
      kind: "update",
      cell: "Forecast!G18",
      before: "=E18*F18",
      after: "=Pipeline!J18*F18",
      rationale: "Restores the intended dependency on pipeline value.",
      status: "approved",
      reviewer: "Finance Manager",
      reviewedAt: "2026-03-19T08:09:30.000Z",
      comments: [
        {
          id: "diff_formula_fix_comment_1",
          author: "codex",
          body: "This formula lost its pipeline dependency in the last workbook revision.",
          createdAt: "2026-03-19T08:04:30.000Z",
        },
      ],
    },
    {
      id: "diff_comment",
      kind: "comment",
      cell: "Summary!B6",
      after: "AI draft note: forecast reflects March pipeline refresh and flagged stale assumptions.",
      rationale: "Prepares reviewer commentary for signoff.",
      status: "pending",
      comments: [
        {
          id: "diff_comment_comment_1",
          author: "reviewer",
          body: "Add the final signoff note after the remaining item is reviewed.",
          createdAt: "2026-03-19T08:09:45.000Z",
        },
      ],
    },
  ],
};

const demoAuditEvents: AuditEvent[] = [
  {
    id: "audit_001",
    workbookId: "wb_q2_forecast",
    actor: "system",
    action: "snapshot.stored",
    detail: "Workbook version wbv_014 stored after upload normalization.",
    createdAt: "2026-03-19T07:10:00.000Z",
  },
  {
    id: "audit_002",
    workbookId: "wb_q2_forecast",
    actor: "codex",
    action: "proposal.created",
    detail: "Drafted proposal prop_q2_refresh with 3 reviewable changes.",
    createdAt: "2026-03-19T08:02:00.000Z",
  },
  {
    id: "audit_003",
    workbookId: "wb_q2_forecast",
    actor: "reviewer",
    action: "approval.requested",
    detail: "Finance manager requested approval on revenue assumption changes.",
    createdAt: "2026-03-19T08:06:00.000Z",
  },
  {
    id: "audit_004",
    workbookId: "wb_q2_forecast",
    actor: "system",
    action: "risk.summary.generated",
    detail: "Workbook marked needs_review with 3 active risks.",
    createdAt: "2026-03-19T08:08:00.000Z",
  },
];

export const demoReviewSnapshot: WorkbookReviewSnapshot = {
  workbook: demoWorkbook,
  proposal: demoProposal,
  auditEvents: demoAuditEvents,
};

export const demoSketchBoard: WorkbookSketchBoard = {
  id: "board_q2_forecast",
  workbookId: demoWorkbook.id,
  title: "Q2 Forecast Operating Plan",
  updatedAt: "2026-03-19T08:12:00.000Z",
  updatedBy: "Finance Manager",
  nodes: [
    {
      id: "board_node_assumptions",
      label: "Assumptions",
      x: 10,
      y: 20,
      width: 160,
      height: 74,
      color: "green",
      linkKind: "sheet",
      linkTargetId: "Assumptions",
    },
    {
      id: "board_node_forecast",
      label: "Forecast Rollup",
      x: 220,
      y: 80,
      width: 176,
      height: 74,
      color: "mint",
      linkKind: "sheet",
      linkTargetId: "Forecast",
    },
    {
      id: "board_node_signoff",
      label: "Finance Signoff",
      x: 430,
      y: 24,
      width: 168,
      height: 74,
      color: "lime",
      linkKind: "proposal",
      linkTargetId: demoProposal.id,
    },
  ],
  links: [
    {
      id: "board_conn_1",
      fromNodeId: "board_node_assumptions",
      toNodeId: "board_node_forecast",
    },
    {
      id: "board_conn_2",
      fromNodeId: "board_node_forecast",
      toNodeId: "board_node_signoff",
    },
  ],
  notes: "Seeded board linking workbook structure to the approval flow.",
};

export function listDemoWorkbooks(): WorkbookSummary[] {
  return [
    {
      id: demoWorkbook.id,
      name: demoWorkbook.name,
      latestVersionId: demoWorkbook.latestVersionId,
      sheetCount: demoWorkbook.sheetCount,
      createdAt: demoWorkbook.createdAt,
      tags: demoWorkbook.tags,
    },
  ];
}

export function getDemoReviewSnapshot(
  workbookId: WorkbookId,
): WorkbookReviewSnapshot | null {
  return workbookId === demoReviewSnapshot.workbook.id ? demoReviewSnapshot : null;
}

export function createSeededSketchBoard(
  snapshot: WorkbookReviewSnapshot,
  updatedBy = "system",
): WorkbookSketchBoard {
  const createdAt = snapshot.auditEvents[0]?.createdAt ?? snapshot.workbook.createdAt;
  const firstSheet = snapshot.workbook.sheets[0];
  const secondSheet = snapshot.workbook.sheets[1];

  const nodeCandidates: Array<WorkbookSketchNode | null> = [
    firstSheet
      ? {
          id: `${snapshot.workbook.id}_board_sheet_1`,
          label: firstSheet.name,
          x: 20,
          y: 32,
          width: 170,
          height: 76,
          color: "green",
          linkKind: "sheet",
          linkTargetId: firstSheet.name,
        }
      : null,
    secondSheet
      ? {
          id: `${snapshot.workbook.id}_board_sheet_2`,
          label: secondSheet.name,
          x: 238,
          y: 118,
          width: 170,
          height: 76,
          color: "mint",
          linkKind: "sheet",
          linkTargetId: secondSheet.name,
        }
      : null,
    {
      id: `${snapshot.workbook.id}_board_proposal`,
      label: "Review Proposal",
      x: 438,
      y: 42,
      width: 182,
      height: 76,
      color: "lime",
      linkKind: "proposal",
      linkTargetId: snapshot.proposal.id,
    },
  ];
  const nodes = nodeCandidates.filter(
    (node): node is WorkbookSketchNode => node !== null,
  );

  const links: WorkbookSketchLink[] = [];
  if (nodes.length >= 2) {
    links.push({
      id: `${snapshot.workbook.id}_board_conn_1`,
      fromNodeId: nodes[0].id,
      toNodeId: nodes[1].id,
    });
  }
  if (nodes.length >= 3) {
    links.push({
      id: `${snapshot.workbook.id}_board_conn_2`,
      fromNodeId: nodes[1].id,
      toNodeId: nodes[2].id,
    });
  }

  return {
    id: `${snapshot.workbook.id}_board`,
    workbookId: snapshot.workbook.id,
    title: `${snapshot.workbook.name} Review Board`,
    updatedAt: createdAt,
    updatedBy,
    nodes,
    links,
    notes: "Persisted review board for workbook planning and approval handoff.",
  };
}

export function createUploadedWorkbookReview(
  fileName: string,
  uploadedAt: string,
): WorkbookReviewSnapshot {
  const baseName = fileName.replace(/\.[^.]+$/, "") || "Uploaded Workbook";
  const workbookId = `upload_${baseName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  const versionId = `${workbookId}_v001`;
  const proposalId = `${workbookId}_proposal_001`;

  return {
    workbook: {
      id: workbookId,
      name: baseName,
      latestVersionId: versionId,
      sheetCount: 3,
      createdAt: uploadedAt,
      tags: [],
      owner: "New upload",
      status: "needs_review",
      lastReviewedAt: uploadedAt,
      sheets: [
        {
          name: "Inputs",
          rows: 36,
          columns: 9,
          formulaCells: 6,
          populatedCells: 92,
          riskCount: 1,
          sampleRows: [["Input", "Value"], ["Growth", "1.05"]],
        },
        {
          name: "Model",
          rows: 96,
          columns: 14,
          formulaCells: 37,
          populatedCells: 284,
          riskCount: 2,
          sampleRows: [["Month", "Base", "Forecast"], ["Jan", "120", "130"]],
        },
        {
          name: "Summary",
          rows: 24,
          columns: 8,
          formulaCells: 12,
          populatedCells: 68,
          riskCount: 0,
          sampleRows: [["Metric", "Value"], ["Revenue", "420000"]],
        },
      ],
      risks: [
        {
          id: `${workbookId}_risk_1`,
          label: "Initial formula review pending",
          severity: "medium",
          location: "Model!D12:F18",
          summary: "Uploaded workbook has formula-heavy ranges that need first-pass review.",
        },
        {
          id: `${workbookId}_risk_2`,
          label: "Assumption validation pending",
          severity: "low",
          location: "Inputs!B3:B10",
          summary: "Key input values need owner validation before AI changes are applied.",
        },
      ],
      namedRanges: [],
      versions: [
        {
          id: versionId,
          createdAt: uploadedAt,
          createdBy: "system",
          note: "Initial uploaded workbook snapshot",
        },
      ],
    },
    proposal: {
      id: proposalId,
      workbookId,
      title: `Initial review draft for ${baseName}`,
      status: "pending_approval",
      createdAt: uploadedAt,
      requestedBy: "spreadbreadai",
      summary:
        "Generated a starter review proposal for the uploaded workbook. Diff entries should be refined after workbook parsing is implemented.",
      approvalRequired: true,
      diff: [
        {
          id: `${proposalId}_diff_1`,
          kind: "comment",
          cell: "Summary!B4",
          after: "Reviewer note: uploaded workbook pending structured formula analysis.",
          rationale: "Creates a placeholder review artifact for the first upload flow.",
          status: "pending",
          comments: [],
        },
      ],
    },
    auditEvents: [
      {
        id: `${workbookId}_audit_1`,
        workbookId,
        actor: "user",
        action: "workbook.uploaded",
        detail: `Workbook ${fileName} uploaded for review.`,
        createdAt: uploadedAt,
      },
      {
        id: `${workbookId}_audit_2`,
        workbookId,
        actor: "system",
        action: "proposal.seeded",
        detail: "Created an initial draft proposal for review.",
        createdAt: uploadedAt,
      },
    ],
  };
}

export function formatSnapshotForMcp(
  snapshot: WorkbookReviewSnapshot,
  sheetName?: string,
): string {
  const relevantSheets = sheetName
    ? snapshot.workbook.sheets.filter((sheet) => sheet.name === sheetName)
    : snapshot.workbook.sheets;
  const visibleRisks = sheetName
    ? snapshot.workbook.risks.filter((risk) => risk.location.startsWith(`${sheetName}!`))
    : snapshot.workbook.risks;

  return JSON.stringify(
    {
      workbook: {
        id: snapshot.workbook.id,
        name: snapshot.workbook.name,
        versionId: snapshot.workbook.latestVersionId,
        status: snapshot.workbook.status,
        sheetCount: snapshot.workbook.sheetCount,
        owner: snapshot.workbook.owner,
        tags: snapshot.workbook.tags,
        relevantSheets,
        visibleRisks,
        namedRanges: snapshot.workbook.namedRanges,
      },
      proposal: {
        id: snapshot.proposal.id,
        title: snapshot.proposal.title,
        status: snapshot.proposal.status,
        diffCount: snapshot.proposal.diff.length,
        approvalRequired: snapshot.proposal.approvalRequired,
      },
      auditEventCount: snapshot.auditEvents.length,
    },
    null,
    2,
  );
}
