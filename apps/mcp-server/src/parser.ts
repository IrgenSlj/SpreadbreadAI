import path from "node:path";
import * as XLSX from "xlsx";
import type {
  AuditEvent,
  ProposalDetail,
  ProposalDiffEntry,
  WorkbookReviewSnapshot,
  WorkbookNamedRange,
  WorkbookRisk,
  WorkbookSheetSummary,
} from "../../../packages/shared/src/index.js";

interface ParsedWorkbookInput {
  workbookId: string;
  fileName: string;
  uploadedAt: string;
  bytes: Uint8Array;
}

function getWorkbookName(fileName: string) {
  const baseName = path.basename(fileName).replace(/\.[^.]+$/, "");
  return baseName || "Uploaded Workbook";
}

function readWorkbook(fileName: string, bytes: Uint8Array) {
  const extension = path.extname(fileName).toLowerCase();

  if (extension === ".csv") {
    return XLSX.read(Buffer.from(bytes).toString("utf8"), {
      type: "string",
      cellFormula: true,
      dense: false,
    });
  }

  return XLSX.read(bytes, {
    type: "array",
    cellFormula: true,
    dense: false,
  });
}

function summarizeSheet(sheetName: string, sheet: XLSX.WorkSheet): WorkbookSheetSummary {
  const ref = sheet["!ref"];

  if (!ref) {
    return {
      name: sheetName,
      rows: 0,
      columns: 0,
      formulaCells: 0,
      populatedCells: 0,
      riskCount: 1,
      sampleRows: [],
    };
  }

  const range = XLSX.utils.decode_range(ref);
  let formulaCells = 0;
  let populatedCells = 0;
  const sampleRows: string[][] = [];

  for (const [cellRef, cell] of Object.entries(sheet)) {
    if (cellRef.startsWith("!")) {
      continue;
    }

    populatedCells += 1;

    if (typeof cell === "object" && cell !== null && "f" in cell && cell.f) {
      formulaCells += 1;
    }
  }

  const jsonRows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    blankrows: false,
    raw: false,
  });

  for (const row of jsonRows.slice(0, 3)) {
    sampleRows.push(row.map((value) => (value == null ? "" : String(value))));
  }

  return {
    name: sheetName,
    rows: range.e.r - range.s.r + 1,
    columns: range.e.c - range.s.c + 1,
    formulaCells,
    populatedCells,
    riskCount: 0,
    sampleRows,
  };
}

function extractNamedRanges(workbook: XLSX.WorkBook): WorkbookNamedRange[] {
  return (workbook.Workbook?.Names ?? []).map((entry) => {
    const [sheetPrefix] = entry.Ref?.split("!") ?? [];
    const normalizedSheet =
      sheetPrefix && !sheetPrefix.includes(":")
        ? sheetPrefix.replace(/^'/, "").replace(/'$/, "")
        : undefined;

    return {
      name: entry.Name ?? "unnamed_range",
      sheetName: normalizedSheet,
      reference: entry.Ref ?? "",
    };
  });
}

function detectWorkbookRisks(
  workbookId: string,
  sheets: Array<{ summary: WorkbookSheetSummary; sheet: XLSX.WorkSheet }>,
): WorkbookRisk[] {
  const risks: WorkbookRisk[] = [];

  for (const { summary, sheet } of sheets) {
    if (summary.rows === 0 || summary.columns === 0) {
      risks.push({
        id: `${workbookId}_${summary.name}_empty`,
        label: "Sheet has no active cells",
        severity: "low",
        location: `${summary.name}!A1`,
        summary: "The sheet is present but has no populated range.",
      });
      continue;
    }

    const totalCells = Math.max(summary.rows * summary.columns, 1);
    const formulaDensity = summary.formulaCells / totalCells;

    if (summary.formulaCells > 0 && formulaDensity >= 0.2) {
      risks.push({
        id: `${workbookId}_${summary.name}_formula_density`,
        label: "High formula density",
        severity: formulaDensity >= 0.45 ? "high" : "medium",
        location: `${summary.name}!${sheet["!ref"] ?? "A1"}`,
        summary: `${summary.formulaCells} formula cells across ${summary.rows} rows and ${summary.columns} columns need targeted review.`,
      });
    }

    let errorCell: string | null = null;

    for (const [cellRef, cell] of Object.entries(sheet)) {
      if (cellRef.startsWith("!")) {
        continue;
      }

      if (typeof cell !== "object" || cell === null) {
        continue;
      }

      const rendered =
        (typeof cell.w === "string" ? cell.w : undefined) ??
        (typeof cell.v === "string" ? cell.v : undefined) ??
        "";

      if (
        rendered.includes("#REF!") ||
        rendered.includes("#VALUE!") ||
        rendered.includes("#NAME?") ||
        rendered.includes("#DIV/0!")
      ) {
        errorCell = cellRef;
        break;
      }
    }

    if (errorCell) {
      risks.push({
        id: `${workbookId}_${summary.name}_formula_error`,
        label: "Formula error detected",
        severity: "high",
        location: `${summary.name}!${errorCell}`,
        summary: "The workbook contains an explicit formula error marker that should be reviewed before approval.",
      });
    }
  }

  if (risks.length === 0) {
    risks.push({
      id: `${workbookId}_baseline_review`,
      label: "Manual review still required",
      severity: "low",
      location: `${sheets[0]?.summary.name ?? "Workbook"}!A1`,
      summary: "No structural issues were detected from metadata alone, but workbook logic still requires reviewer signoff.",
    });
  }

  return risks;
}

function buildProposal(
  workbookId: string,
  fileName: string,
  uploadedAt: string,
  risks: WorkbookRisk[],
  namedRanges: WorkbookNamedRange[],
): ProposalDetail {
  const baseName = getWorkbookName(fileName);
  const leadRisk = risks[0];
  const diff: ProposalDiffEntry[] = [];

  risks.forEach((risk, index) => {
    if (risk.label === "Formula error detected") {
      diff.push({
        id: `${workbookId}_proposal_001_diff_${diff.length + 1}`,
        kind: "comment",
        cell: risk.location,
        after: `Review required: investigate the error at ${risk.location} before any workbook write is approved.`,
        rationale: risk.summary,
        status: "pending",
      });
      return;
    }

    if (risk.label === "High formula density") {
      diff.push({
        id: `${workbookId}_proposal_001_diff_${diff.length + 1}`,
        kind: "comment",
        cell: risk.location,
        after: `Reviewer checklist: validate formula blocks in ${risk.location} against their source assumptions.`,
        rationale: risk.summary,
        status: "pending",
      });
      return;
    }

    diff.push({
      id: `${workbookId}_proposal_001_diff_${diff.length + 1}`,
      kind: "comment",
      cell: risk.location,
      after: `Review note ${index + 1}: ${risk.label}`,
      rationale: risk.summary,
      status: "pending",
    });
  });

  namedRanges.slice(0, 2).forEach((namedRange) => {
    diff.push({
      id: `${workbookId}_proposal_001_diff_${diff.length + 1}`,
      kind: "comment",
      cell: namedRange.reference,
      after: `Named range anchor ready for future workflow automation: ${namedRange.name}.`,
      rationale:
        "Named ranges are stable handles for future proposal generation, approvals, and sketch-to-workbook links.",
      status: "pending",
    });
  });

  if (diff.length === 0) {
    diff.push({
      id: `${workbookId}_proposal_001_diff_1`,
      kind: "comment",
      cell: "Workbook!A1",
      after: "Reviewer note: workbook parsed cleanly but still requires signoff.",
      rationale:
        "Creates a baseline review artifact even when structural heuristics do not surface a strong signal.",
      status: "pending",
    });
  }

  const summaryParts = [
    leadRisk?.summary ?? "Workbook parsed without critical structural findings.",
    namedRanges.length > 0 ? `${namedRanges.length} named ranges detected.` : null,
    `${diff.length} review actions proposed.`,
  ].filter(Boolean);

  return {
    id: `${workbookId}_proposal_001`,
    workbookId,
    title: `Initial review draft for ${baseName}`,
    status: "pending_approval",
    createdAt: uploadedAt,
    requestedBy: "spreadbreadai",
    summary: summaryParts.join(" "),
    approvalRequired: true,
    diff,
  };
}

function buildAuditEvents(
  workbookId: string,
  fileName: string,
  uploadedAt: string,
  sheetCount: number,
  riskCount: number,
): AuditEvent[] {
  return [
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
      action: "workbook.parsed",
      detail: `Parsed ${sheetCount} sheets and identified ${riskCount} review signals.`,
      createdAt: uploadedAt,
    },
    {
      id: `${workbookId}_audit_3`,
      workbookId,
      actor: "system",
      action: "proposal.seeded",
      detail: "Created an initial draft proposal from parsed workbook metadata.",
      createdAt: uploadedAt,
    },
  ];
}

export function parseWorkbookReviewSnapshot(
  input: ParsedWorkbookInput,
): WorkbookReviewSnapshot {
  const workbook = readWorkbook(input.fileName, input.bytes);
  const namedSheets = workbook.SheetNames.map((sheetName) => ({
    summary: summarizeSheet(sheetName, workbook.Sheets[sheetName]),
    sheet: workbook.Sheets[sheetName],
  }));
  const namedRanges = extractNamedRanges(workbook);

  const risks = detectWorkbookRisks(input.workbookId, namedSheets);
  const sheets = namedSheets.map(({ summary }) => ({
    ...summary,
    riskCount: risks.filter((risk) => risk.location.startsWith(`${summary.name}!`)).length,
  }));

  return {
    workbook: {
      id: input.workbookId,
      name: getWorkbookName(input.fileName),
      latestVersionId: `${input.workbookId}_v001`,
      sheetCount: sheets.length,
      createdAt: input.uploadedAt,
      owner: "New upload",
      status: risks.some((risk) => risk.severity !== "low") ? "needs_review" : "healthy",
      lastReviewedAt: input.uploadedAt,
      sheets,
      risks,
      namedRanges,
      versions: [
        {
          id: `${input.workbookId}_v001`,
          createdAt: input.uploadedAt,
          createdBy: "system",
          note: "Initial parsed workbook snapshot",
        },
      ],
    },
    proposal: buildProposal(
      input.workbookId,
      input.fileName,
      input.uploadedAt,
      risks,
      namedRanges,
    ),
    auditEvents: buildAuditEvents(
      input.workbookId,
      input.fileName,
      input.uploadedAt,
      sheets.length,
      risks.length,
    ),
  };
}
