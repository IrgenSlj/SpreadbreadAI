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

export type RiskSeverity = "low" | "medium" | "high";
export type DiffKind = "remove" | "add" | "update" | "comment";

export interface WorkbookSheetSummary {
  name: string;
  rows: number;
  columns: number;
  formulaCells: number;
  riskCount: number;
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
}

export interface WorkbookDetail extends WorkbookSummary {
  owner: string;
  status: "healthy" | "needs_review";
  lastReviewedAt: string;
  sheets: WorkbookSheetSummary[];
  risks: WorkbookRisk[];
}

export interface ProposalDiffEntry {
  id: EntityId;
  kind: DiffKind;
  cell: string;
  before?: string;
  after?: string;
  rationale: string;
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

const demoWorkbook: WorkbookDetail = {
  id: "wb_q2_forecast",
  name: "Q2 Forecast",
  latestVersionId: "wbv_014",
  sheetCount: 4,
  createdAt: "2026-03-17T08:20:00.000Z",
  owner: "FP&A",
  status: "needs_review",
  lastReviewedAt: "2026-03-19T07:10:00.000Z",
  sheets: [
    { name: "Assumptions", rows: 42, columns: 8, formulaCells: 12, riskCount: 1 },
    { name: "Pipeline", rows: 312, columns: 15, formulaCells: 29, riskCount: 2 },
    { name: "Forecast", rows: 144, columns: 18, formulaCells: 61, riskCount: 3 },
    { name: "Summary", rows: 28, columns: 10, formulaCells: 16, riskCount: 0 },
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
  diff: [
    {
      id: "diff_assumption",
      kind: "update",
      cell: "Assumptions!C7",
      before: "1.18",
      after: "1.24",
      rationale: "Aligns growth rate with revised pipeline coverage.",
    },
    {
      id: "diff_formula_fix",
      kind: "update",
      cell: "Forecast!G18",
      before: "=E18*F18",
      after: "=Pipeline!J18*F18",
      rationale: "Restores the intended dependency on pipeline value.",
    },
    {
      id: "diff_comment",
      kind: "comment",
      cell: "Summary!B6",
      after: "AI draft note: forecast reflects March pipeline refresh and flagged stale assumptions.",
      rationale: "Prepares reviewer commentary for signoff.",
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

export function listDemoWorkbooks(): WorkbookSummary[] {
  return [
    {
      id: demoWorkbook.id,
      name: demoWorkbook.name,
      latestVersionId: demoWorkbook.latestVersionId,
      sheetCount: demoWorkbook.sheetCount,
      createdAt: demoWorkbook.createdAt,
    },
  ];
}

export function getDemoReviewSnapshot(
  workbookId: WorkbookId,
): WorkbookReviewSnapshot | null {
  return workbookId === demoReviewSnapshot.workbook.id ? demoReviewSnapshot : null;
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
      owner: "New upload",
      status: "needs_review",
      lastReviewedAt: uploadedAt,
      sheets: [
        { name: "Inputs", rows: 36, columns: 9, formulaCells: 6, riskCount: 1 },
        { name: "Model", rows: 96, columns: 14, formulaCells: 37, riskCount: 2 },
        { name: "Summary", rows: 24, columns: 8, formulaCells: 12, riskCount: 0 },
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
    },
    proposal: {
      id: proposalId,
      workbookId,
      title: `Initial review draft for ${baseName}`,
      status: "draft",
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
        relevantSheets,
        visibleRisks,
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
