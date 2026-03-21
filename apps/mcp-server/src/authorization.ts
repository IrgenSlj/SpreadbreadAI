import type {
  ReviewerProfile,
  ReviewerRole,
  ReviewerSession,
} from "../../../packages/shared/src/index.js";

export type ReviewerPermission =
  | "comment"
  | "item_review"
  | "proposal_review"
  | "apply"
  | "sketch_write"
  | "tag_write"
  | "library_view_write";

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
};

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function roleValue(role: ReviewerProfile["role"]) {
  return role && role in roleRank ? role : undefined;
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
