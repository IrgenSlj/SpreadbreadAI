import type {
  ReviewerProfile,
  ReviewerRole,
  ReviewerSession,
  WorkbookAccessAssignment,
  WorkbookAccessState,
  WorkbookAccessRole,
} from "../../../packages/shared/src/index.js";
import {
  normalizeWorkbookAccessScopes,
  type WorkbookAccessTarget,
  workbookAccessAssignmentAllowsTarget,
} from "./workbook-access-scope.js";

export type ReviewerPermission =
  | "comment"
  | "item_review"
  | "proposal_review"
  | "apply"
  | "sketch_write"
  | "tag_write"
  | "library_view_write"
  | "workbook_access_write";

const roleRank: Record<ReviewerRole, number> = {
  Analyst: 0,
  Reviewer: 1,
  Approver: 2,
};

const minimumRoleByPermission: Record<ReviewerPermission, ReviewerRole> = {
  comment: "Analyst",
  item_review: "Reviewer",
  proposal_review: "Approver",
  apply: "Approver",
  sketch_write: "Analyst",
  tag_write: "Approver",
  library_view_write: "Approver",
  workbook_access_write: "Approver",
};

const workbookAccessRank: Record<WorkbookAccessRole, number> = {
  editor: 0,
  reviewer: 1,
  approver: 2,
  owner: 3,
};

const minimumWorkbookAccessByPermission: Partial<Record<ReviewerPermission, WorkbookAccessRole>> = {
  comment: "editor",
  item_review: "reviewer",
  proposal_review: "approver",
  apply: "approver",
  sketch_write: "editor",
  tag_write: "approver",
  workbook_access_write: "approver",
};

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function roleValue(role: ReviewerProfile["role"]) {
  return role && role in roleRank ? role : undefined;
}

function workbookAccessValue(role: WorkbookAccessRole | undefined) {
  return role && role in workbookAccessRank ? role : undefined;
}

function assignmentAllowsLocation(
  assignment: WorkbookAccessAssignment,
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

  return workbookAccessAssignmentAllowsTarget(
    {
      scopes,
    },
    target,
  );
}

function matchingAssignments(
  profile: ReviewerProfile,
  workbookAccess?: WorkbookAccessState,
) {
  return (
    workbookAccess?.assignments.filter((entry) =>
      [entry.reviewerProfileId, entry.reviewerHandle, entry.reviewerDisplayName]
        .filter(Boolean)
        .map(normalizeToken)
        .some((candidate) =>
          [profile.id, profile.handle, profile.displayName, profile.email ?? ""]
            .filter(Boolean)
            .map(normalizeToken)
            .includes(candidate),
        ),
    ) ?? []
  );
}

export function reviewerHasPermission(
  profile: ReviewerProfile,
  permission: ReviewerPermission,
): boolean {
  const currentRole = roleValue(profile.role);
  if (!currentRole) {
    return false;
  }

  return roleRank[currentRole] >= roleRank[minimumRoleByPermission[permission]];
}

export function reviewerMatchesActor(profile: ReviewerProfile, actor?: string) {
  if (!actor) {
    return true;
  }

  const normalizedActor = normalizeToken(actor);
  return [
    profile.id,
    profile.handle,
    profile.displayName,
    profile.email ?? "",
  ]
    .filter(Boolean)
    .map(normalizeToken)
    .some((candidate) => candidate === normalizedActor);
}

export function reviewerAssignmentRole(
  profile: ReviewerProfile,
  workbookAccess?: WorkbookAccessState,
): WorkbookAccessRole | undefined {
  const assignment = matchingAssignments(profile, workbookAccess)[0];

  return workbookAccessValue(assignment?.assignmentRole);
}

function matchingAssignment(
  profile: ReviewerProfile,
  workbookAccess?: WorkbookAccessState,
  target?: WorkbookAccessTarget | null,
) {
  return matchingAssignments(profile, workbookAccess).find((entry) =>
    assignmentAllowsLocation(entry, target),
  );
}

export function reviewerHasWorkbookAccess(
  profile: ReviewerProfile,
  permission: ReviewerPermission,
  workbookAccess?: WorkbookAccessState,
  target?: WorkbookAccessTarget | null,
) {
  const minimumAccess = minimumWorkbookAccessByPermission[permission];

  if (!minimumAccess) {
    return true;
  }

  const currentAccess = workbookAccessValue(
    matchingAssignment(profile, workbookAccess, target)?.assignmentRole,
  );
  if (!currentAccess) {
    return false;
  }

  return workbookAccessRank[currentAccess] >= workbookAccessRank[minimumAccess];
}

export function reviewerHasWorkbookTargetsAccess(
  profile: ReviewerProfile,
  permission: ReviewerPermission,
  workbookAccess?: WorkbookAccessState,
  targets?: Array<WorkbookAccessTarget | null | undefined>,
) {
  const minimumAccess = minimumWorkbookAccessByPermission[permission];

  if (!minimumAccess) {
    return true;
  }

  const normalizedTargets = (targets ?? []).filter(
    (target): target is WorkbookAccessTarget => Boolean(target),
  );
  const assignments = matchingAssignments(profile, workbookAccess);

  return assignments.some((assignment) => {
    const currentAccess = workbookAccessValue(assignment.assignmentRole);
    if (!currentAccess) {
      return false;
    }

    if (workbookAccessRank[currentAccess] < workbookAccessRank[minimumAccess]) {
      return false;
    }

    if (normalizedTargets.length === 0) {
      return assignmentAllowsLocation(assignment, null);
    }

    return normalizedTargets.every((target) => assignmentAllowsLocation(assignment, target));
  });
}

export function authorizeReviewerAction(
  session: ReviewerSession | null,
  permission: ReviewerPermission,
  actor?: string,
):
  | { ok: true; reviewer: ReviewerProfile }
  | { ok: false; code: "forbidden" } {
  const reviewer = session?.currentProfile;

  if (!reviewer || !reviewer.active) {
    return { ok: false, code: "forbidden" };
  }

  if (!reviewerHasPermission(reviewer, permission)) {
    return { ok: false, code: "forbidden" };
  }

  if (!reviewerMatchesActor(reviewer, actor)) {
    return { ok: false, code: "forbidden" };
  }

  return { ok: true, reviewer };
}

export function authorizeWorkbookAction(
  session: ReviewerSession | null,
  permission: ReviewerPermission,
  workbookAccess?: WorkbookAccessState,
  actor?: string,
  target?: WorkbookAccessTarget | null,
):
  | { ok: true; reviewer: ReviewerProfile; assignmentRole?: WorkbookAccessRole }
  | { ok: false; code: "forbidden" } {
  const base = authorizeReviewerAction(session, permission, actor);
  if (!base.ok) {
    return base;
  }

  if (!reviewerHasWorkbookAccess(base.reviewer, permission, workbookAccess, target)) {
    return { ok: false, code: "forbidden" };
  }

  return {
    ok: true,
    reviewer: base.reviewer,
    assignmentRole: workbookAccessValue(
      matchingAssignment(base.reviewer, workbookAccess, target)?.assignmentRole,
    ),
  };
}

export function authorizeWorkbookTargetsAction(
  session: ReviewerSession | null,
  permission: ReviewerPermission,
  workbookAccess?: WorkbookAccessState,
  actor?: string,
  targets?: Array<WorkbookAccessTarget | null | undefined>,
):
  | { ok: true; reviewer: ReviewerProfile; assignmentRole?: WorkbookAccessRole }
  | { ok: false; code: "forbidden" } {
  const base = authorizeReviewerAction(session, permission, actor);
  if (!base.ok) {
    return base;
  }

  if (!reviewerHasWorkbookTargetsAccess(base.reviewer, permission, workbookAccess, targets)) {
    return { ok: false, code: "forbidden" };
  }

  const normalizedTargets = (targets ?? []).filter(
    (target): target is WorkbookAccessTarget => Boolean(target),
  );
  const assignment = matchingAssignments(base.reviewer, workbookAccess).find((entry) =>
    normalizedTargets.length === 0
      ? assignmentAllowsLocation(entry, null)
      : normalizedTargets.every((target) => assignmentAllowsLocation(entry, target)),
  );

  return {
    ok: true,
    reviewer: base.reviewer,
    assignmentRole: workbookAccessValue(assignment?.assignmentRole),
  };
}
