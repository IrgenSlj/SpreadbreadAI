import type {
  WorkbookAccessAssignment,
  WorkbookAccessScope,
} from "../../../packages/shared/src/index.js";

export interface WorkbookAccessTarget {
  sheetName?: string;
  reference?: string;
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function stripSheetQuotes(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  return trimmed;
}

function normalizeSheetName(value: string) {
  return normalizeToken(stripSheetQuotes(value));
}

function columnLabelToIndex(label: string) {
  let index = 0;
  for (const char of label.toUpperCase()) {
    if (char < "A" || char > "Z") {
      return Number.NaN;
    }

    index = index * 26 + (char.charCodeAt(0) - 64);
  }

  return index;
}

function decodeCellAddress(address: string) {
  const match = address.trim().match(/^\$?([A-Za-z]{1,3})\$?(\d+)$/);
  if (!match) {
    return null;
  }

  const column = columnLabelToIndex(match[1]);
  const row = Number.parseInt(match[2], 10);

  if (!Number.isFinite(column) || column <= 0 || !Number.isFinite(row) || row <= 0) {
    return null;
  }

  return { column, row };
}

function decodeReferenceRange(reference: string) {
  const parts = reference.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  const start = decodeCellAddress(parts[0]);
  const end = decodeCellAddress(parts[parts.length - 1]);

  if (!start || !end) {
    return null;
  }

  return {
    startColumn: Math.min(start.column, end.column),
    startRow: Math.min(start.row, end.row),
    endColumn: Math.max(start.column, end.column),
    endRow: Math.max(start.row, end.row),
  };
}

function parseWorkbookTarget(value?: string | null): WorkbookAccessTarget | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const separatorIndex = trimmed.lastIndexOf("!");
  if (separatorIndex < 0) {
    return {
      sheetName: stripSheetQuotes(trimmed),
    };
  }

  const sheetName = stripSheetQuotes(trimmed.slice(0, separatorIndex));
  const reference = trimmed.slice(separatorIndex + 1).trim();

  return sheetName
    ? {
        sheetName,
        reference: reference || undefined,
      }
    : null;
}

function targetMatchesSheet(scopeSheetName: string, targetSheetName?: string) {
  if (!targetSheetName) {
    return false;
  }

  return normalizeSheetName(scopeSheetName) === normalizeSheetName(targetSheetName);
}

function targetReferenceWithinScope(reference: string, targetReference?: string) {
  if (!targetReference) {
    return false;
  }

  const scopeRange = decodeReferenceRange(reference);
  const targetRange = decodeReferenceRange(targetReference);
  if (!scopeRange || !targetRange) {
    return false;
  }

  return (
    targetRange.startColumn >= scopeRange.startColumn &&
    targetRange.endColumn <= scopeRange.endColumn &&
    targetRange.startRow >= scopeRange.startRow &&
    targetRange.endRow <= scopeRange.endRow
  );
}

function normalizeWorkbookAccessScope(input: unknown): WorkbookAccessScope | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  const kind = typeof candidate.kind === "string" ? candidate.kind : "";
  const sheetName = typeof candidate.sheetName === "string" ? candidate.sheetName.trim() : "";

  if (!sheetName) {
    return null;
  }

  if (kind === "sheet") {
    return { kind: "sheet", sheetName };
  }

  if (kind === "range") {
    const range = typeof candidate.range === "string" ? candidate.range.trim() : "";
    if (!range) {
      return null;
    }

    return { kind: "range", sheetName, range };
  }

  return null;
}

export function normalizeWorkbookAccessScopes(input: {
  scopes?: unknown;
  sheetScopes?: unknown;
  rangeScopes?: unknown;
}): WorkbookAccessScope[] {
  const scopes: WorkbookAccessScope[] = [];
  const seen = new Set<string>();

  const pushScope = (scope: WorkbookAccessScope | null) => {
    if (!scope) {
      return;
    }

    const key =
      scope.kind === "sheet"
        ? `sheet:${normalizeSheetName(scope.sheetName)}`
        : `range:${normalizeSheetName(scope.sheetName)}:${scope.range.trim().toUpperCase()}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    scopes.push(scope);
  };

  if (Array.isArray(input.scopes)) {
    for (const scope of input.scopes) {
      pushScope(normalizeWorkbookAccessScope(scope));
    }
  }

  if (Array.isArray(input.sheetScopes)) {
    for (const sheetScope of input.sheetScopes) {
      if (typeof sheetScope !== "string" || !sheetScope.trim()) {
        continue;
      }

      pushScope({ kind: "sheet", sheetName: sheetScope.trim() });
    }
  }

  if (Array.isArray(input.rangeScopes)) {
    for (const rangeScope of input.rangeScopes) {
      if (typeof rangeScope !== "string") {
        continue;
      }

      const parsed = parseWorkbookTarget(rangeScope);
      if (!parsed?.sheetName || !parsed.reference) {
        continue;
      }

      pushScope({
        kind: "range",
        sheetName: parsed.sheetName,
        range: parsed.reference,
      });
    }
  }

  return scopes;
}

export function serializeWorkbookAccessScopes(scopes: WorkbookAccessScope[] | undefined) {
  const sheetScopes: string[] = [];
  const rangeScopes: string[] = [];

  for (const scope of scopes ?? []) {
    if (scope.kind === "sheet") {
      sheetScopes.push(scope.sheetName);
      continue;
    }

    rangeScopes.push(`${scope.sheetName}!${scope.range}`);
  }

  return {
    scopes: scopes ?? [],
    sheetScopes,
    rangeScopes,
  };
}

export function workbookAccessTargetFromCell(value?: string | null) {
  return parseWorkbookTarget(value);
}

export function workbookAccessAssignmentAllowsTarget(
  assignment: Pick<WorkbookAccessAssignment, "scopes" | "sheetScopes" | "rangeScopes">,
  target?: WorkbookAccessTarget | null,
) {
  const scopes = normalizeWorkbookAccessScopes({
    scopes: assignment.scopes,
    sheetScopes: assignment.sheetScopes,
    rangeScopes: assignment.rangeScopes,
  });

  if (!target) {
    return scopes.length === 0;
  }

  if (scopes.length === 0) {
    return true;
  }

  return scopes.some((scope) => {
    if (scope.kind === "sheet") {
      return targetMatchesSheet(scope.sheetName, target.sheetName);
    }

    return (
      targetMatchesSheet(scope.sheetName, target.sheetName) &&
      targetReferenceWithinScope(scope.range, target.reference)
    );
  });
}

export function workbookAccessAssignmentAllowsWorkbookAction(
  assignment: Pick<WorkbookAccessAssignment, "scopes" | "sheetScopes" | "rangeScopes">,
  target?: WorkbookAccessTarget | null,
) {
  return workbookAccessAssignmentAllowsTarget(assignment, target);
}
