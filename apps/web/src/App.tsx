import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  type ApprovalDecision,
  createSeededSketchBoard,
  demoReviewSnapshot,
  type ProposalDiffEntry,
  type ProposalItemComment,
  type ReviewerProfile,
  type ReviewerSession,
  type WorkbookLibraryView,
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
  | "view-archive"
  | "view-delete"
  | "view-save"
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

type WorkbookTagsResponse = {
  workbookId: string;
  tags: string[];
};

type WorkbookLibraryViewsResponse = {
  views: WorkbookLibraryView[];
};

type ReviewerProfilesResponse = {
  reviewers: ReviewerProfile[];
};

type ReviewerSessionResponse = {
  session: ReviewerSession | null;
};

type ReviewerIdentity = {
  id: string;
  displayName: string;
  handle: string;
  role?: string;
  source: "api" | "derived";
};

type ReviewerDirectoryResponse = {
  reviewers?: ReviewerProfile[];
};

type ReviewNotificationFeedItem = {
  id: string;
  label: string;
  detail: string;
  createdAt: string;
  readAt: string | null;
  source: "api" | "derived";
  entryId?: string;
};

type ReviewNotificationFeedResponse = {
  reviewer?: string;
  unreadCount?: number;
  notifications?: ReviewNotificationFeedItem[];
  notification?: ReviewNotificationFeedItem;
};

type LibraryViewDeletionResponse = {
  deletedId: string;
};

type WorkbookOriginFilter = "all" | "demo" | "uploaded";
type WorkbookSheetFilter = "all" | "single" | "multi";
type CommentFilterMode = "all" | "with-comments" | "mine" | "mentions" | "replies";

type ReplyTarget = {
  commentId: string;
  author: string;
  handle: string;
};

type DragState = {
  nodeId: string;
  offsetX: number;
  offsetY: number;
};

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
    tags: demoReviewSnapshot.workbook.tags,
  };
}

function snapshotToWorkbookSummary(snapshot: WorkbookReviewSnapshot): WorkbookSummary {
  return {
    id: snapshot.workbook.id,
    name: snapshot.workbook.name,
    latestVersionId: snapshot.workbook.latestVersionId,
    sheetCount: snapshot.workbook.sheetCount,
    createdAt: snapshot.workbook.createdAt,
    tags: snapshot.workbook.tags,
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

function buildDerivedReviewNotificationFeed(
  snapshot: WorkbookReviewSnapshot,
  reviewerHandle: string,
  reviewerName: string,
) {
  const reviewerToken = reviewerHandle.replace(/^@/, "").toLowerCase();
  const reviewerNameNormalized = reviewerName.trim().toLowerCase();

  return snapshot.proposal.diff.flatMap((entry) =>
    (entry.comments ?? []).flatMap((comment) => {
      const notifications: ReviewNotificationFeedItem[] = [];
      const repliedToComment = comment.replyToCommentId
        ? (entry.comments ?? []).find((candidate) => candidate.id === comment.replyToCommentId)
        : undefined;
      const mentionsReviewer = (comment.mentions ?? []).some(
        (mention) => mention.toLowerCase() === reviewerToken,
      );

      if (mentionsReviewer) {
        notifications.push({
          id: `${comment.id}_mention`,
          label: "Mention",
          detail: `${comment.author} mentioned ${reviewerHandle} on ${entry.cell}.`,
          createdAt: comment.createdAt,
          readAt: null,
          source: "derived",
          entryId: entry.id,
        });
      }

      if (
        repliedToComment &&
        repliedToComment.author.trim().toLowerCase() === reviewerNameNormalized &&
        comment.author.trim().toLowerCase() !== reviewerNameNormalized
      ) {
        notifications.push({
          id: `${comment.id}_reply`,
          label: "Reply",
          detail: `${comment.author} replied in the review thread for ${entry.cell}.`,
          createdAt: comment.createdAt,
          readAt: null,
          source: "derived",
          entryId: entry.id,
        });
      }

      return notifications;
    }),
  );
}

function normalizeReviewNotificationFeed(value: unknown): ReviewNotificationFeedItem[] {
  const sourceFeed = Array.isArray(value)
    ? value
    : Array.isArray((value as ReviewNotificationFeedResponse | null)?.notifications)
      ? (value as ReviewNotificationFeedResponse).notifications ?? []
      : [];

  return sourceFeed
    .map((item, index) => {
      const notification = item as Partial<ReviewNotificationFeedItem> & {
        title?: unknown;
        body?: unknown;
        proposalItemId?: unknown;
        readAt?: unknown;
      };
      const label =
        typeof notification.label === "string" && notification.label.length > 0
          ? notification.label
          : typeof notification.title === "string" && notification.title.length > 0
            ? notification.title
            : "Notification";
      const detail =
        typeof notification.detail === "string"
          ? notification.detail
          : typeof notification.body === "string"
            ? notification.body
            : "";

      return {
        id: typeof notification.id === "string" && notification.id.length > 0
          ? notification.id
          : `notification_${index}`,
        label,
        detail,
        createdAt:
          typeof notification.createdAt === "string" && notification.createdAt.length > 0
            ? notification.createdAt
            : new Date().toISOString(),
        readAt:
          typeof notification.readAt === "string" && notification.readAt.length > 0
            ? notification.readAt
            : null,
        source: "api",
        entryId:
          typeof notification.entryId === "string"
            ? notification.entryId
            : typeof notification.proposalItemId === "string"
              ? notification.proposalItemId
              : undefined,
      } satisfies ReviewNotificationFeedItem;
    })
    .filter((item) => item.detail.length > 0);
}

function normalizeReviewerDirectory(value: unknown): ReviewerIdentity[] {
  const sourceEntries = Array.isArray(value)
    ? value
    : Array.isArray((value as ReviewerDirectoryResponse | null)?.reviewers)
      ? (value as ReviewerDirectoryResponse).reviewers ?? []
      : value && typeof value === "object"
        ? [value as Partial<ReviewerIdentity>]
      : [];

  return sourceEntries
    .map((item, index) => {
      const reviewer = item as Partial<ReviewerIdentity> & {
        name?: unknown;
        display_name?: unknown;
        fullName?: unknown;
        source?: unknown;
      };

      const displayName =
        typeof reviewer.displayName === "string" && reviewer.displayName.length > 0
          ? reviewer.displayName
          : typeof reviewer.name === "string" && reviewer.name.length > 0
            ? reviewer.name
            : typeof reviewer.fullName === "string" && reviewer.fullName.length > 0
              ? reviewer.fullName
              : `Reviewer ${index + 1}`;
      const handle =
        typeof reviewer.handle === "string" && reviewer.handle.length > 0
          ? reviewer.handle
          : normalizeHandle(displayName) || `reviewer_${index + 1}`;

      return {
        id:
          typeof reviewer.id === "string" && reviewer.id.length > 0
            ? reviewer.id
            : handle,
        displayName,
        handle,
        role: typeof reviewer.role === "string" ? reviewer.role : undefined,
        source: reviewer.source === "api" ? "api" : "derived",
      } satisfies ReviewerIdentity;
    })
    .filter((item) => item.displayName.length > 0);
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

const fallbackReviewerDirectory: ReviewerIdentity[] = [
  {
    id: "finance-manager",
    displayName: "Finance Manager",
    handle: "finance.manager",
    role: "Finance",
    source: "derived",
  },
  {
    id: "fpa-lead",
    displayName: "FP&A Lead",
    handle: "fpa.lead",
    role: "Finance",
    source: "derived",
  },
  {
    id: "operations-reviewer",
    displayName: "Operations Reviewer",
    handle: "operations.reviewer",
    role: "Operations",
    source: "derived",
  },
];

function App() {
  const [section, setSection] = useState<Section>("workbook");
  const [snapshot, setSnapshot] = useState<WorkbookReviewSnapshot>(demoReviewSnapshot);
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[]>([
    createDemoWorkbookSummary(),
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeMutation, setActiveMutation] = useState<MutationAction | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reviewerDirectory, setReviewerDirectory] = useState<ReviewerIdentity[]>(
    fallbackReviewerDirectory,
  );
  const [selectedReviewerId, setSelectedReviewerId] = useState(
    fallbackReviewerDirectory[0].id,
  );
  const [reviewerIdentityMode, setReviewerIdentityMode] = useState<"api" | "derived">(
    "derived",
  );
  const [reviewerIdentityError, setReviewerIdentityError] = useState<string | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [runtimeBackend, setRuntimeBackend] = useState<RuntimeBackendInfo>(
    createDerivedRuntimeInfo([createDemoWorkbookSummary()], demoReviewSnapshot),
  );
  const [workbookSearchQuery, setWorkbookSearchQuery] = useState("");
  const [workbookOriginFilter, setWorkbookOriginFilter] =
    useState<WorkbookOriginFilter>("all");
  const [workbookSheetFilter, setWorkbookSheetFilter] =
    useState<WorkbookSheetFilter>("all");
  const [workbookTagFilter, setWorkbookTagFilter] = useState("all");
  const [workbookTagDraft, setWorkbookTagDraft] = useState("");
  const [savedWorkbookViews, setSavedWorkbookViews] = useState<WorkbookLibraryView[]>([]);
  const [savedViewName, setSavedViewName] = useState("");
  const [showArchivedViews, setShowArchivedViews] = useState(false);
  const [commentSearchQuery, setCommentSearchQuery] = useState("");
  const [commentFilterMode, setCommentFilterMode] =
    useState<CommentFilterMode>("all");
  const [itemCommentDrafts, setItemCommentDrafts] = useState<Record<string, string>>({});
  const [itemCommentState, setItemCommentState] = useState<Record<string, ItemCommentState>>({});
  const [replyTargetByEntry, setReplyTargetByEntry] = useState<Record<string, ReplyTarget | null>>({});
  const [reviewNotificationFeed, setReviewNotificationFeed] = useState<
    ReviewNotificationFeedItem[]
  >([]);
  const [reviewNotificationFeedMode, setReviewNotificationFeedMode] = useState<
    "api" | "derived"
  >("derived");
  const [reviewNotificationFeedError, setReviewNotificationFeedError] = useState<string | null>(
    null,
  );
  const [sketchBoard, setSketchBoard] = useState<WorkbookSketchBoard>(
    createSeededSketchBoard(demoReviewSnapshot, "system"),
  );
  const [selectedSketchLinkId, setSelectedSketchLinkId] = useState<string | null>(null);
  const [sketchError, setSketchError] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const sketchCanvasRef = useRef<HTMLDivElement | null>(null);

  const activeReviewer = useMemo(
    () =>
      reviewerDirectory.find((reviewer) => reviewer.id === selectedReviewerId) ??
      reviewerDirectory[0] ??
      fallbackReviewerDirectory[0],
    [reviewerDirectory, selectedReviewerId],
  );
  const reviewerName = activeReviewer.displayName;
  const reviewerHandle = mentionHandleForReviewer(activeReviewer.handle || reviewerName);

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

      if (
        workbookTagFilter !== "all" &&
        !workbook.tags.includes(workbookTagFilter)
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [workbook.name, workbook.id, workbook.latestVersionId].some((field) =>
        field.toLowerCase().includes(query),
      );
    });
  }, [
    workbookOriginFilter,
    workbookSearchQuery,
    workbookSheetFilter,
    workbookTagFilter,
    workbooks,
  ]);
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
            case "replies":
              return Boolean(comment.parentCommentId);
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
      sketchBoard.nodes.map((node) => ({
        id: node.id,
        label: node.label,
      })),
    [sketchBoard.nodes],
  );
  const availableTags = useMemo(
    () =>
      Array.from(
        new Set(workbooks.flatMap((workbook) => workbook.tags)),
      ).sort((left, right) => left.localeCompare(right)),
    [workbooks],
  );
  const reviewNotifications = reviewNotificationFeed;
  const unreadNotificationCount = useMemo(
    () => reviewNotifications.filter((notification) => !notification.readAt).length,
    [reviewNotifications],
  );
  const sketchNodeMap = useMemo(
    () => new Map(sketchBoard.nodes.map((node) => [node.id, node])),
    [sketchBoard.nodes],
  );
  const selectedSketchLink = useMemo(
    () => sketchBoard.links.find((link) => link.id === selectedSketchLinkId) ?? null,
    [selectedSketchLinkId, sketchBoard.links],
  );

  useEffect(() => {
    void loadReviewerNotificationFeed();
  }, [reviewerHandle, reviewerName, snapshot.proposal.diff, snapshot.workbook.id]);

  useEffect(() => {
    if (selectedSketchLinkId && !selectedSketchLink) {
      setSelectedSketchLinkId(null);
    }
  }, [selectedSketchLink, selectedSketchLinkId]);

  function getReplyTarget(entryId: string) {
    return replyTargetByEntry[entryId] ?? null;
  }

  function setReplyTarget(entryId: string, target: ReplyTarget | null) {
    setReplyTargetByEntry((current) => ({
      ...current,
      [entryId]: target,
    }));
  }

  function updateReviewNotificationFeed(
    updater: (current: ReviewNotificationFeedItem[]) => ReviewNotificationFeedItem[],
  ) {
    setReviewNotificationFeed((current) => updater(current));
  }

  async function persistReviewNotificationReadState(
    notificationId: string,
    read: boolean,
  ) {
    const reviewerId = reviewerHandle.replace(/^@/, "");
    const url = `/api/reviewer-notifications/${encodeURIComponent(notificationId)}/${read ? "read" : "unread"}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reviewer: reviewerId,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as ReviewNotificationFeedResponse;
        const notifications = normalizeReviewNotificationFeed(
          data.notification ? [data.notification] : data.notifications ?? data,
        );

        if (notifications.length > 0) {
          setReviewNotificationFeed((current) =>
            current.map((notification) =>
              notification.id === notificationId ? notifications[0] : notification,
            ),
          );
        }
        setReviewNotificationFeedMode("api");
        setReviewNotificationFeedError(null);
      } else if (response.status !== 404) {
        throw new Error(`Notification update failed (${response.status})`);
      }
    } catch (error) {
      if (error instanceof Error) {
        setReviewNotificationFeedError(error.message);
      }
    }
  }

  function markNotificationRead(notificationId: string, read = true) {
    updateReviewNotificationFeed((current) =>
      current.map((notification) =>
        notification.id === notificationId
          ? {
              ...notification,
              readAt: read ? notification.readAt ?? new Date().toISOString() : null,
            }
          : notification,
      ),
    );

    void persistReviewNotificationReadState(notificationId, read);
  }

  function markAllNotificationsRead() {
    updateReviewNotificationFeed((current) =>
      current.map((notification) => ({
        ...notification,
        readAt: notification.readAt ?? new Date().toISOString(),
      })),
    );

    void Promise.all(
      reviewNotifications
        .filter((notification) => !notification.readAt)
        .map((notification) => persistReviewNotificationReadState(notification.id, true)),
    ).catch((error) => {
      if (error instanceof Error) {
        setReviewNotificationFeedError(error.message);
      }
    });
  }

  function getVisibleThreadComments(
    comments: ProposalItemComment[],
    visibleComments: ProposalItemComment[],
  ) {
    const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
    const ids = new Set(visibleComments.map((comment) => comment.id));

    for (const comment of visibleComments) {
      let currentParentId = comment.parentCommentId;

      while (currentParentId) {
        ids.add(currentParentId);
        currentParentId = commentsById.get(currentParentId)?.parentCommentId;
      }
    }

    return comments.filter((comment) => ids.has(comment.id));
  }

  function getChildComments(
    comments: ProposalItemComment[],
    parentCommentId?: string,
  ) {
    return comments
      .filter((comment) =>
        parentCommentId ? comment.parentCommentId === parentCommentId : !comment.parentCommentId,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  function startReply(entryId: string, comment: ProposalItemComment) {
    const handle = mentionHandleForReviewer(comment.author);
    const currentDraft = getItemCommentDraft(entryId);
    const nextDraft = currentDraft.trim().length > 0 ? currentDraft : `${handle} `;

    setReplyTarget(entryId, {
      commentId: comment.id,
      author: comment.author,
      handle,
    });
    setItemCommentDraft(entryId, nextDraft);
  }

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

  function updateSketchLink(
    linkId: string,
    updater: (link: WorkbookSketchBoard["links"][number]) => WorkbookSketchBoard["links"][number],
  ) {
    updateSketchBoard((current) => ({
      ...current,
      links: current.links.map((link) => (link.id === linkId ? updater(link) : link)),
      updatedBy: reviewerName,
      updatedAt: new Date().toISOString(),
    }));
  }

  function addSketchLink() {
    const fromNodeId = sketchBoard.nodes[0]?.id;
    const toNodeId = sketchBoard.nodes[1]?.id ?? sketchBoard.nodes[0]?.id;

    if (!fromNodeId || !toNodeId) {
      return;
    }

    const newLinkId = `${snapshot.workbook.id}_link_${Date.now().toString(36)}`;

    updateSketchBoard((current) => ({
      ...current,
      links: [
        ...current.links,
        {
          id: newLinkId,
          fromNodeId,
          toNodeId,
          label: "Review flow",
        },
      ],
      updatedBy: reviewerName,
      updatedAt: new Date().toISOString(),
    }));
    setSelectedSketchLinkId(newLinkId);
  }

  function removeSketchLink(linkId: string) {
    updateSketchBoard((current) => ({
      ...current,
      links: current.links.filter((link) => link.id !== linkId),
      updatedBy: reviewerName,
      updatedAt: new Date().toISOString(),
    }));

    if (selectedSketchLinkId === linkId) {
      setSelectedSketchLinkId(null);
    }
  }

  async function addTagToActiveWorkbook() {
    const normalized = workbookTagDraft.trim().toLowerCase();

    if (!normalized) {
      return;
    }

    const nextTags = Array.from(new Set([...(snapshot.workbook.tags ?? []), normalized]));

    try {
      const response = await fetch(
        `/api/workbooks/${encodeURIComponent(snapshot.workbook.id)}/tags`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            updatedBy: reviewerName,
            tags: nextTags,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Tag update failed (${response.status})`);
      }

      const data = (await response.json()) as { tags: string[] };
      setWorkbooks((current) =>
        current.map((workbook) =>
          workbook.id === snapshot.workbook.id ? { ...workbook, tags: data.tags } : workbook,
        ),
      );
      setSnapshot((current) => ({
        ...current,
        workbook: {
          ...current.workbook,
          tags: data.tags,
        },
      }));
      setWorkbookTagDraft("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update tags");
    }
  }

  async function saveCurrentWorkbookView() {
    const trimmedName = savedViewName.trim();

    if (!trimmedName) {
      return;
    }

    try {
      setActiveMutation("view-save");
      const viewId = normalizeHandle(trimmedName) || `view_${Date.now().toString(36)}`;
      const response = await fetch(`/api/library/views/${encodeURIComponent(viewId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: trimmedName,
          updatedBy: reviewerName,
          description: "Saved from the workbook library filters.",
          searchQuery: workbookSearchQuery,
          tags: workbookTagFilter === "all" ? [] : [workbookTagFilter],
          sortBy: "lastReviewedAt",
          sortDirection: "desc",
          pinned: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Saved view update failed (${response.status})`);
      }

      const data = (await response.json()) as { view: WorkbookLibraryView };
      setSavedWorkbookViews((current) => [
        data.view,
        ...current.filter((item) => item.id !== data.view.id),
      ]);
      setSavedViewName("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save workbook view");
    } finally {
      setActiveMutation(null);
    }
  }

  function applySavedWorkbookView(view: WorkbookLibraryView) {
    setWorkbookSearchQuery(view.searchQuery ?? "");
    setWorkbookOriginFilter("all");
    setWorkbookSheetFilter("all");
    setWorkbookTagFilter(view.tags[0] ?? "all");
  }

  async function archiveSavedWorkbookView(viewId: string) {
    if (mutationInFlight) {
      return;
    }

    try {
      setActiveMutation("view-archive");
      setErrorMessage(null);
      const response = await fetch(`/api/library/views/${encodeURIComponent(viewId)}/archive`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          archivedBy: reviewerName,
        }),
      });

      if (!response.ok) {
        throw new Error(`Saved view archive failed (${response.status})`);
      }

      const data = (await response.json()) as { view: WorkbookLibraryView };
      setSavedWorkbookViews((current) =>
        current
          .filter((view) => view.id !== viewId)
          .concat(showArchivedViews ? [data.view] : []),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to archive workbook view");
    } finally {
      setActiveMutation(null);
    }
  }

  async function deleteSavedWorkbookView(viewId: string) {
    if (mutationInFlight) {
      return;
    }

    try {
      setActiveMutation("view-delete");
      setErrorMessage(null);
      const response = await fetch(`/api/library/views/${encodeURIComponent(viewId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Saved view delete failed (${response.status})`);
      }

      const data = (await response.json()) as LibraryViewDeletionResponse;
      setSavedWorkbookViews((current) => current.filter((view) => view.id !== data.deletedId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete workbook view");
    } finally {
      setActiveMutation(null);
    }
  }

  async function removeTagFromWorkbook(workbookId: string, tag: string) {
    const workbook = workbooks.find((entry) => entry.id === workbookId);
    const nextTags = (workbook?.tags ?? []).filter((item) => item !== tag);

    try {
      const response = await fetch(`/api/workbooks/${encodeURIComponent(workbookId)}/tags`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          updatedBy: reviewerName,
          tags: nextTags,
        }),
      });

      if (!response.ok) {
        throw new Error(`Tag removal failed (${response.status})`);
      }

      const data = (await response.json()) as { tags: string[] };
      setWorkbooks((current) =>
        current.map((entry) => (entry.id === workbookId ? { ...entry, tags: data.tags } : entry)),
      );
      if (snapshot.workbook.id === workbookId) {
        setSnapshot((current) => ({
          ...current,
          workbook: {
            ...current.workbook,
            tags: data.tags,
          },
        }));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to remove tag");
    }
  }

  function startNodeDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    nodeId: string,
  ) {
    if (mutationInFlight) {
      return;
    }

    const canvasRect = sketchCanvasRef.current?.getBoundingClientRect();
    const node = sketchBoard.nodes.find((item) => item.id === nodeId);

    if (!canvasRect || !node) {
      return;
    }

    event.preventDefault();
    setDragState({
      nodeId,
      offsetX: event.clientX - canvasRect.left - node.x,
      offsetY: event.clientY - canvasRect.top - node.y,
    });
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

  async function loadLibraryViews(includeArchived = showArchivedViews) {
    const response = await fetch(
      includeArchived ? "/api/library/views?includeArchived=true" : "/api/library/views",
    );

    if (!response.ok) {
      throw new Error(`Failed to load library views (${response.status})`);
    }

    const data = (await response.json()) as WorkbookLibraryViewsResponse;
    setSavedWorkbookViews(data.views);
  }

  useEffect(() => {
    void loadWorkbooks({ allowDemoFallback: true });
  }, []);

  useEffect(() => {
    void loadRuntimeStatus();
  }, []);

  useEffect(() => {
    void loadReviewerDirectory();
  }, []);

  useEffect(() => {
    void loadLibraryViews(showArchivedViews).catch(() => undefined);
  }, [showArchivedViews]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const activeDrag = dragState;

    function handlePointerMove(event: PointerEvent) {
      const canvasRect = sketchCanvasRef.current?.getBoundingClientRect();

      if (!canvasRect) {
        return;
      }

      updateSketchBoard((current) => ({
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id !== activeDrag.nodeId) {
            return node;
          }

          const maxX = Math.max(0, canvasRect.width - node.width);
          const maxY = Math.max(0, canvasRect.height - node.height);
          const nextX = Math.min(
            maxX,
            Math.max(0, Math.round(event.clientX - canvasRect.left - activeDrag.offsetX)),
          );
          const nextY = Math.min(
            maxY,
            Math.max(0, Math.round(event.clientY - canvasRect.top - activeDrag.offsetY)),
          );

          return {
            ...node,
            x: nextX,
            y: nextY,
          };
        }),
        updatedBy: reviewerName,
        updatedAt: new Date().toISOString(),
      }));
    }

    function handlePointerUp() {
      setDragState(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState, reviewerName]);

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

  async function loadReviewerDirectory() {
    setReviewerIdentityError(null);

    try {
      const [reviewersResponse, sessionResponse] = await Promise.all([
        fetch("/api/reviewers"),
        fetch("/api/session/reviewer"),
      ]);

      if (!reviewersResponse.ok) {
        throw new Error(`Reviewer directory failed (${reviewersResponse.status})`);
      }

      const reviewersData = (await reviewersResponse.json()) as ReviewerDirectoryResponse;
      const sessionData = sessionResponse.ok
        ? ((await sessionResponse.json()) as ReviewerSessionResponse)
        : { session: null };
      const reviewers = normalizeReviewerDirectory(reviewersData.reviewers ?? []);

      if (reviewers.length > 0) {
        const activeId =
          sessionData.session?.currentProfile?.id ?? reviewers[0].id;

        setReviewerDirectory(reviewers);
        setSelectedReviewerId(
          reviewers.some((reviewer) => reviewer.id === activeId)
            ? activeId
            : reviewers[0].id,
        );
        setReviewerIdentityMode("api");
        return;
      }
    } catch (error) {
      if (error instanceof Error) {
        setReviewerIdentityError(error.message);
      }
    }

    setReviewerDirectory(fallbackReviewerDirectory);
    setSelectedReviewerId((current) =>
      fallbackReviewerDirectory.some((reviewer) => reviewer.id === current)
        ? current
        : fallbackReviewerDirectory[0].id,
    );
    setReviewerIdentityMode("derived");
  }

  async function loadReviewerNotificationFeed() {
    const reviewerId = reviewerHandle.replace(/^@/, "");
    const endpoint = `/api/reviewer-notifications?reviewer=${encodeURIComponent(reviewerId)}&includeRead=true`;

    setReviewNotificationFeedError(null);

    try {
      const response = await fetch(endpoint);

      if (response.ok) {
        const data = (await response.json()) as ReviewNotificationFeedResponse;
        const notifications = normalizeReviewNotificationFeed(data.notifications ?? data);

        setReviewNotificationFeed(notifications);
        setReviewNotificationFeedMode("api");
        return;
      }

      if (response.status !== 404) {
        throw new Error(`Notification feed failed (${response.status})`);
      }
    } catch (error) {
      if (error instanceof Error) {
        setReviewNotificationFeedError(error.message);
      }
    }

    setReviewNotificationFeed(
      buildDerivedReviewNotificationFeed(snapshot, reviewerHandle, reviewerName),
    );
    setReviewNotificationFeedMode("derived");
  }

  async function handleReviewerSignIn() {
    const reviewer = reviewerDirectory.find((item) => item.id === selectedReviewerId);

    if (!reviewer) {
      return;
    }

    setReviewerIdentityError(null);

    try {
      const response = await fetch("/api/session/reviewer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reviewerHandle: reviewer.handle,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as ReviewerSessionResponse;
        const activeId = data.session?.currentProfile?.id ?? reviewer.id;
        setSelectedReviewerId(activeId);
        setReviewerIdentityMode("api");
        return;
      }

      if (response.status !== 404) {
        throw new Error(`Reviewer sign-in failed (${response.status})`);
      }
    } catch (error) {
      if (error instanceof Error) {
        setReviewerIdentityError(error.message);
      }
    }

    setReviewerIdentityMode("derived");
    setSelectedReviewerId(reviewer.id);
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
    const replyTarget = getReplyTarget(diffId);

    if (!body || commentState.submitting || proposalIsLocked || mutationInFlight) {
      return;
    }

    try {
      const response = await fetch(
        `/api/workbooks/${encodeURIComponent(
          snapshot.workbook.id,
        )}/proposal/items/${encodeURIComponent(diffId)}/comments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            author: reviewerName.trim(),
            body,
            parentCommentId: replyTarget?.commentId,
            replyToCommentId: replyTarget?.commentId,
            mentions: Array.from(
              new Set(extractMentions(body).map((mention) => mention.replace(/^@/, ""))),
            ),
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Comment save failed (${response.status})`);
      }

      const data = (await response.json()) as ReviewResponse;
      setSnapshot(data.review);
      setItemCommentDraft(diffId, "");
      setReplyTarget(diffId, null);
      await loadReviewerNotificationFeed();
      updateItemCommentState(diffId, { submitting: false, error: null });
    } catch (error) {
      updateItemCommentState(
        diffId,
        {
          submitting: false,
          error: error instanceof Error ? error.message : "Failed to save comment",
        },
      );
    }
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
                  <label>
                    <span>Tag</span>
                    <select
                      onChange={(event) => setWorkbookTagFilter(event.target.value)}
                      value={workbookTagFilter}
                    >
                      <option value="all">Any tag</option>
                      {availableTags.map((tag) => (
                        <option key={tag} value={tag}>
                          {tag}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="library-meta">
                  Showing {filteredWorkbooks.length} of {workbooks.length} workbooks
                </p>
                <div className="saved-view-panel">
                  <label>
                    <span>Save current view</span>
                    <input
                      onChange={(event) => setSavedViewName(event.target.value)}
                      placeholder="FP&A daily triage"
                      type="text"
                      value={savedViewName}
                    />
                  </label>
                  <button
                    className="mini-button comment"
                    disabled={savedViewName.trim().length === 0}
                    onClick={() => saveCurrentWorkbookView()}
                    type="button"
                  >
                    Save view
                  </button>
                  {savedWorkbookViews.length > 0 ? (
                    <div className="saved-view-chips">
                      {savedWorkbookViews.map((view) => (
                        <article
                          key={view.id}
                          className={
                            view.archivedAt ? "saved-view-chip archived" : "saved-view-chip"
                          }
                        >
                          <button
                            className="saved-view-apply"
                            disabled={Boolean(view.archivedAt)}
                            onClick={() => applySavedWorkbookView(view)}
                            type="button"
                          >
                            <strong>{view.name}</strong>
                            <small>
                              {view.searchQuery || "No query"} · {view.sortBy} · {view.sortDirection}
                              {view.tags.length > 0 ? ` · ${view.tags.join(", ")}` : ""}
                              {view.archivedAt ? ` · archived ${new Date(view.archivedAt).toLocaleDateString()}` : ""}
                            </small>
                          </button>
                          {!view.archivedAt ? (
                            <button
                              className="saved-view-delete"
                              disabled={mutationInFlight}
                              onClick={() => void archiveSavedWorkbookView(view.id)}
                              type="button"
                            >
                              Archive
                            </button>
                          ) : null}
                          <button
                            className="saved-view-delete"
                            disabled={mutationInFlight}
                            onClick={() => void deleteSavedWorkbookView(view.id)}
                            type="button"
                          >
                            Delete
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  <label className="saved-view-toggle">
                    <input
                      checked={showArchivedViews}
                      onChange={(event) => setShowArchivedViews(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Show archived views</span>
                  </label>
                </div>
              </div>
              <div className="workbook-list">
                {filteredWorkbooks.length > 0 ? (
                  filteredWorkbooks.map((workbook) => (
                    <article key={workbook.id} className="workbook-card">
                      <button
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
                      {workbook.tags.length > 0 ? (
                        <div className="tag-row">
                          {workbook.tags.map((tag) => (
                            <button
                              key={`${workbook.id}-${tag}`}
                              className={
                                workbookTagFilter === tag ? "tag-chip active" : "tag-chip"
                              }
                              onClick={() =>
                                setWorkbookTagFilter((current) => (current === tag ? "all" : tag))
                              }
                              type="button"
                            >
                              {tag}
                            </button>
                          ))}
                          {workbook.id === snapshot.workbook.id
                            ? workbook.tags.map((tag) => (
                                <button
                                  key={`${workbook.id}-${tag}-remove`}
                                  className="tag-remove"
                                  onClick={() => removeTagFromWorkbook(workbook.id, tag)}
                                  type="button"
                                >
                                  Remove {tag}
                                </button>
                              ))
                            : null}
                        </div>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <article className="empty-state-card">
                    <span>No matching workbooks</span>
                    <strong>Adjust the search or filters</strong>
                    <small>The library filter is hiding all available workbook snapshots.</small>
                  </article>
                )}
                <div className="tag-editor">
                  <strong>Tag current workbook</strong>
                  <div className="tag-editor-row">
                    <input
                      onChange={(event) => setWorkbookTagDraft(event.target.value)}
                      placeholder="finance, close, planning"
                      type="text"
                      value={workbookTagDraft}
                    />
                    <button
                      className="mini-button comment"
                      disabled={workbookTagDraft.trim().length === 0}
                      onClick={() => addTagToActiveWorkbook()}
                      type="button"
                    >
                      Add tag
                    </button>
                  </div>
                </div>
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
                <div className="reviewer-signin-row">
                  <label>
                    <span>Reviewer account</span>
                    <select
                      onChange={(event) => setSelectedReviewerId(event.target.value)}
                      value={selectedReviewerId}
                    >
                      {reviewerDirectory.map((reviewer) => (
                        <option key={reviewer.id} value={reviewer.id}>
                          {reviewer.displayName} · {reviewer.handle}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="decision-button apply"
                    onClick={() => void handleReviewerSignIn()}
                    type="button"
                  >
                    Sign in
                  </button>
                </div>
                <p className="review-meta">
                  Signed in as {reviewerName} ({reviewerHandle})
                  {reviewerIdentityMode === "api"
                    ? " via backend session."
                    : " using the local reviewer roster until the API exists."}
                </p>
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
                {reviewerIdentityError ? <p className="comment-error">{reviewerIdentityError}</p> : null}
              </div>
              <div className="comment-filter-panel">
                <div className="comment-filter-head">
                  <div>
                    <span>Comment threads</span>
                    <strong>Filter reviewer notes and mentions</strong>
                  </div>
                  <small>
                    {reviewNotificationFeedMode === "api"
                      ? "Backend feed"
                      : "Derived feed until the backend endpoint is available"}
                  </small>
                </div>
                {reviewNotifications.length > 0 ? (
                  <div className="notification-strip">
                    {reviewNotifications.map((notification) => (
                      <article
                        key={notification.id}
                        className={notification.readAt ? "notification-card" : "notification-card unread"}
                      >
                        <div className="notification-card-head">
                          <strong>{notification.label}</strong>
                          <span
                            className={notification.readAt ? "notification-badge read" : "notification-badge unread"}
                          >
                            {notification.readAt ? "Read" : "Unread"}
                          </span>
                        </div>
                        <small>{notification.detail}</small>
                        <small className="notification-source">
                          {notification.source === "api" ? "Synced feed item" : "Derived fallback item"}
                        </small>
                        <button
                          className="notification-toggle"
                          onClick={() =>
                            markNotificationRead(notification.id, !notification.readAt)
                          }
                          type="button"
                        >
                          {notification.readAt
                            ? "Mark unread"
                            : "Mark read"}
                        </button>
                      </article>
                    ))}
                  </div>
                ) : null}
                <div className="comment-filter-summary">
                  <strong>{unreadNotificationCount} unread</strong>
                  <button
                    className="notification-toggle"
                    disabled={unreadNotificationCount === 0}
                    onClick={() => markAllNotificationsRead()}
                    type="button"
                  >
                    Mark all read
                  </button>
                </div>
                {reviewNotificationFeedError ? (
                  <p className="comment-error">{reviewNotificationFeedError}</p>
                ) : null}
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
                      <option value="replies">Replies only</option>
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
                    const allComments = entry.comments ?? [];
                    const comments = getVisibleThreadComments(allComments, visibleComments);
                    const commentState = getItemCommentState(entry.id);
                    const commentDraft = getItemCommentDraft(entry.id);
                    const replyTarget = getReplyTarget(entry.id);
                    const mentionCandidates = Array.from(
                      new Set(comments.flatMap((comment) => extractMentions(comment.body))),
                    );

                    function renderCommentBranch(
                      parentCommentId?: string,
                      depth = 0,
                    ) {
                      return getChildComments(comments, parentCommentId).map((comment) => (
                        <article
                          key={comment.id}
                          className="comment-entry"
                          style={{ marginLeft: `${Math.min(depth * 18, 54)}px` }}
                        >
                          <div className="comment-entry-head">
                            <strong>{comment.author}</strong>
                            <button
                              className="reply-button"
                              onClick={() => startReply(entry.id, comment)}
                              type="button"
                            >
                              Reply
                            </button>
                          </div>
                          {comment.parentCommentId ? (
                            <small className="reply-label">
                              Replying to {allComments.find((item) => item.id === comment.parentCommentId)?.author ?? "thread"}
                            </small>
                          ) : null}
                          <p>{renderCommentBody(comment.body)}</p>
                          <small>{new Date(comment.createdAt).toLocaleString()}</small>
                          {renderCommentBranch(comment.id, depth + 1)}
                        </article>
                      ));
                    }

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
                              {renderCommentBranch()}
                            </div>
                          ) : (
                            <p className="comment-empty">
                              No comments yet. Add a note for this review item.
                            </p>
                          )}
                          <div className="comment-composer">
                            {replyTarget ? (
                              <div className="reply-banner">
                                <span>
                                  Replying to {replyTarget.author} with {replyTarget.handle}
                                </span>
                                <button
                                  onClick={() => setReplyTarget(entry.id, null)}
                                  type="button"
                                >
                                  Clear
                                </button>
                              </div>
                            ) : null}
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
              <div
                ref={sketchCanvasRef}
                className="sketch-canvas persisted"
                aria-label="Workbook sketch board"
              >
                <svg className="sketch-links" aria-hidden="true">
                  {sketchBoard.links.map((link) => {
                    const fromNode = sketchNodeMap.get(link.fromNodeId);
                    const toNode = sketchNodeMap.get(link.toNodeId);

                    if (!fromNode || !toNode) {
                      return null;
                    }

                    const x1 = fromNode.x + fromNode.width / 2;
                    const y1 = fromNode.y + fromNode.height / 2;
                    const x2 = toNode.x + toNode.width / 2;
                    const y2 = toNode.y + toNode.height / 2;

                    return (
                      <g
                        key={link.id}
                        className={
                          selectedSketchLinkId === link.id
                            ? "sketch-link-group selected"
                            : "sketch-link-group"
                        }
                        onClick={() => setSelectedSketchLinkId(link.id)}
                      >
                        <line
                          className="sketch-link-line"
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                        />
                        {link.label ? (
                          <text
                            className="sketch-link-text"
                            x={(x1 + x2) / 2}
                            y={(y1 + y2) / 2 - 6}
                          >
                            {link.label}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </svg>
                {sketchBoard.nodes.map((node) => (
                  <div
                    key={node.id}
                    className={
                      dragState?.nodeId === node.id
                        ? "sketch-node-card dragging"
                        : "sketch-node-card"
                    }
                    onPointerDown={(event) => startNodeDrag(event, node.id)}
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
                    <em>Drag to reposition</em>
                  </div>
                ))}
              </div>
              <div className="sketch-node-list">
                <p className="review-meta">
                  Drag a node on the board, then save to persist the updated coordinates.
                </p>
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
                <div className="sketch-link-editor">
                  <div className="sketch-link-editor-head">
                    <div>
                      <span>Sketch links</span>
                      <strong>Connect nodes, edit labels, and keep the flow readable.</strong>
                    </div>
                    <button
                      className="mini-button comment"
                      disabled={sketchBoard.nodes.length < 2}
                      onClick={() => addSketchLink()}
                      type="button"
                    >
                      Add link
                    </button>
                  </div>
                  {sketchBoard.links.length > 0 ? (
                    <div className="sketch-link-list">
                      {sketchBoard.links.map((link) => (
                        <article
                          key={link.id}
                          className={
                            selectedSketchLinkId === link.id
                              ? "sketch-link-item active"
                              : "sketch-link-item"
                          }
                        >
                          <div className="sketch-link-item-head">
                            <div>
                              <strong>{link.label || "Untitled link"}</strong>
                              <small>{link.id}</small>
                            </div>
                            <button
                              className="reply-button"
                              onClick={() => setSelectedSketchLinkId(link.id)}
                              type="button"
                            >
                              {selectedSketchLinkId === link.id ? "Selected" : "Select"}
                            </button>
                          </div>
                          <label>
                            <span>From</span>
                            <select
                              onChange={(event) =>
                                updateSketchLink(link.id, (current) => ({
                                  ...current,
                                  fromNodeId: event.target.value,
                                }))
                              }
                              value={link.fromNodeId}
                            >
                              {sketchNodeOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>To</span>
                            <select
                              onChange={(event) =>
                                updateSketchLink(link.id, (current) => ({
                                  ...current,
                                  toNodeId: event.target.value,
                                }))
                              }
                              value={link.toNodeId}
                            >
                              {sketchNodeOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Label</span>
                            <input
                              onChange={(event) =>
                                updateSketchLink(link.id, (current) => ({
                                  ...current,
                                  label: event.target.value,
                                }))
                              }
                              placeholder="Optional link label"
                              type="text"
                              value={link.label ?? ""}
                            />
                          </label>
                          <div className="comment-composer-row">
                            <button
                              className="mini-button reject"
                              onClick={() => removeSketchLink(link.id)}
                              type="button"
                            >
                              Remove
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="comment-empty">
                      No links yet. Add one from the canvas controls to connect nodes.
                    </p>
                  )}
                  {selectedSketchLink ? (
                    <p className="review-meta">
                      Selected link: {selectedSketchLink.label || selectedSketchLink.id}
                    </p>
                  ) : null}
                </div>
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
