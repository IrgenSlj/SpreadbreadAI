import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type ApprovalDecision,
  type ReviewerNotification,
  type ReviewerNotificationFeed,
  type ReviewerProfile,
  type ReviewerRole,
  type ReviewerSession,
  type WorkbookAccessAssignment,
  type WorkbookAccessRole,
  type WorkbookAccessState,
  type WorkbookLibraryView,
  demoReviewSnapshot,
  type ProposalDetail,
  type ProposalDiffEntry,
  type ProposalItemComment,
  type ProposalItemStatus,
  type WorkbookReviewSnapshot,
  type WorkbookSketchBoard,
  type WorkbookSummary,
} from "../../../packages/shared/src/index.js";
import {
  authorizeReviewerAction,
  authorizeWorkbookAction,
  authorizeWorkbookTargetsAction,
} from "./authorization.js";
import { parseWorkbookReviewSnapshot } from "./parser.js";
import {
  normalizeWorkbookAccessScopes,
  serializeWorkbookAccessScopes,
  workbookAccessTargetFromCell,
  type WorkbookAccessTarget,
} from "./workbook-access-scope.js";
import type {
  LibraryViewDeletionResult,
  LibraryViewMutationResult,
  MutationFailureCode,
  MutationResult,
  ReviewerNotificationMutationResult,
  ReviewerSessionMutationResult,
  SketchBoardMutationResult,
  TagsMutationResult,
  StoreBackend,
  StoredWorkbookRecord,
} from "./store-backend.js";

interface WorkbookStoreFile {
  records: StoredWorkbookRecord[];
  libraryViews?: WorkbookLibraryView[];
  notifications?: ReviewerNotification[];
  reviewers?: ReviewerProfile[];
  reviewerProfiles?: ReviewerProfile[];
  currentReviewerSession?: ReviewerSession;
}

const dataRoot = path.resolve(process.cwd(), ".data");
const uploadsDir = path.join(dataRoot, "uploads");
const storeFilePath = path.join(dataRoot, "workbooks.json");
let storeMutationChain = Promise.resolve();
let demoSnapshotState = structuredClone(demoReviewSnapshot);
let demoLibraryViews: WorkbookLibraryView[] = [];
let demoNotifications: ReviewerNotification[] = [];
const reviewerSeedTimestamp = "2026-01-01T00:00:00.000Z";

const defaultReviewerProfiles: ReviewerProfile[] = [
  {
    id: "finance_manager",
    handle: "finance_manager",
    displayName: "Finance Manager",
    role: "Approver",
    team: "FP&A",
    email: "finance.manager@spreadbread.local",
    active: true,
    createdAt: reviewerSeedTimestamp,
    updatedAt: reviewerSeedTimestamp,
  },
  {
    id: "controller",
    handle: "controller",
    displayName: "Controller",
    role: "Reviewer",
    team: "Accounting",
    email: "controller@spreadbread.local",
    active: true,
    createdAt: reviewerSeedTimestamp,
    updatedAt: reviewerSeedTimestamp,
  },
  {
    id: "analyst_1",
    handle: "analyst_1",
    displayName: "Analyst 1",
    role: "Analyst",
    team: "Finance Ops",
    email: "analyst.1@spreadbread.local",
    active: true,
    createdAt: reviewerSeedTimestamp,
    updatedAt: reviewerSeedTimestamp,
  },
];

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

function normalizeWorkbookTags(tags: unknown[]): string[] {
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

async function runSerializedMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = storeMutationChain.then(operation, operation);
  storeMutationChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
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

function normalizeReviewerRole(role?: string): ReviewerRole | undefined {
  if (role === "Approver" || role === "Reviewer" || role === "Analyst") {
    return role;
  }

  return undefined;
}

function workbookAccessRoleForReviewerRole(role?: ReviewerRole): WorkbookAccessRole {
  switch (role) {
    case "Approver":
      return "approver";
    case "Reviewer":
      return "reviewer";
    case "Analyst":
    default:
      return "editor";
  }
}

function normalizeWorkbookAccessRole(value?: string): WorkbookAccessRole | undefined {
  if (
    value === "owner" ||
    value === "approver" ||
    value === "reviewer" ||
    value === "editor"
  ) {
    return value;
  }

  return undefined;
}

function createReviewerProfile(input: {
  id?: string;
  handle: string;
  displayName: string;
  role?: string;
  team?: string;
  email?: string;
  color?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}): ReviewerProfile {
  const normalizedHandle = normalizeReviewer(input.handle);
  const normalizedId = normalizeReviewer(input.id ?? normalizedHandle);
  const createdAt = input.createdAt ?? reviewerSeedTimestamp;
  const updatedAt = input.updatedAt ?? createdAt;

  return {
    id: normalizedId,
    handle: normalizedHandle,
    displayName: input.displayName.trim(),
    role: normalizeReviewerRole(input.role?.trim()),
    team: input.team?.trim() || undefined,
    email: input.email?.trim() || undefined,
    color: input.color?.trim() || undefined,
    active: input.active ?? true,
    createdAt,
    updatedAt,
  };
}

function normalizeReviewerProfile(value: unknown): ReviewerProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const handle =
    typeof candidate.handle === "string"
      ? candidate.handle
      : typeof candidate.id === "string"
        ? candidate.id
        : "";
  const displayName =
    typeof candidate.displayName === "string"
      ? candidate.displayName
      : typeof candidate.name === "string"
        ? candidate.name
        : handle;

  if (!handle || !displayName) {
    return null;
  }

  const profile = createReviewerProfile({
    id: typeof candidate.id === "string" ? candidate.id : handle,
    handle,
    displayName,
    role: typeof candidate.role === "string" ? candidate.role : undefined,
    team: typeof candidate.team === "string" ? candidate.team : undefined,
    email: typeof candidate.email === "string" ? candidate.email : undefined,
    color: typeof candidate.color === "string" ? candidate.color : undefined,
    active: typeof candidate.active === "boolean" ? candidate.active : true,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : undefined,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : undefined,
  });

  return profile.active ? profile : null;
}

function normalizeReviewerProfiles(reviewers: unknown[] | undefined): ReviewerProfile[] {
  const profiles = reviewers && reviewers.length > 0 ? reviewers : defaultReviewerProfiles;
  const seen = new Set<string>();

  return profiles.flatMap((reviewer) => {
    const profile = normalizeReviewerProfile(reviewer);
    if (!profile) {
      return [];
    }

    if (seen.has(profile.id)) {
      return [];
    }

    seen.add(profile.id);
    return [profile];
  });
}

function normalizeReviewerSession(
  value: unknown,
  profiles: ReviewerProfile[],
): ReviewerSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const handle =
    typeof candidate.reviewerProfileId === "string"
      ? normalizeReviewer(candidate.reviewerProfileId)
      : typeof candidate.reviewerHandle === "string"
        ? normalizeReviewer(candidate.reviewerHandle)
        : typeof candidate.reviewer === "object" &&
            candidate.reviewer !== null &&
            typeof (candidate.reviewer as Record<string, unknown>).handle === "string"
          ? normalizeReviewer((candidate.reviewer as Record<string, unknown>).handle as string)
          : "";
  const currentProfile =
    profiles.find((profile) => profile.id === handle) ??
    profiles.find((profile) => profile.handle === handle) ??
    null;

  if (!currentProfile) {
    return null;
  }

  const signedInAt =
    typeof candidate.signedInAt === "string" && candidate.signedInAt
      ? candidate.signedInAt
      : reviewerSeedTimestamp;
  const updatedAt =
    typeof candidate.updatedAt === "string" && candidate.updatedAt
      ? candidate.updatedAt
      : signedInAt;

  return {
    reviewerProfileId: currentProfile.id,
    signedInAt,
    updatedAt,
    currentProfile,
  };
}

function defaultReviewerSession(profiles: ReviewerProfile[] = defaultReviewerProfiles): ReviewerSession {
  const currentProfile = profiles[0] ?? defaultReviewerProfiles[0];
  const signedInAt = new Date().toISOString();

  return {
    reviewerProfileId: currentProfile.id,
    signedInAt,
    updatedAt: signedInAt,
    currentProfile,
  };
}

function normalizeWorkbookAccessAssignments(
  value: unknown,
  profiles: ReviewerProfile[],
  fallbackAssignedBy: string,
  fallbackAssignedAt: string,
): WorkbookAccessAssignment[] {
  if (!Array.isArray(value) || value.length === 0) {
    return profiles.map((profile) => ({
      reviewerProfileId: profile.id,
      reviewerHandle: profile.handle,
      reviewerDisplayName: profile.displayName,
      assignmentRole: workbookAccessRoleForReviewerRole(profile.role),
      assignedAt: fallbackAssignedAt,
      assignedBy: fallbackAssignedBy,
    }));
  }

  const assignments: WorkbookAccessAssignment[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    const reviewerIdentifier =
      typeof candidate.reviewerProfileId === "string"
        ? normalizeReviewer(candidate.reviewerProfileId)
        : typeof candidate.reviewerHandle === "string"
          ? normalizeReviewer(candidate.reviewerHandle)
          : "";
    const reviewer =
      profiles.find((profile) => profile.id === reviewerIdentifier) ??
      profiles.find((profile) => profile.handle === reviewerIdentifier);

    if (!reviewer || seen.has(reviewer.id)) {
      continue;
    }

    const assignmentRole =
      normalizeWorkbookAccessRole(
        typeof candidate.assignmentRole === "string" ? candidate.assignmentRole : undefined,
      ) ?? workbookAccessRoleForReviewerRole(reviewer.role);

    seen.add(reviewer.id);
    assignments.push({
      reviewerProfileId: reviewer.id,
      reviewerHandle: reviewer.handle,
      reviewerDisplayName: reviewer.displayName,
      assignmentRole,
      ...serializeWorkbookAccessScopes(
        normalizeWorkbookAccessScopes({
          scopes: candidate.scopes,
          sheetScopes: candidate.sheetScopes,
          rangeScopes: candidate.rangeScopes,
        }),
      ),
      assignedAt:
        typeof candidate.assignedAt === "string" && candidate.assignedAt
          ? candidate.assignedAt
          : fallbackAssignedAt,
      assignedBy:
        typeof candidate.assignedBy === "string" && candidate.assignedBy
          ? candidate.assignedBy
          : fallbackAssignedBy,
    });
  }

  return assignments.length > 0
    ? assignments
    : profiles.map((profile) => ({
        reviewerProfileId: profile.id,
        reviewerHandle: profile.handle,
        reviewerDisplayName: profile.displayName,
        assignmentRole: workbookAccessRoleForReviewerRole(profile.role),
        assignedAt: fallbackAssignedAt,
        assignedBy: fallbackAssignedBy,
      }));
}

function createWorkbookAccessState(
  assignments: WorkbookAccessAssignment[],
  session: ReviewerSession | null,
): WorkbookAccessState {
  const currentAssignment = assignments.find(
    (assignment) =>
      assignment.reviewerProfileId === session?.currentProfile?.id ||
      assignment.reviewerHandle === session?.currentProfile?.handle,
  );

  return {
    assignments,
    currentReviewerAssignmentRole: currentAssignment?.assignmentRole,
    currentReviewerCanManage:
      currentAssignment?.assignmentRole === "owner" ||
      currentAssignment?.assignmentRole === "approver",
    currentReviewerCanWrite: Boolean(currentAssignment),
  };
}

function createOwnerWorkbookAccessState(
  reviewer: ReviewerProfile,
  assignedAt: string,
): WorkbookAccessState {
  return createWorkbookAccessState(
    [
      {
        reviewerProfileId: reviewer.id,
        reviewerHandle: reviewer.handle,
        reviewerDisplayName: reviewer.displayName,
        assignmentRole: "owner",
        assignedAt,
        assignedBy: reviewer.displayName,
      },
    ],
    {
      reviewerProfileId: reviewer.id,
      signedInAt: assignedAt,
      updatedAt: assignedAt,
      currentProfile: reviewer,
    },
  );
}

function readWorkbookAccessFromStore(
  store: WorkbookStoreFile,
  workbookId: string,
): WorkbookAccessState | null {
  const reviewers = normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers);
  const session =
    normalizeReviewerSession(store.currentReviewerSession, reviewers) ??
    defaultReviewerSession(reviewers);

  const source =
    workbookId === demoSnapshotState.workbook.id
      ? demoSnapshotState.workbook.access ?? null
      : store.records.find((record) => record.snapshot.workbook.id === workbookId)?.snapshot.workbook
          .access ?? null;

  if (!source) {
    return null;
  }

  return createWorkbookAccessState(
    normalizeWorkbookAccessAssignments(
      source.assignments,
      reviewers,
      source.assignments[0]?.assignedBy ?? session.currentProfile?.displayName ?? "system",
      source.assignments[0]?.assignedAt ?? new Date().toISOString(),
    ),
    session,
  );
}

function withWorkbookAccess(
  snapshot: WorkbookReviewSnapshot,
  profiles: ReviewerProfile[],
  session: ReviewerSession | null,
): WorkbookReviewSnapshot {
  const assignments = normalizeWorkbookAccessAssignments(
    snapshot.workbook.access?.assignments,
    profiles,
    snapshot.workbook.owner || "system",
    snapshot.workbook.createdAt,
  );

  const access = assignments.length > 0
    ? createWorkbookAccessState(assignments, session)
    : undefined;

  return {
    ...snapshot,
    workbook: {
      ...snapshot.workbook,
      access,
    },
  };
}

async function authorizeReviewerMutation(
  store: WorkbookStoreFile,
  permission: Parameters<typeof authorizeReviewerAction>[1],
  workbookAccess?: WorkbookAccessState,
  actor?: string,
  target?: WorkbookAccessTarget | null,
) {
  const reviewers = normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers);
  const session =
    normalizeReviewerSession(store.currentReviewerSession, reviewers) ??
    defaultReviewerSession(reviewers);

  return workbookAccess
    ? authorizeWorkbookAction(session, permission, workbookAccess, actor, target)
    : authorizeReviewerAction(session, permission, actor);
}

async function authorizeWorkbookMutation(
  store: WorkbookStoreFile,
  workbookId: string,
  permission: Parameters<typeof authorizeReviewerAction>[1],
  actor?: string,
  target?: WorkbookAccessTarget | null,
) {
  const workbookAccess = readWorkbookAccessFromStore(store, workbookId);
  return authorizeReviewerMutation(
    store,
    permission,
    workbookAccess ?? undefined,
    actor,
    target,
  );
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

function addDemoNotification(notification: ReviewerNotification) {
  demoNotifications = [notification, ...demoNotifications];
}

function collectReviewerNotifications(
  notifications: ReviewerNotification[],
  reviewer: string,
  includeRead: boolean,
) {
  const normalizedReviewer = normalizeReviewer(reviewer);
  return notifications
    .filter((notification) => notification.reviewer === normalizedReviewer)
    .filter((notification) => notification.action === "proposal.item.mention" || notification.action === "proposal.item.reply")
    .filter((notification) => includeRead || !notification.readAt)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

if (!demoSnapshotState.workbook.sketchBoard) {
  demoSnapshotState = {
    ...demoSnapshotState,
    workbook: {
      ...demoSnapshotState.workbook,
      sketchBoard: createSketchBoard(
        demoSnapshotState.workbook.id,
        demoSnapshotState.workbook.name,
        demoSnapshotState.workbook.lastReviewedAt,
        "system",
        "Generated from the demo workbook.",
      ),
    },
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
  const repliedToComment = replyToCommentId
    ? comments.find((comment) => comment.id === replyToCommentId)
    : undefined;
  if (replyToCommentId && !repliedToComment) {
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
    proposalCell: target.cell,
    repliedToComment,
  };
}

function hasReviewedItems(diff: ProposalDiffEntry[]) {
  return diff.some((entry) => entry.status !== "pending");
}

function applyDecisionToAllItems(
  diff: ProposalDiffEntry[],
  decision: ApprovalDecision,
  reviewer: string,
  reviewedAt: string,
  comment?: string,
) {
  return diff.map((entry) => ({
    ...entry,
    status: itemDecisionToStatus(decision),
    reviewer,
    reviewedAt,
    reviewComment: comment,
  }));
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

function appendApplyResult(snapshot: WorkbookReviewSnapshot, actor: string, note?: string) {
  if (snapshot.proposal.status === "applied") {
    return null;
  }

  const reviewedAt = new Date().toISOString();
  const approvedItems = snapshot.proposal.diff.filter((entry) => entry.status === "approved");

  if (approvedItems.length === 0) {
    return null;
  }

  const versionId = nextVersionId(snapshot.workbook.latestVersionId);

  return {
    ...snapshot,
    workbook: {
      ...snapshot.workbook,
      latestVersionId: versionId,
      lastReviewedAt: reviewedAt,
      versions: [
        {
          id: versionId,
          createdAt: reviewedAt,
          createdBy: actor,
          note:
            note?.trim() ||
            `Applied ${approvedItems.length} approved proposal item${approvedItems.length === 1 ? "" : "s"}.`,
        },
        ...snapshot.workbook.versions,
      ],
    },
    proposal: {
      ...snapshot.proposal,
      status: "applied" as const,
      appliedAt: reviewedAt,
      appliedBy: actor,
      appliedVersionId: versionId,
      reviewedAt,
      reviewer: actor,
      reviewComment: note?.trim() || snapshot.proposal.reviewComment,
      diff: snapshot.proposal.diff.map((entry) =>
        entry.status === "approved"
          ? {
              ...entry,
              reviewComment:
                entry.reviewComment ??
                "Included in the applied workbook version.",
            }
          : entry,
      ),
    },
    auditEvents: [
      {
        id: `${snapshot.workbook.id}_audit_${snapshot.auditEvents.length + 1}`,
        workbookId: snapshot.workbook.id,
        actor,
        action: "proposal.applied",
        detail:
          note?.trim() ||
          `Applied ${approvedItems.length} approved proposal item${approvedItems.length === 1 ? "" : "s"} to workbook version ${versionId}.`,
        createdAt: reviewedAt,
      },
      ...snapshot.auditEvents,
    ],
  };
}

function mutationSuccess(review: WorkbookReviewSnapshot): MutationResult {
  return { ok: true, review };
}

function mutationFailure(code: MutationFailureCode): MutationResult {
  return { ok: false, code };
}

export function createFileStoreBackend(): StoreBackend {
  return {
    async listReviewerProfiles(): Promise<ReviewerProfile[]> {
      const store = await readStore();
      return normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers);
    },

    async getReviewerSession(): Promise<ReviewerSession | null> {
      const store = await readStore();
      const reviewers = normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers);
      const session =
        normalizeReviewerSession(store.currentReviewerSession, reviewers) ??
        defaultReviewerSession(reviewers);

      if (!session.currentProfile) {
        return null;
      }

      return session;
    },

    async setReviewerSession(input: {
      reviewerProfileId?: string;
      reviewerHandle?: string;
    }): Promise<ReviewerSessionMutationResult> {
      const reviewerIdentifier = normalizeReviewer(
        input.reviewerProfileId ?? input.reviewerHandle ?? "",
      );

      return runSerializedMutation(async () => {
        const store = await readStore();
        const reviewers = normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers);
        const reviewer =
          reviewers.find((entry) => entry.id === reviewerIdentifier) ??
          reviewers.find((entry) => entry.handle === reviewerIdentifier);

        if (!reviewer) {
          return { ok: false, code: "not_found" } as const;
        }

        const session = {
          reviewerProfileId: reviewer.id,
          signedInAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currentProfile: reviewer,
        };

        store.reviewers = reviewers;
        store.reviewerProfiles = reviewers;
        store.currentReviewerSession = session;
        await writeStore(store);
        return { ok: true, session };
      });
    },

    async listStoredWorkbooks(): Promise<WorkbookSummary[]> {
      const store = await readStore();
      const reviewers = normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers);
      const session =
        normalizeReviewerSession(store.currentReviewerSession, reviewers) ??
        defaultReviewerSession(reviewers);
      const persisted = store.records.map((record) => ({
        ...record.snapshot.workbook,
        access: withWorkbookAccess(record.snapshot, reviewers, session).workbook.access,
      }));

      return [
        {
          id: demoSnapshotState.workbook.id,
          name: demoSnapshotState.workbook.name,
          latestVersionId: demoSnapshotState.workbook.latestVersionId,
          sheetCount: demoSnapshotState.workbook.sheetCount,
          createdAt: demoSnapshotState.workbook.createdAt,
          tags: demoSnapshotState.workbook.tags,
          access: withWorkbookAccess(demoSnapshotState, reviewers, session).workbook.access,
        },
        ...persisted,
      ];
    },

    async getStoredWorkbookReview(workbookId: string): Promise<WorkbookReviewSnapshot | null> {
      const store = await readStore();
      const reviewers = normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers);
      const session =
        normalizeReviewerSession(store.currentReviewerSession, reviewers) ??
        defaultReviewerSession(reviewers);

      if (workbookId === demoSnapshotState.workbook.id) {
        return withWorkbookAccess(demoSnapshotState, reviewers, session);
      }

      const match = store.records.find((record) => record.snapshot.workbook.id === workbookId);

      return match ? withWorkbookAccess(match.snapshot, reviewers, session) : null;
    },

    async getStoredWorkbookAccess(workbookId: string): Promise<WorkbookAccessState | null> {
      const store = await readStore();
      const reviewers = normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers);
      const session =
        normalizeReviewerSession(store.currentReviewerSession, reviewers) ??
        defaultReviewerSession(reviewers);

      if (workbookId === demoSnapshotState.workbook.id) {
        return withWorkbookAccess(demoSnapshotState, reviewers, session).workbook.access ?? null;
      }

      const match = store.records.find((record) => record.snapshot.workbook.id === workbookId);
      return match ? withWorkbookAccess(match.snapshot, reviewers, session).workbook.access ?? null : null;
    },

    async getStoredWorkbookTags(workbookId: string): Promise<string[] | null> {
      if (workbookId === demoSnapshotState.workbook.id) {
        return [...demoSnapshotState.workbook.tags];
      }

      const store = await readStore();
      const match = store.records.find((record) => record.snapshot.workbook.id === workbookId);

      return match?.snapshot.workbook.tags ?? null;
    },

    async getStoredSketchBoard(workbookId: string): Promise<WorkbookSketchBoard | null> {
      if (workbookId === demoSnapshotState.workbook.id) {
        return (
          demoSnapshotState.workbook.sketchBoard ??
          createSketchBoard(
            demoSnapshotState.workbook.id,
            demoSnapshotState.workbook.name,
            demoSnapshotState.workbook.lastReviewedAt,
            "system",
            "Generated from the demo workbook.",
          )
        );
      }

      const store = await readStore();
      const match = store.records.find((record) => record.snapshot.workbook.id === workbookId);

      if (!match) {
        return null;
      }

      if (!match.snapshot.workbook.sketchBoard) {
        match.snapshot = {
          ...match.snapshot,
          workbook: {
            ...match.snapshot.workbook,
            sketchBoard: createSketchBoard(
              match.snapshot.workbook.id,
              match.snapshot.workbook.name,
              match.snapshot.workbook.lastReviewedAt,
              "system",
            ),
          },
        };

        await writeStore(store);
      }

      return match.snapshot.workbook.sketchBoard ?? null;
    },

    async updateStoredWorkbookTags(input: {
      workbookId: string;
      tags: string[];
      updatedBy: string;
    }): Promise<TagsMutationResult> {
      const store = await readStore();
      const reviewers = normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers);
      const session =
        normalizeReviewerSession(store.currentReviewerSession, reviewers) ??
        defaultReviewerSession(reviewers);
      const auth = await authorizeWorkbookMutation(store, input.workbookId, "tag_write", input.updatedBy);
      if (!auth.ok) {
        return { ok: false, code: "forbidden" };
      }

      const updatedBy = auth.reviewer.displayName;
      const updatedAt = new Date().toISOString();
      const tags = normalizeWorkbookTags(input.tags);

      if (input.workbookId === demoSnapshotState.workbook.id) {
        demoSnapshotState = {
          ...demoSnapshotState,
          workbook: {
            ...demoSnapshotState.workbook,
            tags,
          },
          auditEvents: [
            ...demoSnapshotState.auditEvents,
            {
              id: `audit_${demoSnapshotState.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: updatedBy,
              action: "workbook.tags.updated",
              detail: `Workbook tags updated to ${tags.length > 0 ? tags.join(", ") : "none"}.`,
              createdAt: updatedAt,
            },
          ],
        };

        return { ok: true, tags };
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const record = store.records.find((entry) => entry.snapshot.workbook.id === input.workbookId);

        if (!record) {
          return { ok: false, code: "not_found" };
        }

        record.snapshot = {
          ...record.snapshot,
          workbook: {
            ...record.snapshot.workbook,
            tags,
          },
          auditEvents: [
            ...record.snapshot.auditEvents,
            {
              id: `${input.workbookId}_audit_${record.snapshot.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: updatedBy,
              action: "workbook.tags.updated",
              detail: `Workbook tags updated to ${tags.length > 0 ? tags.join(", ") : "none"}.`,
              createdAt: updatedAt,
            },
          ],
        };

        await writeStore(store);
        return { ok: true, tags };
      });
    },

    async updateStoredWorkbookAccess(input) {
      const store = await readStore();
      const reviewers = normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers);
      const session =
        normalizeReviewerSession(store.currentReviewerSession, reviewers) ??
        defaultReviewerSession(reviewers);
      const auth = await authorizeWorkbookMutation(
        store,
        input.workbookId,
        "workbook_access_write",
        input.updatedBy,
      );

      if (!auth.ok) {
        return { ok: false, code: "forbidden" } as const;
      }

      const updatedBy = auth.reviewer.displayName;
      const updatedAt = new Date().toISOString();
      const assignments = normalizeWorkbookAccessAssignments(
        input.assignments,
        reviewers,
        updatedBy,
        updatedAt,
      );

      if (input.workbookId === demoSnapshotState.workbook.id) {
        demoSnapshotState = {
          ...demoSnapshotState,
          workbook: {
            ...demoSnapshotState.workbook,
            access: createWorkbookAccessState(assignments, session),
          },
          auditEvents: [
            ...demoSnapshotState.auditEvents,
            {
              id: `audit_${demoSnapshotState.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: updatedBy,
              action: "workbook.access.updated",
              detail: `Workbook access assignments updated to ${assignments.length} reviewers.`,
              createdAt: updatedAt,
            },
          ],
        };

        return { ok: true, access: demoSnapshotState.workbook.access ?? createWorkbookAccessState(assignments, session) };
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const record = store.records.find((entry) => entry.snapshot.workbook.id === input.workbookId);

        if (!record) {
          return { ok: false, code: "not_found" } as const;
        }

        record.snapshot = {
          ...record.snapshot,
          workbook: {
            ...record.snapshot.workbook,
            access: createWorkbookAccessState(assignments, session),
          },
          auditEvents: [
            ...record.snapshot.auditEvents,
            {
              id: `${input.workbookId}_audit_${record.snapshot.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: updatedBy,
              action: "workbook.access.updated",
              detail: `Workbook access assignments updated to ${assignments.length} reviewers.`,
              createdAt: updatedAt,
            },
          ],
        };

        await writeStore(store);
        return { ok: true, access: record.snapshot.workbook.access ?? createWorkbookAccessState(assignments, session) };
      });
    },

    async saveUploadedWorkbook(input: {
      fileName: string;
      contentType: string;
      bytes: Uint8Array;
    }): Promise<StoredWorkbookRecord> {
      return runSerializedMutation(async () => {
        await ensureStore();

        const storedAt = new Date().toISOString();
        const recordId = createRecordId(input.fileName);
        const sanitizedFileName = sanitizeFileName(input.fileName);
        const uploadPath = path.join(uploadsDir, `${recordId}-${sanitizedFileName}`);

        await writeFile(uploadPath, input.bytes);

        try {
          const store = await readStore();
          const reviewers = normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers);
          const session =
            normalizeReviewerSession(store.currentReviewerSession, reviewers) ??
            defaultReviewerSession(reviewers);
          const baseSnapshot = parseWorkbookReviewSnapshot({
            workbookId: recordId,
            fileName: input.fileName,
            uploadedAt: storedAt,
            bytes: input.bytes,
          });
          const access = createOwnerWorkbookAccessState(
            session.currentProfile ?? reviewers[0] ?? defaultReviewerProfiles[0],
            storedAt,
          );
          const snapshot = {
            ...withWorkbookAccess(baseSnapshot, reviewers, session),
            workbook: {
              ...withWorkbookAccess(baseSnapshot, reviewers, session).workbook,
              access,
            },
          };

          const record: StoredWorkbookRecord = {
            id: recordId,
            fileName: input.fileName,
            contentType: input.contentType || "application/octet-stream",
            fileSize: input.bytes.byteLength,
            storedAt,
            uploadPath,
            snapshot,
          };

          store.records.unshift(record);
          await writeStore(store);

          return record;
        } catch (error) {
          await unlink(uploadPath).catch(() => undefined);
          throw error;
        }
      });
    },

    async updateStoredProposalDecision(input: {
      workbookId: string;
      decision: ApprovalDecision;
      reviewer: string;
      comment?: string;
    }): Promise<MutationResult> {
      const store = await readStore();
      if (input.workbookId === demoSnapshotState.workbook.id) {
        const auth = await authorizeWorkbookTargetsAction(
          normalizeReviewerSession(
            store.currentReviewerSession,
            normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers),
          ) ?? defaultReviewerSession(normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers)),
          "proposal_review",
          readWorkbookAccessFromStore(store, input.workbookId) ?? undefined,
          input.reviewer,
          demoSnapshotState.proposal.diff.map((entry) => workbookAccessTargetFromCell(entry.cell)),
        );
        if (!auth.ok) {
          return { ok: false, code: "forbidden" };
        }

        const reviewer = auth.reviewer.displayName;
        if (demoSnapshotState.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        if (hasReviewedItems(demoSnapshotState.proposal.diff)) {
          return mutationFailure("review_path_locked");
        }

        const reviewedAt = new Date().toISOString();
        const nextDiff = applyDecisionToAllItems(
          demoSnapshotState.proposal.diff,
          input.decision,
          reviewer,
          reviewedAt,
          input.comment,
        );

        demoSnapshotState = {
          ...demoSnapshotState,
          proposal: {
            ...demoSnapshotState.proposal,
            diff: nextDiff,
            status: deriveProposalStatus(nextDiff),
            reviewer,
            reviewedAt,
            reviewComment: input.comment,
          },
          auditEvents: [
            ...demoSnapshotState.auditEvents,
            {
              id: `audit_${demoSnapshotState.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: reviewer,
              action:
                input.decision === "approve" ? "proposal.approved" : "proposal.rejected",
              detail:
                input.comment?.trim() ||
                (input.decision === "approve"
                  ? "Proposal approved in the review prototype."
                  : "Proposal rejected in the review prototype."),
              createdAt: reviewedAt,
            },
          ],
        };

        addDemoNotification(
          createReviewerNotification({
            reviewer,
            title: "Proposal review recorded",
            body: `${demoSnapshotState.workbook.name} was ${input.decision}d by ${reviewer}.`,
            action: input.decision === "approve" ? "proposal.approved" : "proposal.rejected",
            createdAt: reviewedAt,
            workbookId: input.workbookId,
            proposalId: demoSnapshotState.proposal.id,
          }),
        );

        return mutationSuccess(demoSnapshotState);
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const record = store.records.find((entry) => entry.snapshot.workbook.id === input.workbookId);

        if (!record) {
          return mutationFailure("not_found");
        }

        const reviewers = normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers);
        const session =
          normalizeReviewerSession(store.currentReviewerSession, reviewers) ??
          defaultReviewerSession(reviewers);
        const auth = await authorizeWorkbookTargetsAction(
          session,
          "proposal_review",
          readWorkbookAccessFromStore(store, input.workbookId) ?? undefined,
          input.reviewer,
          record.snapshot.proposal.diff.map((entry) => workbookAccessTargetFromCell(entry.cell)),
        );
        if (!auth.ok) {
          return { ok: false, code: "forbidden" };
        }

        const reviewer = auth.reviewer.displayName;

        if (record.snapshot.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        if (hasReviewedItems(record.snapshot.proposal.diff)) {
          return mutationFailure("review_path_locked");
        }

        const reviewedAt = new Date().toISOString();
        const nextDiff = applyDecisionToAllItems(
          record.snapshot.proposal.diff,
          input.decision,
          reviewer,
          reviewedAt,
          input.comment,
        );

        record.snapshot = {
          ...record.snapshot,
          proposal: {
            ...record.snapshot.proposal,
            diff: nextDiff,
            status: deriveProposalStatus(nextDiff),
            reviewer,
            reviewedAt,
            reviewComment: input.comment,
          },
          auditEvents: [
            ...record.snapshot.auditEvents,
            {
              id: `${input.workbookId}_audit_${record.snapshot.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: reviewer,
              action:
                input.decision === "approve" ? "proposal.approved" : "proposal.rejected",
              detail:
                input.comment?.trim() ||
                (input.decision === "approve"
                  ? "Proposal approved in the review prototype."
                  : "Proposal rejected in the review prototype."),
              createdAt: reviewedAt,
            },
          ],
        };

        store.notifications = store.notifications ?? [];
        store.notifications.unshift(
          createReviewerNotification({
            reviewer,
            title: "Proposal review recorded",
            body: `${record.snapshot.workbook.name} was ${input.decision}d by ${reviewer}.`,
            action: input.decision === "approve" ? "proposal.approved" : "proposal.rejected",
            createdAt: reviewedAt,
            workbookId: input.workbookId,
            proposalId: record.snapshot.proposal.id,
          }),
        );

        await writeStore(store);
        return mutationSuccess(record.snapshot);
      });
    },

    async updateStoredProposalItemDecision(input: {
      workbookId: string;
      diffId: string;
      decision: ApprovalDecision;
      reviewer: string;
      comment?: string;
    }): Promise<MutationResult> {
      const store = await readStore();
      const reviewedAt = new Date().toISOString();

      if (input.workbookId === demoSnapshotState.workbook.id) {
        if (demoSnapshotState.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        if (demoSnapshotState.proposal.status !== "pending_approval") {
          return mutationFailure("locked");
        }

        const hasMatch = demoSnapshotState.proposal.diff.some((entry) => entry.id === input.diffId);

        if (!hasMatch) {
          return mutationFailure("item_not_found");
        }

        const existing = demoSnapshotState.proposal.diff.find((entry) => entry.id === input.diffId);
        const auth = await authorizeWorkbookMutation(
          store,
          input.workbookId,
          "item_review",
          input.reviewer,
          workbookAccessTargetFromCell(existing?.cell),
        );
        if (!auth.ok) {
          return { ok: false, code: "forbidden" };
        }

        const reviewer = auth.reviewer.displayName;

        const nextDiff = demoSnapshotState.proposal.diff.map((entry) =>
          entry.id === input.diffId
            ? {
                ...entry,
                status: itemDecisionToStatus(input.decision),
                reviewer,
                reviewedAt,
                reviewComment: input.comment,
              }
            : entry,
        );

        demoSnapshotState = {
          ...demoSnapshotState,
          proposal: {
            ...demoSnapshotState.proposal,
            diff: nextDiff,
            status: deriveProposalStatus(nextDiff),
            reviewer,
            reviewedAt,
            reviewComment: input.comment,
          },
          auditEvents: [
            ...demoSnapshotState.auditEvents,
            {
              id: `audit_${demoSnapshotState.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: reviewer,
              action:
                input.decision === "approve"
                  ? "proposal.item.approved"
                  : "proposal.item.rejected",
              detail:
                input.comment?.trim() ||
                `${input.decision === "approve" ? "Approved" : "Rejected"} proposal item ${input.diffId}.`,
              createdAt: reviewedAt,
            },
          ],
        };

        addDemoNotification(
          createReviewerNotification({
            reviewer,
            title: "Proposal item reviewed",
            body: `${demoSnapshotState.workbook.name} item ${input.diffId} was ${input.decision}d by ${reviewer}.`,
            action:
              input.decision === "approve"
                ? "proposal.item.approved"
                : "proposal.item.rejected",
            createdAt: reviewedAt,
            workbookId: input.workbookId,
            proposalId: demoSnapshotState.proposal.id,
            proposalItemId: input.diffId,
          }),
        );

        return mutationSuccess(demoSnapshotState);
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const record = store.records.find((entry) => entry.snapshot.workbook.id === input.workbookId);

        if (!record) {
          return mutationFailure("not_found");
        }

        if (record.snapshot.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        if (record.snapshot.proposal.status !== "pending_approval") {
          return mutationFailure("locked");
        }

        const hasMatch = record.snapshot.proposal.diff.some((entry) => entry.id === input.diffId);

        if (!hasMatch) {
          return mutationFailure("item_not_found");
        }

        const existing = record.snapshot.proposal.diff.find((entry) => entry.id === input.diffId);
        const auth = await authorizeWorkbookMutation(
          store,
          input.workbookId,
          "item_review",
          input.reviewer,
          workbookAccessTargetFromCell(existing?.cell),
        );
        if (!auth.ok) {
          return { ok: false, code: "forbidden" };
        }

        const reviewer = auth.reviewer.displayName;

        if (existing && existing.status !== "pending") {
          return mutationFailure("locked");
        }

        const nextDiff = record.snapshot.proposal.diff.map((entry) =>
          entry.id === input.diffId
            ? {
                ...entry,
                status: itemDecisionToStatus(input.decision),
                reviewer,
                reviewedAt,
                reviewComment: input.comment,
              }
            : entry,
        );

        record.snapshot = {
          ...record.snapshot,
          proposal: {
            ...record.snapshot.proposal,
            diff: nextDiff,
            status: deriveProposalStatus(nextDiff),
            reviewer,
            reviewedAt,
            reviewComment: input.comment,
          },
          auditEvents: [
            ...record.snapshot.auditEvents,
            {
              id: `${input.workbookId}_audit_${record.snapshot.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: reviewer,
              action:
                input.decision === "approve"
                  ? "proposal.item.approved"
                  : "proposal.item.rejected",
              detail:
                input.comment?.trim() ||
                `${input.decision === "approve" ? "Approved" : "Rejected"} proposal item ${input.diffId}.`,
              createdAt: reviewedAt,
            },
          ],
        };

        store.notifications = store.notifications ?? [];
        store.notifications.unshift(
          createReviewerNotification({
            reviewer,
            title: "Proposal item reviewed",
            body: `${record.snapshot.workbook.name} item ${input.diffId} was ${input.decision}d by ${reviewer}.`,
            action:
              input.decision === "approve"
                ? "proposal.item.approved"
                : "proposal.item.rejected",
            createdAt: reviewedAt,
            workbookId: input.workbookId,
            proposalId: record.snapshot.proposal.id,
            proposalItemId: input.diffId,
          }),
        );

        await writeStore(store);
        return mutationSuccess(record.snapshot);
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
      const store = await readStore();
      const createdAt = new Date().toISOString();

      if (input.workbookId === demoSnapshotState.workbook.id) {
        if (demoSnapshotState.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        const appended = appendCommentToDiff(demoSnapshotState.proposal.diff, input, createdAt);
        if ("error" in appended) {
          return mutationFailure(
            appended.error === "item_not_found" ? "item_not_found" : "comment_not_found",
          );
        }

        const auth = await authorizeWorkbookMutation(
          store,
          input.workbookId,
          "comment",
          input.author,
          workbookAccessTargetFromCell(appended.proposalCell),
        );
        if (!auth.ok) {
          return { ok: false, code: "forbidden" };
        }

        const author = auth.reviewer.displayName;

        demoSnapshotState = {
          ...demoSnapshotState,
          proposal: {
            ...demoSnapshotState.proposal,
            diff: appended.nextDiff,
          },
          auditEvents: [
            ...demoSnapshotState.auditEvents,
            {
              id: `audit_${demoSnapshotState.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: author,
              action: "proposal.item.commented",
              detail: `Comment added to proposal item ${input.diffId}.`,
              createdAt,
            },
          ],
        };

        for (const notification of buildCommentNotifications({
          workbookId: input.workbookId,
          workbookName: demoSnapshotState.workbook.name,
          proposalId: demoSnapshotState.proposal.id,
          proposalItemId: input.diffId,
          proposalCell: appended.proposalCell,
          author,
          comment: appended.comment,
          repliedToComment: appended.repliedToComment,
        })) {
          addDemoNotification(notification);
        }

        return mutationSuccess(demoSnapshotState);
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const record = store.records.find((entry) => entry.snapshot.workbook.id === input.workbookId);

        if (!record) {
          return mutationFailure("not_found");
        }

        if (record.snapshot.proposal.status === "applied") {
          return mutationFailure("locked");
        }

        const appended = appendCommentToDiff(record.snapshot.proposal.diff, input, createdAt);
        if ("error" in appended) {
          return mutationFailure(
            appended.error === "item_not_found" ? "item_not_found" : "comment_not_found",
          );
        }

        const auth = await authorizeWorkbookMutation(
          store,
          input.workbookId,
          "comment",
          input.author,
          workbookAccessTargetFromCell(appended.proposalCell),
        );
        if (!auth.ok) {
          return { ok: false, code: "forbidden" };
        }

        const author = auth.reviewer.displayName;

        record.snapshot = {
          ...record.snapshot,
          proposal: {
            ...record.snapshot.proposal,
            diff: appended.nextDiff,
          },
          auditEvents: [
            ...record.snapshot.auditEvents,
            {
              id: `${input.workbookId}_audit_${record.snapshot.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: author,
              action: "proposal.item.commented",
              detail: `Comment added to proposal item ${input.diffId}.`,
              createdAt,
            },
          ],
        };

        store.notifications = store.notifications ?? [];
        const notifications = buildCommentNotifications({
          workbookId: input.workbookId,
          workbookName: record.snapshot.workbook.name,
          proposalId: record.snapshot.proposal.id,
          proposalItemId: input.diffId,
          proposalCell: appended.proposalCell,
          author,
          comment: appended.comment,
          repliedToComment: appended.repliedToComment,
        });
        store.notifications.unshift(...notifications);

        await writeStore(store);
        return mutationSuccess(record.snapshot);
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
      const store = await readStore();
      const auth = await authorizeWorkbookMutation(
        store,
        input.workbookId,
        "sketch_write",
        input.updatedBy,
      );
      if (!auth.ok) {
        return { ok: false, code: "forbidden" };
      }

      const updatedBy = auth.reviewer.displayName;
      const updatedAt = new Date().toISOString();

      if (input.workbookId === demoSnapshotState.workbook.id) {
        const sketchBoard: WorkbookSketchBoard = {
          id: `${demoSnapshotState.workbook.id}_sketch_board`,
          workbookId: demoSnapshotState.workbook.id,
          title: input.title.trim() || `${demoSnapshotState.workbook.name} Sketch Board`,
          updatedAt,
          updatedBy,
          nodes: [...input.nodes],
          links: [...input.links],
          notes: input.notes?.trim() || undefined,
        };

        demoSnapshotState = {
          ...demoSnapshotState,
          workbook: {
            ...demoSnapshotState.workbook,
            sketchBoard,
          },
          auditEvents: [
            ...demoSnapshotState.auditEvents,
            {
              id: `audit_${demoSnapshotState.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: updatedBy,
              action: "sketch.updated",
              detail: "Workbook sketch board updated.",
              createdAt: updatedAt,
            },
          ],
        };

        return { ok: true, sketchBoard };
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const record = store.records.find((entry) => entry.snapshot.workbook.id === input.workbookId);

        if (!record) {
          return { ok: false, code: "not_found" };
        }

        const sketchBoard: WorkbookSketchBoard = {
          id: `${record.snapshot.workbook.id}_sketch_board`,
          workbookId: record.snapshot.workbook.id,
          title: input.title.trim() || `${record.snapshot.workbook.name} Sketch Board`,
          updatedAt,
          updatedBy,
          nodes: [...input.nodes],
          links: [...input.links],
          notes: input.notes?.trim() || undefined,
        };

        record.snapshot = {
          ...record.snapshot,
          workbook: {
            ...record.snapshot.workbook,
            sketchBoard,
          },
          auditEvents: [
            ...record.snapshot.auditEvents,
            {
              id: `${input.workbookId}_audit_${record.snapshot.auditEvents.length + 1}`,
              workbookId: input.workbookId,
              actor: updatedBy,
              action: "sketch.updated",
              detail: "Workbook sketch board updated.",
              createdAt: updatedAt,
            },
          ],
        };

        await writeStore(store);
        return { ok: true, sketchBoard };
      });
    },

    async listStoredWorkbookLibraryViews(options?: {
      includeArchived?: boolean;
    }): Promise<WorkbookLibraryView[]> {
      const store = await readStore();
      const views = Array.isArray(store.libraryViews) ? store.libraryViews : demoLibraryViews;
      return options?.includeArchived ? views : views.filter((view) => !view.archivedAt);
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
      const store = await readStore();
      const auth = await authorizeReviewerMutation(
        store,
        "library_view_write",
        undefined,
        input.updatedBy,
      );
      if (!auth.ok) {
        return { ok: false, code: "forbidden" };
      }

      const updatedBy = auth.reviewer.displayName;
      if (input.id.startsWith("demo_")) {
        const existingView = demoLibraryViews.find((entry) => entry.id === input.id);
        const view = normalizeLibraryView({
          ...input,
          updatedAt: new Date().toISOString(),
          updatedBy,
          archivedAt: existingView?.archivedAt,
          archivedBy: existingView?.archivedBy,
        });

        demoLibraryViews = [
          ...demoLibraryViews.filter((entry) => entry.id !== view.id),
          view,
        ];
        return { ok: true, view };
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const existingViews = Array.isArray(store.libraryViews) ? store.libraryViews : [];
        const existingView = existingViews.find((entry) => entry.id === input.id);
        const view = normalizeLibraryView({
          ...input,
          updatedAt: new Date().toISOString(),
          updatedBy,
          archivedAt: existingView?.archivedAt,
          archivedBy: existingView?.archivedBy,
        });
        const nextViews = [
          ...existingViews.filter((entry) => entry.id !== view.id),
          view,
        ];

        store.libraryViews = nextViews;
        await writeStore(store);
        return { ok: true, view };
      });
    },

    async archiveStoredWorkbookLibraryView(input: {
      id: string;
      archivedBy: string;
    }): Promise<LibraryViewMutationResult> {
      const store = await readStore();
      const auth = await authorizeReviewerMutation(
        store,
        "library_view_write",
        undefined,
        input.archivedBy,
      );
      if (!auth.ok) {
        return { ok: false, code: "forbidden" };
      }

      const archivedBy = auth.reviewer.displayName;
      const archivedAt = new Date().toISOString();

      if (input.id.startsWith("demo_")) {
        const existingView = demoLibraryViews.find((entry) => entry.id === input.id);

        if (!existingView) {
          return { ok: false, code: "not_found" };
        }

        const view = normalizeLibraryView({
          ...existingView,
          updatedAt: archivedAt,
          updatedBy: archivedBy,
          archivedAt,
          archivedBy,
        });

        demoLibraryViews = [
          ...demoLibraryViews.filter((entry) => entry.id !== input.id),
          view,
        ];
        return { ok: true, view };
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const existingView = (store.libraryViews ?? []).find((entry) => entry.id === input.id);

        if (!existingView) {
          return { ok: false, code: "not_found" } as const;
        }

        const view = normalizeLibraryView({
          ...existingView,
          updatedAt: archivedAt,
          updatedBy: archivedBy,
          archivedAt,
          archivedBy,
        });

        store.libraryViews = [
          ...(store.libraryViews ?? []).filter((entry) => entry.id !== input.id),
          view,
        ];
        await writeStore(store);
        return { ok: true, view };
      });
    },

    async deleteStoredWorkbookLibraryView(input: {
      id: string;
    }): Promise<LibraryViewDeletionResult> {
      const store = await readStore();
      const auth = await authorizeReviewerMutation(store, "library_view_write");
      if (!auth.ok) {
        return { ok: false, code: "forbidden" };
      }

      if (input.id.startsWith("demo_")) {
        const existingView = demoLibraryViews.find((entry) => entry.id === input.id);

        if (!existingView) {
          return { ok: false, code: "not_found" };
        }

        demoLibraryViews = demoLibraryViews.filter((entry) => entry.id !== input.id);
        return { ok: true, deletedId: input.id };
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const existingView = (store.libraryViews ?? []).find((entry) => entry.id === input.id);

        if (!existingView) {
          return { ok: false, code: "not_found" };
        }

        store.libraryViews = (store.libraryViews ?? []).filter((entry) => entry.id !== input.id);
        await writeStore(store);
        return { ok: true, deletedId: input.id };
      });
    },

    async listReviewerNotifications(input: {
      reviewer: string;
      includeRead?: boolean;
    }): Promise<ReviewerNotificationFeed> {
      const reviewer = normalizeReviewer(input.reviewer);
      const store = await readStore();
      const notifications = collectReviewerNotifications(
        [
          ...demoNotifications,
          ...(store.notifications ?? []),
        ],
        reviewer,
        input.includeRead ?? false,
      );

      return {
        reviewer,
        unreadCount: notifications.filter((notification) => !notification.readAt).length,
        notifications,
      };
    },

    async markReviewerNotificationRead(input: {
      notificationId: string;
      reviewer: string;
    }): Promise<ReviewerNotificationMutationResult> {
      const reviewer = normalizeReviewer(input.reviewer);
      const readAt = new Date().toISOString();

      if (demoNotifications.some((notification) => notification.id === input.notificationId)) {
        let updated = false;
        demoNotifications = demoNotifications.map((notification) => {
          if (notification.id !== input.notificationId || notification.reviewer !== reviewer) {
            return notification;
          }

          updated = true;
          return {
            ...notification,
            readAt,
          };
        });

        if (!updated) {
          return { ok: false, code: "not_found" };
        }

        const notification = demoNotifications.find(
          (entry) => entry.id === input.notificationId && entry.reviewer === reviewer,
        );

        return notification ? { ok: true, notification } : { ok: false, code: "not_found" };
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const notifications = store.notifications ?? [];
        const existing = notifications.find(
          (notification) =>
            notification.id === input.notificationId && notification.reviewer === reviewer,
        );

        if (!existing) {
          return { ok: false, code: "not_found" };
        }

        const nextNotification = {
          ...existing,
          readAt,
        };

        store.notifications = notifications.map((notification) =>
          notification.id === input.notificationId && notification.reviewer === reviewer
            ? nextNotification
            : notification,
        );
        await writeStore(store);
        return { ok: true, notification: nextNotification };
      });
    },

    async markReviewerNotificationUnread(input: {
      notificationId: string;
      reviewer: string;
    }): Promise<ReviewerNotificationMutationResult> {
      const reviewer = normalizeReviewer(input.reviewer);
      if (demoNotifications.some((notification) => notification.id === input.notificationId)) {
        let updated = false;
        demoNotifications = demoNotifications.map((notification) => {
          if (notification.id !== input.notificationId || notification.reviewer !== reviewer) {
            return notification;
          }

          updated = true;
          const { readAt, ...rest } = notification;
          return rest;
        });

        if (!updated) {
          return { ok: false, code: "not_found" };
        }

        const notification = demoNotifications.find(
          (entry) => entry.id === input.notificationId && entry.reviewer === reviewer,
        );

        return notification ? { ok: true, notification } : { ok: false, code: "not_found" };
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const notifications = store.notifications ?? [];
        const existing = notifications.find(
          (notification) =>
            notification.id === input.notificationId && notification.reviewer === reviewer,
        );

        if (!existing) {
          return { ok: false, code: "not_found" };
        }

        const nextNotification = {
          ...existing,
        };
        delete nextNotification.readAt;

        store.notifications = notifications.map((notification) =>
          notification.id === input.notificationId && notification.reviewer === reviewer
            ? nextNotification
            : notification,
        );
        await writeStore(store);
        return { ok: true, notification: nextNotification };
      });
    },

    async applyApprovedProposalItems(input: {
      workbookId: string;
      actor: string;
      note?: string;
    }): Promise<MutationResult> {
      const store = await readStore();
      if (input.workbookId === demoSnapshotState.workbook.id) {
        const auth = await authorizeWorkbookTargetsAction(
          normalizeReviewerSession(
            store.currentReviewerSession,
            normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers),
          ) ?? defaultReviewerSession(normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers)),
          "apply",
          readWorkbookAccessFromStore(store, input.workbookId) ?? undefined,
          input.actor,
          demoSnapshotState.proposal.diff
            .filter((entry) => entry.status === "approved")
            .map((entry) => workbookAccessTargetFromCell(entry.cell)),
        );
        if (!auth.ok) {
          return { ok: false, code: "forbidden" };
        }

        const actor = auth.reviewer.displayName;
        const nextSnapshot = appendApplyResult(demoSnapshotState, actor, input.note);

        if (!nextSnapshot) {
          return mutationFailure(
            demoSnapshotState.proposal.status === "applied"
              ? "already_applied"
              : "nothing_to_apply",
          );
        }

        demoSnapshotState = nextSnapshot;

        addDemoNotification(
          createReviewerNotification({
            reviewer: actor,
            title: "Approved items applied",
            body: `${demoSnapshotState.workbook.name} was advanced to ${nextSnapshot.workbook.latestVersionId}.`,
            action: "proposal.applied",
            createdAt: nextSnapshot.proposal.appliedAt ?? new Date().toISOString(),
            workbookId: input.workbookId,
            proposalId: demoSnapshotState.proposal.id,
          }),
        );
        return mutationSuccess(demoSnapshotState);
      }

      return runSerializedMutation(async () => {
        const store = await readStore();
        const record = store.records.find((entry) => entry.snapshot.workbook.id === input.workbookId);

        if (!record) {
          return mutationFailure("not_found");
        }

        const reviewers = normalizeReviewerProfiles(store.reviewerProfiles ?? store.reviewers);
        const session =
          normalizeReviewerSession(store.currentReviewerSession, reviewers) ??
          defaultReviewerSession(reviewers);
        const auth = await authorizeWorkbookTargetsAction(
          session,
          "apply",
          readWorkbookAccessFromStore(store, input.workbookId) ?? undefined,
          input.actor,
          record.snapshot.proposal.diff
            .filter((entry) => entry.status === "approved")
            .map((entry) => workbookAccessTargetFromCell(entry.cell)),
        );
        if (!auth.ok) {
          return { ok: false, code: "forbidden" };
        }

        const actor = auth.reviewer.displayName;

        const nextSnapshot = appendApplyResult(record.snapshot, actor, input.note);

        if (!nextSnapshot) {
          return mutationFailure(
            record.snapshot.proposal.status === "applied"
              ? "already_applied"
              : "nothing_to_apply",
          );
        }

        record.snapshot = nextSnapshot;

        store.notifications = store.notifications ?? [];
        store.notifications.unshift(
          createReviewerNotification({
            reviewer: actor,
            title: "Approved items applied",
            body: `${record.snapshot.workbook.name} was advanced to ${nextSnapshot.workbook.latestVersionId}.`,
            action: "proposal.applied",
            createdAt: nextSnapshot.proposal.appliedAt ?? new Date().toISOString(),
            workbookId: input.workbookId,
            proposalId: record.snapshot.proposal.id,
          }),
        );
        await writeStore(store);
        return mutationSuccess(record.snapshot);
      });
    },
  };
}
