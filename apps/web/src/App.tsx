import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  type ApprovalDecision,
  createSeededSketchBoard,
  demoReviewSnapshot,
  type ProposalDiffEntry,
  type ProposalItemComment,
  type WorkbookSketchBoard,
  type WorkbookSummary,
  type WorkbookReviewSnapshot,
} from "../../../packages/shared/src/index";

type Section = "workbook" | "proposal" | "audit" | "sketch";
type MutationAction =
  | "initial-load"
  | "workbook-load"
  | "upload"
  | "proposal-decision"
  | "proposal-item-decision"
  | "apply"
  | "sketch-save";

type WorkbooksResponse = {
  workbooks: WorkbookSummary[];
};

type ReviewResponse = {
  review: WorkbookReviewSnapshot;
};

type UploadResponse = {
  workbookId: string;
  review: WorkbookReviewSnapshot;
};

type SketchBoardResponse = {
  sketchBoard: WorkbookSketchBoard;
};

type WorkbookOriginFilter = "all" | "demo" | "uploaded";
type WorkbookSheetFilter = "all" | "single" | "multi";
type CommentFilterMode = "all" | "with-comments" | "mine" | "mentions";

type ItemCommentState = {
  submitting: boolean;
  error: string | null;
};

type RuntimeBackendMode = "local" | "file-store" | "postgres" | "hybrid" | "unknown";

type RuntimeBackendInfo = {
  backendMode: RuntimeBackendMode;
  backendLabel: string;
  backendSource: "api" | "derived";
  backendUpdatedAt?: string;
};

type RuntimeStatusResponse = {
  runtime?: {
    backendMode?: string;
    backendLabel?: string;
    backendSource?: string;
    mode?: string;
    label?: string;
    source?: string;
    updatedAt?: string;
    lastUpdatedAt?: string;
  };
  status?: {
    backendMode?: string;
    backendLabel?: string;
    backendSource?: string;
    mode?: string;
    label?: string;
    source?: string;
    updatedAt?: string;
    lastUpdatedAt?: string;
  };
  backendMode?: string;
  backendLabel?: string;
  backendSource?: string;
  mode?: string;
  label?: string;
  source?: string;
  updatedAt?: string;
  lastUpdatedAt?: string;
};

const sections: Array<{ id: Section; label: string; description: string }> = [
  {
    id: "workbook",
    label: "Workbook Review",
    description: "Inspect sheet structure, formulas, and risk signals.",
  },
  {
    id: "proposal",
    label: "Proposal Review",
    description: "Compare AI drafts, diffs, and approval requests.",
  },
  {
    id: "audit",
    label: "Audit Trail",
    description: "Trace actions, approvals, and workbook versions.",
  },
  {
    id: "sketch",
    label: "Sketchpad",
    description: "Map ideas and link them to workbook entities.",
  },
];

function diffClassName(kind: ProposalDiffEntry["kind"]) {
  switch (kind) {
    case "remove":
      return "removed";
    case "add":
      return "added";
    case "update":
      return "neutral";
    case "comment":
      return "comment";
    default:
      return "neutral";
  }
}

function itemStatusLabel(status: ProposalDiffEntry["status"]) {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    default:
      return "Pending";
  }
}

function createDemoWorkbookSummary(): WorkbookSummary {
  return {
    id: demoReviewSnapshot.workbook.id,
    name: demoReviewSnapshot.workbook.name,
    latestVersionId: demoReviewSnapshot.workbook.latestVersionId,
    sheetCount: demoReviewSnapshot.workbook.sheetCount,
    createdAt: demoReviewSnapshot.workbook.createdAt,
  };
}

function snapshotToWorkbookSummary(snapshot: WorkbookReviewSnapshot): WorkbookSummary {
  return {
    id: snapshot.workbook.id,
    name: snapshot.workbook.name,
    latestVersionId: snapshot.workbook.latestVersionId,
    sheetCount: snapshot.workbook.sheetCount,
    createdAt: snapshot.workbook.createdAt,
  };
}

function normalizeHandle(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function mentionHandleForReviewer(value: string) {
  const normalized = normalizeHandle(value);
  return normalized.length > 0 ? `@${normalized}` : "@reviewer";
}

function extractMentions(value: string) {
  return Array.from(value.matchAll(/(^|\s)(@[a-z0-9._-]+)/gi)).map((match) =>
    match[2].toLowerCase(),
  );
}

function renderCommentBody(body: string) {
  const segments = body.split(/(@[a-z0-9._-]+)/gi);

  return segments.map((segment, index) =>
    /^@[a-z0-9._-]+$/i.test(segment) ? (
      <mark key={`${segment}-${index}`} className="mention-pill">
        {segment}
      </mark>
    ) : (
      <span key={`${segment}-${index}`}>{segment}</span>
    ),
  );
}

function findFormulaPreview(snapshot: WorkbookReviewSnapshot) {
  for (const sheet of snapshot.workbook.sheets) {
    for (const row of sheet.sampleRows) {
      const formulaCell = row.find((cell) => cell.startsWith("="));

      if (formulaCell) {
        return `${sheet.name}!${formulaCell}`;
      }
    }
  }

  const firstSheet = snapshot.workbook.sheets[0];

  return firstSheet ? `=${firstSheet.name}!A1` : "=A1";
}

function normalizeBackendMode(value: unknown): RuntimeBackendMode {
  const mode = String(value ?? "").toLowerCase();

  if (mode.includes("postgres")) {
    return "postgres";
  }

  if (mode.includes("file")) {
    return "file-store";
  }

  if (mode.includes("hybrid")) {
    return "hybrid";
  }

  if (mode.includes("local")) {
    return "local";
  }

  return "unknown";
}

function backendLabelForMode(mode: RuntimeBackendMode, explicitLabel?: string) {
  if (explicitLabel && explicitLabel.trim().length > 0) {
    return explicitLabel;
  }

  switch (mode) {
    case "postgres":
      return "PostgreSQL";
    case "file-store":
      return "Local file store";
    case "hybrid":
      return "Hybrid runtime";
    case "local":
      return "Local runtime";
    default:
      return "Runtime unavailable";
  }
}

function createDerivedRuntimeInfo(
  _workbooks: WorkbookSummary[],
  snapshot: WorkbookReviewSnapshot,
): RuntimeBackendInfo {
  return {
    backendMode: "local",
    backendLabel: "Derived from local review state",
    backendSource: "derived",
    backendUpdatedAt: snapshot.auditEvents[snapshot.auditEvents.length - 1]?.createdAt,
  };
}

function App() {
  const [section, setSection] = useState<Section>("workbook");
  const [snapshot, setSnapshot] = useState<WorkbookReviewSnapshot>(demoReviewSnapshot);
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[]>([
    createDemoWorkbookSummary(),
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeMutation, setActiveMutation] = useState<MutationAction | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reviewerName, setReviewerName] = useState("Finance Manager");
  const [reviewComment, setReviewComment] = useState("");
  const [runtimeBackend, setRuntimeBackend] = useState<RuntimeBackendInfo>(
    createDerivedRuntimeInfo([createDemoWorkbookSummary()], demoReviewSnapshot),
  );
  const [workbookSearchQuery, setWorkbookSearchQuery] = useState("");
  const [workbookOriginFilter, setWorkbookOriginFilter] =
    useState<WorkbookOriginFilter>("all");
  const [workbookSheetFilter, setWorkbookSheetFilter] =
    useState<WorkbookSheetFilter>("all");
  const [commentSearchQuery, setCommentSearchQuery] = useState("");
  const [commentFilterMode, setCommentFilterMode] =
    useState<CommentFilterMode>("all");
  const [itemCommentDrafts, setItemCommentDrafts] = useState<Record<string, string>>({});
  const [itemCommentState, setItemCommentState] = useState<Record<string, ItemCommentState>>({});
  const [sketchBoard, setSketchBoard] = useState<WorkbookSketchBoard>(
    createSeededSketchBoard(demoReviewSnapshot, "system"),
  );
  const [sketchError, setSketchError] = useState<string | null>(null);

  const pendingRisks = useMemo(
    () => snapshot.workbook.risks.filter((risk) => risk.severity !== "low"),
    [snapshot],
  );
  const approvedItems = useMemo(
    () => snapshot.proposal.diff.filter((entry) => entry.status === "approved"),
    [snapshot],
  );
  const rejectedItems = useMemo(
    () => snapshot.proposal.diff.filter((entry) => entry.status === "rejected"),
    [snapshot],
  );
  const pendingItems = useMemo(
    () => snapshot.proposal.diff.filter((entry) => entry.status === "pending"),
    [snapshot],
  );
  const reviewedItems = useMemo(
    () => snapshot.proposal.diff.filter((entry) => entry.status !== "pending"),
    [snapshot],
  );
  const mutationInFlight = activeMutation !== null;
  const proposalHasItemDecisions = reviewedItems.length > 0;
  const proposalIsLocked =
    snapshot.proposal.status === "applied" ||
    snapshot.proposal.status === "approved" ||
    snapshot.proposal.status === "rejected";
  const canUseProposalShortcut = !mutationInFlight && !proposalHasItemDecisions && snapshot.proposal.status === "pending_approval";
  const canUseItemReview = !mutationInFlight && !proposalIsLocked;
  const canApplyApprovedItems =
    !mutationInFlight &&
    !proposalIsLocked &&
    pendingItems.length === 0 &&
    approvedItems.length > 0;
  const workflowStatusMessage = proposalIsLocked
    ? snapshot.proposal.status === "applied"
      ? "Applied proposals are locked. Start a new upload to continue editing."
      : "This proposal is locked in the UI. Upload a new workbook to start a fresh review."
    : proposalHasItemDecisions
      ? "Item-level review has started. Whole-proposal approval is disabled so the workflow stays on one path."
      : "Choose either the proposal shortcut or item-level review first. Once review starts, the other path locks.";
  const activeSheet = snapshot.workbook.sheets[0];
  const formulaPreview = findFormulaPreview(snapshot);
  const reviewerHandle = mentionHandleForReviewer(reviewerName);
  const filteredWorkbooks = useMemo(() => {
    const query = workbookSearchQuery.trim().toLowerCase();

    return workbooks.filter((workbook) => {
      if (workbookOriginFilter === "demo" && workbook.id !== demoReviewSnapshot.workbook.id) {
        return false;
      }

      if (workbookOriginFilter === "uploaded" && workbook.id === demoReviewSnapshot.workbook.id) {
        return false;
      }

      if (workbookSheetFilter === "single" && workbook.sheetCount !== 1) {
        return false;
      }

      if (workbookSheetFilter === "multi" && workbook.sheetCount < 2) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [workbook.name, workbook.id, workbook.latestVersionId].some((field) =>
        field.toLowerCase().includes(query),
      );
    });
  }, [workbookOriginFilter, workbookSearchQuery, workbookSheetFilter, workbooks]);
  const filteredProposalEntries = useMemo(() => {
    const query = commentSearchQuery.trim().toLowerCase();
    const reviewerNameNormalized = reviewerName.trim().toLowerCase();
    const reviewerMention = reviewerHandle.toLowerCase();
    const filtersActive = commentFilterMode !== "all" || query.length > 0;

    return snapshot.proposal.diff
      .map((entry) => {
        const comments = entry.comments ?? [];
        const visibleComments = comments.filter((comment) => {
          const matchesQuery =
            query.length === 0 ||
            [comment.author, comment.body, entry.cell].some((field) =>
              field.toLowerCase().includes(query),
            );

          if (!matchesQuery) {
            return false;
          }

          switch (commentFilterMode) {
            case "with-comments":
              return true;
            case "mine":
              return comment.author.trim().toLowerCase() === reviewerNameNormalized;
            case "mentions":
              return extractMentions(comment.body).includes(reviewerMention);
            default:
              return true;
          }
        });

        if (!filtersActive) {
          return {
            entry,
            visibleComments: comments,
          };
        }

        const shouldKeepEntry =
          visibleComments.length > 0 ||
          (commentFilterMode === "with-comments" && comments.length > 0 && query.length === 0);

        return shouldKeepEntry
          ? {
              entry,
              visibleComments,
            }
          : null;
      })
      .filter((item): item is { entry: ProposalDiffEntry; visibleComments: ProposalItemComment[] } =>
        item !== null,
      );
  }, [commentFilterMode, commentSearchQuery, reviewerHandle, reviewerName, snapshot.proposal.diff]);
  const runtimeCounts = useMemo(
    () => ({
      workbookCount: workbooks.length,
      versionCount: snapshot.workbook.versions.length,
      auditEventCount: snapshot.auditEvents.length,
      proposalItemCount: snapshot.proposal.diff.length,
      reviewedItemCount: reviewedItems.length,
    }),
    [reviewedItems.length, snapshot, workbooks.length],
  );
  const runtimeStatus = {
    ...runtimeBackend,
    ...runtimeCounts,
  };
  const sketchNodeOptions = useMemo(
    () =>
      snapshot.workbook.sheets.map((sheet) => ({
        id: `${snapshot.workbook.id}_sheet_${normalizeHandle(sheet.name)}`,
        label: sheet.name,
      })),
    [snapshot.workbook.id, snapshot.workbook.sheets],
  );

  function canReviewItem(entry: ProposalDiffEntry) {
    return canUseItemReview && entry.status === "pending";
  }

  function getItemCommentState(entryId: string): ItemCommentState {
    return itemCommentState[entryId] ?? { submitting: false, error: null };
  }

  function getItemCommentDraft(entryId: string) {
    return itemCommentDrafts[entryId] ?? "";
  }

  function setItemCommentDraft(entryId: string, draft: string) {
    setItemCommentDrafts((current) => ({
      ...current,
      [entryId]: draft,
    }));
  }

  function updateItemCommentState(
    entryId: string,
    nextState: Partial<ItemCommentState>,
  ) {
    setItemCommentState((current) => ({
      ...current,
      [entryId]: {
        ...(current[entryId] ?? {
          submitting: false,
          error: null,
        }),
        ...nextState,
      },
    }));
  }

  function canCommentOnItem(entry: ProposalDiffEntry) {
    return (
      !proposalIsLocked &&
      !mutationInFlight &&
      reviewerName.trim().length > 0 &&
      !getItemCommentState(entry.id).submitting
    );
  }

  function updateSketchBoard(
    updater: (current: WorkbookSketchBoard) => WorkbookSketchBoard,
  ) {
    setSketchBoard((current) => updater(current));
  }

  function addSketchNodeFromLabel(label: string, color: string) {
    updateSketchBoard((current) => ({
      ...current,
      nodes: [
        ...current.nodes,
        {
          id: `${snapshot.workbook.id}_node_${Date.now().toString(36)}`,
          label,
          x: 24 + (current.nodes.length % 3) * 198,
          y: 30 + Math.floor(current.nodes.length / 3) * 112,
          width: 170,
          height: 78,
          color,
        },
      ],
      updatedBy: reviewerName,
      updatedAt: new Date().toISOString(),
    }));
  }

  async function loadSketchBoard(
    workbookId: string,
    reviewSnapshot: WorkbookReviewSnapshot,
  ) {
    try {
      setSketchError(null);
      const response = await fetch(`/api/workbooks/${encodeURIComponent(workbookId)}/sketch`);

      if (response.status === 404) {
        setSketchBoard(createSeededSketchBoard(reviewSnapshot, "system"));
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to load sketch board (${response.status})`);
      }

      const data = (await response.json()) as SketchBoardResponse;
      setSketchBoard(data.sketchBoard);
    } catch (error) {
      setSketchError(error instanceof Error ? error.message : "Failed to load sketch board");
      setSketchBoard(createSeededSketchBoard(reviewSnapshot, "system"));
    }
  }

  useEffect(() => {
    void loadWorkbooks({ allowDemoFallback: true });
  }, []);

  useEffect(() => {
    void loadRuntimeStatus();
  }, []);

  async function loadRuntimeStatus() {
    try {
      const response = await fetch("/api/runtime/status");

      if (!response.ok) {
        throw new Error(`Failed to load runtime status (${response.status})`);
      }

      const data = (await response.json()) as RuntimeStatusResponse;
      const runtime = data.runtime ?? data.status ?? data;
      const backendMode = normalizeBackendMode(
        runtime.backendMode ?? runtime.mode ?? runtime.source,
      );
      const backendLabel = backendLabelForMode(backendMode, runtime.backendLabel ?? runtime.label);
      const backendSource =
        String(runtime.backendSource ?? runtime.source ?? "").toLowerCase() === "api"
          ? "api"
          : "derived";

      setRuntimeBackend({
        backendMode,
        backendLabel,
        backendSource,
        backendUpdatedAt: runtime.updatedAt ?? runtime.lastUpdatedAt,
      });
    } catch {
      setRuntimeBackend(createDerivedRuntimeInfo(workbooks, snapshot));
    }
  }

  async function loadWorkbooks(options: {
    targetWorkbookId?: string;
    allowDemoFallback?: boolean;
  } = {}) {
    const { targetWorkbookId, allowDemoFallback = false } = options;

    try {
      setActiveMutation("initial-load");
      setErrorMessage(null);
      const response = await fetch("/api/workbooks");

      if (!response.ok) {
        throw new Error(`Failed to load workbooks (${response.status})`);
      }

      const data = (await response.json()) as WorkbooksResponse;
      setWorkbooks(data.workbooks);

      const workbookId =
        targetWorkbookId ?? data.workbooks[0]?.id ?? demoReviewSnapshot.workbook.id;

      await loadReview(workbookId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load workbook data";

      setErrorMessage(message);

      if (allowDemoFallback) {
        setWorkbooks([createDemoWorkbookSummary()]);
        setSnapshot(demoReviewSnapshot);
      }
    } finally {
      setActiveMutation(null);
    }
  }

  async function loadReview(workbookId: string) {
    const response = await fetch(`/api/workbooks/${encodeURIComponent(workbookId)}/review`);

    if (!response.ok) {
      throw new Error(`Failed to load workbook review (${response.status})`);
    }

    const data = (await response.json()) as { review: WorkbookReviewSnapshot };
    setSnapshot(data.review);
    await loadSketchBoard(workbookId, data.review);
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (mutationInFlight) {
      return;
    }

    try {
      setActiveMutation("upload");
      setIsLoading(true);
      setErrorMessage(null);

      const response = await fetch("/api/workbooks/upload", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      });

      if (!response.ok) {
        throw new Error(`Upload failed (${response.status})`);
      }

      const data = (await response.json()) as UploadResponse;

      setSnapshot(data.review);
      setWorkbooks((current) => {
        const summary = snapshotToWorkbookSummary(data.review);
        const next = current.filter((workbook) => workbook.id !== summary.id);

        return [summary, ...next];
      });
      setSection("workbook");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      setActiveMutation(null);
      event.target.value = "";
    }
  }

  async function handleWorkbookSelect(workbookId: string) {
    if (mutationInFlight) {
      return;
    }

    try {
      setActiveMutation("workbook-load");
      setErrorMessage(null);
      setIsLoading(true);
      await loadReview(workbookId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to switch workbook";

      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      setActiveMutation(null);
    }
  }

  async function handleProposalDecision(decision: ApprovalDecision) {
    if (!canUseProposalShortcut) {
      return;
    }

    try {
      setActiveMutation("proposal-decision");
      setIsLoading(true);
      setErrorMessage(null);

      const response = await fetch(
        `/api/workbooks/${encodeURIComponent(snapshot.workbook.id)}/proposal/decision`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            decision,
            reviewer: reviewerName,
            comment: reviewComment,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Proposal decision failed (${response.status})`);
      }

      const data = (await response.json()) as ReviewResponse;
      setSnapshot(data.review);
      setSection("proposal");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update proposal decision";

      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      setActiveMutation(null);
    }
  }

  async function handleProposalItemDecision(
    diffId: string,
    decision: ApprovalDecision,
  ) {
    if (!canUseItemReview) {
      return;
    }

    try {
      setActiveMutation("proposal-item-decision");
      setIsLoading(true);
      setErrorMessage(null);

      const response = await fetch(
        `/api/workbooks/${encodeURIComponent(
          snapshot.workbook.id,
        )}/proposal/items/${encodeURIComponent(diffId)}/decision`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            decision,
            reviewer: reviewerName,
            comment: reviewComment,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Proposal item decision failed (${response.status})`);
      }

      const data = (await response.json()) as ReviewResponse;
      setSnapshot(data.review);
      setSection("proposal");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update proposal item";

      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      setActiveMutation(null);
    }
  }

  async function handleProposalItemComment(diffId: string) {
    const body = getItemCommentDraft(diffId).trim();
    const commentState = getItemCommentState(diffId);

    if (!body || commentState.submitting || proposalIsLocked || mutationInFlight) {
      return;
    }

    updateItemCommentState(diffId, { submitting: true, error: null });

    const nextComment: ProposalItemComment = {
      id: `${diffId}_comment_${Date.now().toString(36)}`,
      author: reviewerName.trim(),
      body,
      createdAt: new Date().toISOString(),
    };

    setSnapshot((current) => ({
      ...current,
      proposal: {
        ...current.proposal,
        diff: current.proposal.diff.map((entry) =>
          entry.id === diffId
            ? {
                ...entry,
                comments: [...(entry.comments ?? []), nextComment],
              }
            : entry,
        ),
      },
    }));
    setItemCommentDraft(diffId, "");
    updateItemCommentState(diffId, { submitting: false, error: null });
  }

  async function handleApplyApprovedItems() {
    if (!canApplyApprovedItems) {
      return;
    }

    try {
      setActiveMutation("apply");
      setIsLoading(true);
      setErrorMessage(null);

      const response = await fetch(
        `/api/workbooks/${encodeURIComponent(snapshot.workbook.id)}/proposal/apply`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            actor: reviewerName,
            note: reviewComment,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Apply failed (${response.status})`);
      }

      const data = (await response.json()) as ReviewResponse;
      setSnapshot(data.review);
      setSection("proposal");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply items";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      setActiveMutation(null);
    }
  }

  async function handleSketchSave() {
    if (mutationInFlight) {
      return;
    }

    try {
      setActiveMutation("sketch-save");
      setIsLoading(true);
      setSketchError(null);

      const response = await fetch(
        `/api/workbooks/${encodeURIComponent(snapshot.workbook.id)}/sketch`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: sketchBoard.title,
            updatedBy: reviewerName,
            notes: sketchBoard.notes,
            nodes: sketchBoard.nodes,
            links: sketchBoard.links,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Sketch save failed (${response.status})`);
      }

      const data = (await response.json()) as SketchBoardResponse;
      setSketchBoard(data.sketchBoard);
      await loadReview(snapshot.workbook.id);
      setSection("sketch");
    } catch (error) {
      setSketchError(error instanceof Error ? error.message : "Failed to save sketch board");
    } finally {
      setIsLoading(false);
      setActiveMutation(null);
    }
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">SpreadbreadAI control room</p>
          <h1>Spreadsheet operations with review, approval, and traceability.</h1>
          <p className="lede">
            Built for teams that run the business in workbooks and want AI assistance
            without giving up human control.
          </p>
        </div>

        <div className="hero-metrics" aria-label="workspace metrics">
          <article>
            <span>Workbook</span>
            <strong>{snapshot.workbook.name}</strong>
          </article>
          <article>
            <span>Proposal</span>
            <strong>{snapshot.proposal.status.replaceAll("_", " ")}</strong>
          </article>
          <article>
            <span>Audit</span>
            <strong>{snapshot.auditEvents.length} events</strong>
          </article>
        </div>
      </header>

      <section className="runtime-strip" aria-label="Runtime status">
        <article className="runtime-main">
          <span>Backend mode</span>
          <strong>{runtimeStatus.backendLabel}</strong>
          <small>
            {runtimeStatus.backendSource === "api"
              ? runtimeStatus.backendUpdatedAt
                ? `Live runtime data, updated ${new Date(
                    runtimeStatus.backendUpdatedAt,
                  ).toLocaleString()}`
                : "Live runtime data from the status API."
              : "Derived from the current workbook review state."}
          </small>
        </article>
        <article>
          <span>Workbooks</span>
          <strong>{runtimeStatus.workbookCount}</strong>
          <small>Persisted review snapshots</small>
        </article>
        <article>
          <span>Versions</span>
          <strong>{runtimeStatus.versionCount}</strong>
          <small>Workbook revisions tracked</small>
        </article>
        <article>
          <span>Audit</span>
          <strong>{runtimeStatus.auditEventCount}</strong>
          <small>Logged approval events</small>
        </article>
        <article>
          <span>Proposal items</span>
          <strong>{runtimeStatus.proposalItemCount}</strong>
          <small>{runtimeStatus.reviewedItemCount} reviewed</small>
        </article>
      </section>

      <section className="spreadsheet-chrome" aria-label="Spreadsheet shell controls">
        <div className="ribbon" role="presentation">
          <div className="ribbon-group">
            <span>Clipboard</span>
            <div className="ribbon-buttons">
              <button type="button">Paste</button>
              <button type="button">Copy</button>
              <button type="button">Fill</button>
            </div>
          </div>
          <div className="ribbon-group">
            <span>Font</span>
            <div className="ribbon-buttons">
              <button type="button">Bold</button>
              <button type="button">Italic</button>
              <button type="button">Color</button>
            </div>
          </div>
          <div className="ribbon-group">
            <span>Review</span>
            <div className="ribbon-buttons">
              <button type="button">Comment</button>
              <button type="button">Track</button>
              <button type="button">Protect</button>
            </div>
          </div>
          <div className="ribbon-meta">
            <span>Autosave</span>
            <strong>On</strong>
          </div>
        </div>

        <div className="formula-bar">
          <div className="name-box" aria-label="Selected cell reference">
            <span>A1</span>
          </div>
          <div className="fx-label" aria-hidden="true">
            fx
          </div>
          <div className="formula-display" aria-label="Formula bar">
            {formulaPreview}
          </div>
        </div>

        <div className="sheet-strip" aria-label="Workbook sheets">
          {snapshot.workbook.sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              className={index === 0 ? "sheet-tab active" : "sheet-tab"}
              type="button"
            >
              <span>{sheet.name}</span>
              <small>{sheet.rows} rows</small>
            </button>
          ))}
          <div className="sheet-strip-meta">
            <span>Current workbook</span>
            <strong>{activeSheet?.name ?? "Sheet 1"}</strong>
          </div>
        </div>
      </section>

      <nav className="section-nav" aria-label="Primary sections">
        {sections.map((item) => (
          <button
            key={item.id}
            className={item.id === section ? "tab active" : "tab"}
            onClick={() => setSection(item.id)}
            type="button"
          >
            <span>{item.label}</span>
            <small>{item.description}</small>
          </button>
        ))}
      </nav>

      <main className="content">
        {section === "workbook" && (
          <>
            <section className="panel grid-two">
              <div>
                <p className="panel-kicker">Workbook Intake</p>
                <h2>Upload a workbook and seed a reviewable AI draft.</h2>
                <p>
                  This first slice uses a shared domain model for workbook metadata,
                  proposal diffs, and audit history. Uploading a file persists a
                  workbook record through the local API.
                </p>
                <label className="upload-control">
                  <span>Upload workbook</span>
                  <input disabled={mutationInFlight} accept=".xlsx,.xls,.csv" onChange={handleUpload} type="file" />
                </label>
                {isLoading ? <p className="status-note">Working on your request...</p> : null}
                {errorMessage ? <p className="status-note status-error">{errorMessage}</p> : null}
              </div>

              <div className="risk-list">
                <article>
                  <span>Version</span>
                  <strong>{snapshot.workbook.latestVersionId}</strong>
                </article>
                <article>
                  <span>Owner</span>
                  <strong>{snapshot.workbook.owner}</strong>
                </article>
                <article>
                  <span>Needs review</span>
                  <strong>{pendingRisks.length} active risks</strong>
                </article>
                <article>
                  <span>Named ranges</span>
                  <strong>{snapshot.workbook.namedRanges.length}</strong>
                </article>
              </div>
            </section>

            <section className="panel grid-two">
              <div>
                <p className="panel-kicker">Workbook Library</p>
                <h2>Switch between persisted review snapshots.</h2>
                <p>
                  Uploaded workbooks are stored locally and exposed back through the
                  review API and MCP read tools.
                </p>
                <div className="library-toolbar">
                  <label>
                    <span>Search</span>
                    <input
                      onChange={(event) => setWorkbookSearchQuery(event.target.value)}
                      placeholder="Search workbook, id, or version"
                      type="search"
                      value={workbookSearchQuery}
                    />
                  </label>
                  <label>
                    <span>Origin</span>
                    <select
                      onChange={(event) =>
                        setWorkbookOriginFilter(event.target.value as WorkbookOriginFilter)
                      }
                      value={workbookOriginFilter}
                    >
                      <option value="all">All</option>
                      <option value="demo">Demo</option>
                      <option value="uploaded">Uploaded</option>
                    </select>
                  </label>
                  <label>
                    <span>Sheets</span>
                    <select
                      onChange={(event) =>
                        setWorkbookSheetFilter(event.target.value as WorkbookSheetFilter)
                      }
                      value={workbookSheetFilter}
                    >
                      <option value="all">Any</option>
                      <option value="single">Single-sheet</option>
                      <option value="multi">Multi-sheet</option>
                    </select>
                  </label>
                </div>
                <p className="library-meta">
                  Showing {filteredWorkbooks.length} of {workbooks.length} workbooks
                </p>
              </div>
              <div className="workbook-list">
                {filteredWorkbooks.length > 0 ? (
                  filteredWorkbooks.map((workbook) => (
                    <button
                      key={workbook.id}
                      className={
                        workbook.id === snapshot.workbook.id
                          ? "workbook-item active"
                          : "workbook-item"
                      }
                      disabled={mutationInFlight}
                      onClick={() => void handleWorkbookSelect(workbook.id)}
                      type="button"
                    >
                    <span>{workbook.name}</span>
                    <strong>{workbook.latestVersionId}</strong>
                    <small>{workbook.sheetCount} sheets</small>
                  </button>
                  ))
                ) : (
                  <article className="empty-state-card">
                    <span>No matching workbooks</span>
                    <strong>Adjust the search or filters</strong>
                    <small>The library filter is hiding all available workbook snapshots.</small>
                  </article>
                )}
              </div>
            </section>

            <section className="panel grid-two">
              <div>
                <p className="panel-kicker">Workbook Review</p>
                <h2>Review the workbook before any write is approved.</h2>
                <p>
                  Sheet structure, formulas, and exception signals are shown together so a
                  reviewer can decide what should happen next.
                </p>
              </div>
              <div className="sheet-list">
                {snapshot.workbook.sheets.map((sheet) => (
                  <article key={sheet.name}>
                    <span>{sheet.name}</span>
                    <strong>
                      {sheet.rows}x{sheet.columns}
                    </strong>
                    <small>
                      {sheet.formulaCells} formula cells, {sheet.populatedCells} populated cells,
                      {" "}
                      {sheet.riskCount} flagged risks
                    </small>
                    {sheet.sampleRows.length > 0 ? (
                      <div className="sample-block">
                        {sheet.sampleRows.map((row, index) => (
                          <code key={`${sheet.name}-${index}`}>{row.join(" | ")}</code>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="panel grid-two">
              <div>
                <p className="panel-kicker">Named Ranges</p>
                <h2>Expose reusable workbook anchors for future agent actions.</h2>
                <p>
                  Named ranges are important future handles for proposals, approvals, and
                  sketch-to-workbook links.
                </p>
              </div>
              <div className="named-range-list">
                {snapshot.workbook.namedRanges.length > 0 ? (
                  snapshot.workbook.namedRanges.map((namedRange) => (
                    <article key={namedRange.name}>
                      <span>{namedRange.name}</span>
                      <strong>{namedRange.reference}</strong>
                      <small>{namedRange.sheetName ?? "Workbook-level range"}</small>
                    </article>
                  ))
                ) : (
                  <article>
                    <span>No named ranges</span>
                    <strong>None detected</strong>
                    <small>This workbook currently exposes no reusable named range anchors.</small>
                  </article>
                )}
              </div>
            </section>

            <section className="panel">
              <p className="panel-kicker">Risk Summary</p>
              <h2>Flag the workbook areas that need human review.</h2>
              <div className="risk-grid">
                {snapshot.workbook.risks.map((risk) => (
                  <article key={risk.id} className="risk-card">
                    <span>{risk.location}</span>
                    <strong>{risk.label}</strong>
                    <small className={`severity severity-${risk.severity}`}>
                      {risk.severity} severity
                    </small>
                    <p>{risk.summary}</p>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {section === "proposal" && (
          <section className="panel proposal-layout">
            <div>
              <p className="panel-kicker">Proposal Review</p>
              <h2>{snapshot.proposal.title}</h2>
              <p>{snapshot.proposal.summary}</p>
              <div className="proposal-meta">
                <article>
                  <span>Status</span>
                  <strong>{snapshot.proposal.status.replaceAll("_", " ")}</strong>
                </article>
                <article>
                  <span>Requested by</span>
                  <strong>{snapshot.proposal.requestedBy}</strong>
                </article>
                <article>
                  <span>Approval</span>
                  <strong>{snapshot.proposal.approvalRequired ? "Required" : "Optional"}</strong>
                </article>
                <article>
                  <span>Actions</span>
                  <strong>{snapshot.proposal.diff.length} proposed review actions</strong>
                </article>
                <article>
                  <span>Approved</span>
                  <strong>{approvedItems.length}</strong>
                </article>
                <article>
                  <span>Pending</span>
                  <strong>{pendingItems.length}</strong>
                </article>
                <article>
                  <span>Rejected</span>
                  <strong>{rejectedItems.length}</strong>
                </article>
              </div>
              <p className="workflow-note">{workflowStatusMessage}</p>
              <div className="review-form">
                <label>
                  <span>Reviewer</span>
                  <input
                    onChange={(event) => setReviewerName(event.target.value)}
                    type="text"
                    value={reviewerName}
                  />
                </label>
                <label>
                  <span>Decision comment</span>
                  <textarea
                    onChange={(event) => setReviewComment(event.target.value)}
                    rows={3}
                    value={reviewComment}
                  />
                </label>
                <div className="action-row">
                  <button
                    className="decision-button approve"
                    disabled={!canUseProposalShortcut}
                    onClick={() => void handleProposalDecision("approve")}
                    type="button"
                  >
                    Approve Proposal
                  </button>
                  <button
                    className="decision-button reject"
                    disabled={!canUseProposalShortcut}
                    onClick={() => void handleProposalDecision("reject")}
                    type="button"
                  >
                    Reject Proposal
                  </button>
                  <button
                    className="decision-button apply"
                    disabled={!canApplyApprovedItems}
                    onClick={() => void handleApplyApprovedItems()}
                    type="button"
                  >
                    Apply Approved Items
                  </button>
                </div>
                {snapshot.proposal.reviewer ? (
                  <p className="review-meta">
                    Reviewed by {snapshot.proposal.reviewer}
                    {snapshot.proposal.reviewedAt
                      ? ` at ${new Date(snapshot.proposal.reviewedAt).toLocaleString()}`
                      : ""}
                    {snapshot.proposal.reviewComment
                      ? `: ${snapshot.proposal.reviewComment}`
                      : ""}
                  </p>
                ) : null}
              </div>
              <div className="comment-filter-panel">
                <div className="comment-filter-head">
                  <div>
                    <span>Comment threads</span>
                    <strong>Filter reviewer notes and mentions</strong>
                  </div>
                  <small>Your mention handle: {reviewerHandle}</small>
                </div>
                <div className="comment-filter-controls">
                  <label>
                    <span>Search comments</span>
                    <input
                      onChange={(event) => setCommentSearchQuery(event.target.value)}
                      placeholder="Search author, text, or cell"
                      type="search"
                      value={commentSearchQuery}
                    />
                  </label>
                  <label>
                    <span>Thread view</span>
                    <select
                      onChange={(event) =>
                        setCommentFilterMode(event.target.value as CommentFilterMode)
                      }
                      value={commentFilterMode}
                    >
                      <option value="all">All items</option>
                      <option value="with-comments">With comments</option>
                      <option value="mine">My comments</option>
                      <option value="mentions">Mentions of me</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
            <div className="diff-card">
              {filteredProposalEntries.length > 0 ? (
                filteredProposalEntries.map(({ entry, visibleComments }) => (
                  <article key={entry.id} className="diff-entry">
                  {(() => {
                    const comments = visibleComments;
                    const commentState = getItemCommentState(entry.id);
                    const commentDraft = getItemCommentDraft(entry.id);
                    const mentionCandidates = Array.from(
                      new Set(comments.flatMap((comment) => extractMentions(comment.body))),
                    );

                    return (
                      <>
                        <div className="diff-header">
                          <span>{entry.cell}</span>
                          <small>{entry.kind}</small>
                        </div>
                        <div className="item-status-row">
                          <span className={`item-status status-${entry.status}`}>
                            {itemStatusLabel(entry.status)}
                          </span>
                          <div className="item-action-row">
                            <button
                              className="mini-button approve"
                              disabled={!canReviewItem(entry)}
                              onClick={() => void handleProposalItemDecision(entry.id, "approve")}
                              type="button"
                            >
                              Approve Item
                            </button>
                            <button
                              className="mini-button reject"
                              disabled={!canReviewItem(entry)}
                              onClick={() => void handleProposalItemDecision(entry.id, "reject")}
                              type="button"
                            >
                              Reject Item
                            </button>
                          </div>
                        </div>
                        {entry.before ? (
                          <div className={`diff-row ${diffClassName(entry.kind)}`}>- {entry.before}</div>
                        ) : null}
                        {entry.after ? (
                          <div className={`diff-row ${diffClassName(entry.kind)}`}>
                            {entry.kind === "comment" ? entry.after : `+ ${entry.after}`}
                          </div>
                        ) : null}
                        <div className="diff-row neutral">{entry.rationale}</div>
                        {entry.reviewer ? (
                          <div className="item-meta">
                            {entry.reviewer}
                            {entry.reviewedAt
                              ? ` at ${new Date(entry.reviewedAt).toLocaleString()}`
                              : ""}
                            {entry.reviewComment ? `: ${entry.reviewComment}` : ""}
                          </div>
                        ) : null}
                        <div className="item-comments">
                          <div className="item-comments-head">
                            <span>Comments</span>
                            <small>{comments.length} visible notes</small>
                          </div>
                          {mentionCandidates.length > 0 ? (
                            <div className="mention-row">
                              {mentionCandidates.map((mention) => (
                                <span
                                  key={mention}
                                  className={
                                    mention === reviewerHandle.toLowerCase()
                                      ? "mention-chip mention-chip-active"
                                      : "mention-chip"
                                  }
                                >
                                  {mention}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {comments.length > 0 ? (
                            <div className="comment-thread">
                              {comments.map((comment: ProposalItemComment) => (
                                <article key={comment.id} className="comment-entry">
                                  <div className="comment-entry-head">
                                    <strong>{comment.author}</strong>
                                  </div>
                                  <p>{renderCommentBody(comment.body)}</p>
                                  <small>{new Date(comment.createdAt).toLocaleString()}</small>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="comment-empty">
                              No comments yet. Add a note for this review item.
                            </p>
                          )}
                          <div className="comment-composer">
                            <textarea
                              aria-label={`Add comment for ${entry.cell}`}
                              disabled={!canCommentOnItem(entry)}
                              onChange={(event) =>
                                setItemCommentDraft(entry.id, event.target.value)
                              }
                              placeholder="Add a short note for this item..."
                              rows={2}
                              value={commentDraft}
                            />
                            <div className="comment-composer-row">
                              <button
                                className="mini-button comment"
                                disabled={
                                  !canCommentOnItem(entry) ||
                                  commentDraft.trim().length === 0
                                }
                                onClick={() => void handleProposalItemComment(entry.id)}
                                type="button"
                              >
                                {commentState.submitting ? "Saving..." : "Add comment"}
                              </button>
                              <small>Use handles like {reviewerHandle}</small>
                            </div>
                          </div>
                          {commentState.error ? (
                            <p className="comment-error">{commentState.error}</p>
                          ) : null}
                        </div>
                      </>
                    );
                  })()}
                  </article>
                ))
              ) : (
                <article className="empty-state-card">
                  <span>No matching threads</span>
                  <strong>Change the comment filters</strong>
                  <small>No proposal item comments match the current search or mention view.</small>
                </article>
              )}
            </div>
          </section>
        )}

        {section === "audit" && (
          <section className="panel">
            <p className="panel-kicker">Audit Trail</p>
            <h2>Every action is logged with version and approval context.</h2>
            <div className="timeline">
              {snapshot.auditEvents.map((event) => (
                <article key={event.id}>
                  <span>{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <p>
                    <strong>{event.action}</strong>
                    <br />
                    {event.detail}
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "sketch" && (
          <section className="panel sketch-panel">
            <div>
              <p className="panel-kicker">Sketchpad</p>
              <h2>Persist a workbook planning board with linked review nodes.</h2>
              <p>
                This board now saves through the backend per workbook. Use it to map
                sheet flow, approval checkpoints, and operating notes while keeping the
                spreadsheet review context visible.
              </p>
              <div className="link-list">
                <article>
                  <span>Linked workbook</span>
                  <strong>{snapshot.workbook.name}</strong>
                </article>
                <article>
                  <span>Linked proposal</span>
                  <strong>{snapshot.proposal.id}</strong>
                </article>
              </div>
              <div className="sketch-controls">
                <label>
                  <span>Board title</span>
                  <input
                    onChange={(event) =>
                      updateSketchBoard((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    type="text"
                    value={sketchBoard.title}
                  />
                </label>
                <label>
                  <span>Board notes</span>
                  <textarea
                    onChange={(event) =>
                      updateSketchBoard((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    rows={4}
                    value={sketchBoard.notes ?? ""}
                  />
                </label>
                <div className="action-row">
                  <button
                    className="decision-button approve"
                    onClick={() =>
                      addSketchNodeFromLabel(
                        snapshot.workbook.sheets[0]?.name ?? "Workbook Node",
                        "#217346",
                      )
                    }
                    type="button"
                  >
                    Add Sheet Node
                  </button>
                  <button
                    className="decision-button apply"
                    onClick={() => addSketchNodeFromLabel("Approval", "#6dbb75")}
                    type="button"
                  >
                    Add Approval Node
                  </button>
                  <button
                    className="decision-button apply"
                    disabled={mutationInFlight}
                    onClick={() => void handleSketchSave()}
                    type="button"
                  >
                    Save Board
                  </button>
                </div>
                {sketchError ? <p className="comment-error">{sketchError}</p> : null}
                <p className="review-meta">
                  Updated by {sketchBoard.updatedBy} at{" "}
                  {new Date(sketchBoard.updatedAt).toLocaleString()}
                </p>
              </div>
            </div>
            <div className="sketch-workspace">
              <div className="sketch-canvas persisted" aria-label="Workbook sketch board">
                {sketchBoard.links.map((link) => (
                  <div key={link.id} className="sketch-link-chip">
                    {link.fromNodeId} to {link.toNodeId}
                  </div>
                ))}
                {sketchBoard.nodes.map((node) => (
                  <div
                    key={node.id}
                    className="sketch-node-card"
                    style={{
                      left: `${node.x}px`,
                      top: `${node.y}px`,
                      width: `${node.width}px`,
                      minHeight: `${node.height}px`,
                      borderColor: node.color ?? "#217346",
                    }}
                  >
                    <strong>{node.label}</strong>
                    <small>{node.linkKind ?? "free node"}</small>
                    {node.linkTargetId ? <span>{node.linkTargetId}</span> : null}
                  </div>
                ))}
              </div>
              <div className="sketch-node-list">
                {sketchBoard.nodes.map((node, index) => (
                  <article key={node.id}>
                    <strong>Node {index + 1}</strong>
                    <label>
                      <span>Label</span>
                      <input
                        onChange={(event) =>
                          updateSketchBoard((current) => ({
                            ...current,
                            nodes: current.nodes.map((item) =>
                              item.id === node.id
                                ? {
                                    ...item,
                                    label: event.target.value,
                                  }
                                : item,
                            ),
                          }))
                        }
                        type="text"
                        value={node.label}
                      />
                    </label>
                    <label>
                      <span>X / Y</span>
                      <input
                        onChange={(event) => {
                          const value = Number.parseInt(event.target.value || "0", 10);
                          updateSketchBoard((current) => ({
                            ...current,
                            nodes: current.nodes.map((item) =>
                              item.id === node.id
                                ? {
                                    ...item,
                                    x: Number.isNaN(value) ? item.x : value,
                                  }
                                : item,
                            ),
                          }));
                        }}
                        type="number"
                        value={node.x}
                      />
                      <input
                        onChange={(event) => {
                          const value = Number.parseInt(event.target.value || "0", 10);
                          updateSketchBoard((current) => ({
                            ...current,
                            nodes: current.nodes.map((item) =>
                              item.id === node.id
                                ? {
                                    ...item,
                                    y: Number.isNaN(value) ? item.y : value,
                                  }
                                : item,
                            ),
                          }));
                        }}
                        type="number"
                        value={node.y}
                      />
                    </label>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {(section === "workbook" || section === "proposal") && (
          <section className="panel">
            <p className="panel-kicker">Workbook Versions</p>
            <h2>Track the version history created by uploads and apply actions.</h2>
            <div className="version-list">
              {snapshot.workbook.versions.map((version) => (
                <article key={version.id}>
                  <span>{version.id}</span>
                  <strong>{version.note}</strong>
                  <small>
                    {version.createdBy} at {new Date(version.createdAt).toLocaleString()}
                  </small>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
