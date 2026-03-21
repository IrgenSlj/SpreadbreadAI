import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { URL } from "node:url";
import { z } from "zod";
import { serverName, serverVersion } from "./server.js";
import {
  archiveStoredWorkbookLibraryView,
  applyApprovedProposalItems,
  appendStoredProposalItemComment,
  deleteStoredWorkbookLibraryView,
  getStoredWorkbookTags,
  getStoredSketchBoard,
  getStoredWorkbookReview,
  getStoreRuntimeStatus,
  listStoredWorkbooks,
  listStoredWorkbookLibraryViews,
  listReviewerNotifications,
  type LibraryViewDeletionResult,
  type MutationResult,
  type LibraryViewMutationResult,
  markReviewerNotificationRead,
  markReviewerNotificationUnread,
  type ReviewerNotificationMutationResult,
  type TagsMutationResult,
  saveUploadedWorkbook,
  saveStoredWorkbookLibraryView,
  type SketchBoardMutationResult,
  updateStoredProposalItemDecision,
  updateStoredProposalDecision,
  updateStoredWorkbookTags,
  updateStoredSketchBoard,
} from "./store.js";

const defaultPort = Number.parseInt(process.env.PORT ?? "4242", 10);
const defaultHost = process.env.HOST ?? "127.0.0.1";
const maxUploadBytes = Number.parseInt(
  process.env.MAX_UPLOAD_BYTES ?? String(10 * 1024 * 1024),
  10,
);
const allowedUploadExtensions = new Set([".csv", ".xls", ".xlsx"]);

const proposalDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reviewer: z.string().trim().min(1),
  comment: z.string().trim().optional(),
});

const proposalCommentSchema = z.object({
  author: z.string().trim().min(1),
  body: z.string().trim().min(1).max(4000),
  parentCommentId: z.string().trim().min(1).optional(),
  replyToCommentId: z.string().trim().min(1).optional(),
  mentions: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
});

const applySchema = z.object({
  actor: z.string().trim().min(1),
  note: z.string().trim().optional(),
});

const sketchNodeSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1).max(120),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  color: z.string().trim().min(1).max(40).optional(),
  linkKind: z.enum(["sheet", "proposal", "risk"]).optional(),
  linkTargetId: z.string().trim().min(1).optional(),
});

const sketchLinkSchema = z.object({
  id: z.string().trim().min(1),
  fromNodeId: z.string().trim().min(1),
  toNodeId: z.string().trim().min(1),
  label: z.string().trim().max(120).optional(),
});

const sketchBoardSchema = z.object({
  title: z.string().trim().min(1).max(120),
  updatedBy: z.string().trim().min(1),
  notes: z.string().trim().max(4000).optional(),
  nodes: z.array(sketchNodeSchema).max(40),
  links: z.array(sketchLinkSchema).max(80),
});

const workbookTagsSchema = z.object({
  updatedBy: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1).max(48)).max(32),
});

const libraryViewSchema = z.object({
  name: z.string().trim().min(1).max(120),
  updatedBy: z.string().trim().min(1),
  description: z.string().trim().max(500).optional(),
  searchQuery: z.string().trim().max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(48)).max(32),
  sortBy: z.enum(["createdAt", "lastReviewedAt", "name", "sheetCount"]),
  sortDirection: z.enum(["asc", "desc"]),
  pinned: z.boolean().optional(),
});

const libraryViewArchiveSchema = z.object({
  archivedBy: z.string().trim().min(1),
});

const reviewerNotificationsQuerySchema = z.object({
  reviewer: z.string().trim().min(1),
  includeRead: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

const reviewerNotificationStateSchema = z.object({
  reviewer: z.string().trim().min(1),
});

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function withCors(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-File-Name");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  withCors(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body, null, 2));
}

async function readRequestBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > maxUploadBytes) {
      throw new HttpError(413, `Upload exceeds the ${maxUploadBytes} byte limit`);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const bytes = await readRequestBody(request);

  if (bytes.byteLength === 0) {
    throw new HttpError(400, "Request body is required");
  }

  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

async function readValidatedJsonBody<T>(
  request: IncomingMessage,
  schema: z.ZodType<T>,
): Promise<T> {
  const body = await readJsonBody(request);
  const result = schema.safeParse(body);

  if (!result.success) {
    throw new HttpError(
      400,
      result.error.issues.map((issue) => issue.message).join("; "),
    );
  }

  return result.data;
}

function sendMutationResult(
  response: ServerResponse,
  result: MutationResult,
  notFoundMessage: string,
  options?: { itemNotFoundMessage?: string; commentNotFoundMessage?: string },
) {
  if (result.ok) {
    sendJson(response, 200, { review: result.review });
    return;
  }

  const itemNotFoundMessage = options?.itemNotFoundMessage ?? notFoundMessage;
  const commentNotFoundMessage = options?.commentNotFoundMessage ?? notFoundMessage;

  switch (result.code) {
    case "not_found":
    case "item_not_found":
      sendJson(
        response,
        404,
        { error: result.code === "not_found" ? notFoundMessage : itemNotFoundMessage },
      );
      return;
    case "comment_not_found":
      sendJson(response, 404, { error: commentNotFoundMessage });
      return;
    case "already_applied":
      sendJson(response, 409, { error: "Proposal has already been applied" });
      return;
    case "locked":
      sendJson(response, 409, {
        error: "Applied proposals are locked from further review changes",
      });
      return;
    case "review_path_locked":
      sendJson(response, 409, {
        error: "Whole-proposal approval is unavailable after item-level review has started",
      });
      return;
    case "nothing_to_apply":
      sendJson(response, 409, { error: "No approved proposal items available to apply" });
      return;
  }
}

function sendSketchBoardResult(
  response: ServerResponse,
  result: SketchBoardMutationResult | null,
  notFoundMessage: string,
) {
  if (!result) {
    sendJson(response, 404, { error: notFoundMessage });
    return;
  }

  if (result.ok) {
    sendJson(response, 200, { sketchBoard: result.sketchBoard });
    return;
  }

  sendJson(response, 404, { error: notFoundMessage });
}

function sendTagsResult(
  response: ServerResponse,
  result: TagsMutationResult,
  notFoundMessage: string,
) {
  if (result.ok) {
    sendJson(response, 200, { tags: result.tags });
    return;
  }

  sendJson(response, 404, { error: notFoundMessage });
}

function sendLibraryViewResult(
  response: ServerResponse,
  result: LibraryViewMutationResult,
  notFoundMessage: string,
) {
  if (result.ok) {
    sendJson(response, 200, { view: result.view });
    return;
  }

  sendJson(response, 404, { error: notFoundMessage });
}

function sendLibraryViewDeleteResult(
  response: ServerResponse,
  result: LibraryViewDeletionResult,
  notFoundMessage: string,
) {
  if (result.ok) {
    sendJson(response, 200, { deletedId: result.deletedId });
    return;
  }

  sendJson(response, 404, { error: notFoundMessage });
}

function sendReviewerNotificationResult(
  response: ServerResponse,
  result: ReviewerNotificationMutationResult,
  notFoundMessage: string,
) {
  if (result.ok) {
    sendJson(response, 200, { notification: result.notification });
    return;
  }

  sendJson(response, 404, { error: notFoundMessage });
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (method === "OPTIONS") {
    withCors(response);
    response.statusCode = 204;
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/healthz") {
    const runtime = await getStoreRuntimeStatus();
    sendJson(response, 200, {
      status: "ok",
      name: serverName,
      version: serverVersion,
      storageMode: runtime.mode,
      workbookCount: runtime.workbookCount,
    });
    return;
  }

  if (
    method === "GET" &&
    (url.pathname === "/api/system/status" || url.pathname === "/api/runtime/status")
  ) {
    const runtime = await getStoreRuntimeStatus();
    sendJson(response, 200, {
      status: "ok",
      name: serverName,
      version: serverVersion,
      runtime,
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/workbooks") {
    const workbooks = await listStoredWorkbooks();
    sendJson(response, 200, { workbooks });
    return;
  }

  const reviewMatch = url.pathname.match(/^\/api\/workbooks\/([^/]+)\/review$/);
  if (method === "GET" && reviewMatch) {
    const workbookId = decodeURIComponent(reviewMatch[1]);
    const review = await getStoredWorkbookReview(workbookId);

    if (!review) {
      sendJson(response, 404, { error: "Workbook not found" });
      return;
    }

    sendJson(response, 200, { review });
    return;
  }

  const tagsMatch = url.pathname.match(/^\/api\/workbooks\/([^/]+)\/tags$/);
  if (method === "GET" && tagsMatch) {
    const workbookId = decodeURIComponent(tagsMatch[1]);
    const tags = await getStoredWorkbookTags(workbookId);

    if (!tags) {
      sendJson(response, 404, { error: "Workbook not found" });
      return;
    }

    sendJson(response, 200, { workbookId, tags });
    return;
  }

  if (method === "PUT" && tagsMatch) {
    const workbookId = decodeURIComponent(tagsMatch[1]);
    const body = await readValidatedJsonBody(request, workbookTagsSchema);
    const result = await updateStoredWorkbookTags({
      workbookId,
      tags: body.tags,
      updatedBy: body.updatedBy,
    });

    sendTagsResult(response, result, "Workbook not found");
    return;
  }

  const sketchBoardMatch = url.pathname.match(/^\/api\/workbooks\/([^/]+)\/sketch$/);
  if (method === "GET" && sketchBoardMatch) {
    const workbookId = decodeURIComponent(sketchBoardMatch[1]);
    const sketchBoard = await getStoredSketchBoard(workbookId);

    if (!sketchBoard) {
      sendJson(response, 404, { error: "Workbook sketch board not found" });
      return;
    }

    sendJson(response, 200, { sketchBoard });
    return;
  }

  if (method === "PUT" && sketchBoardMatch) {
    const workbookId = decodeURIComponent(sketchBoardMatch[1]);
    const body = await readValidatedJsonBody(request, sketchBoardSchema);
    const result = await updateStoredSketchBoard({
      workbookId,
      title: body.title,
      updatedBy: body.updatedBy,
      nodes: body.nodes,
      links: body.links,
      notes: body.notes,
    });

    sendSketchBoardResult(response, result, "Workbook sketch board not found");
    return;
  }

  if (method === "GET" && url.pathname === "/api/library/views") {
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const views = await listStoredWorkbookLibraryViews({ includeArchived });
    sendJson(response, 200, { views });
    return;
  }

  const libraryViewMatch = url.pathname.match(/^\/api\/library\/views\/([^/]+)$/);
  const libraryViewArchiveMatch = url.pathname.match(/^\/api\/library\/views\/([^/]+)\/archive$/);
  if (method === "PUT" && libraryViewMatch) {
    const viewId = decodeURIComponent(libraryViewMatch[1]);
    const body = await readValidatedJsonBody(request, libraryViewSchema);
    const result = await saveStoredWorkbookLibraryView({
      id: viewId,
      name: body.name,
      updatedBy: body.updatedBy,
      description: body.description,
      searchQuery: body.searchQuery,
      tags: body.tags,
      sortBy: body.sortBy,
      sortDirection: body.sortDirection,
      pinned: body.pinned,
    });

    sendLibraryViewResult(response, result, "Workbook library view not found");
    return;
  }

  if (method === "POST" && libraryViewArchiveMatch) {
    const viewId = decodeURIComponent(libraryViewArchiveMatch[1]);
    const body = await readValidatedJsonBody(request, libraryViewArchiveSchema);
    const result = await archiveStoredWorkbookLibraryView({
      id: viewId,
      archivedBy: body.archivedBy,
    });

    sendLibraryViewResult(response, result, "Workbook library view not found");
    return;
  }

  if (method === "DELETE" && libraryViewMatch) {
    const viewId = decodeURIComponent(libraryViewMatch[1]);
    const result = await deleteStoredWorkbookLibraryView({ id: viewId });

    sendLibraryViewDeleteResult(response, result, "Workbook library view not found");
    return;
  }

  if (method === "GET" && url.pathname === "/api/reviewer-notifications") {
    const parsed = reviewerNotificationsQuerySchema.safeParse({
      reviewer: url.searchParams.get("reviewer") ?? "",
      includeRead: url.searchParams.get("includeRead") ?? undefined,
    });

    if (!parsed.success) {
      sendJson(response, 400, {
        error: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
      return;
    }

    const feed = await listReviewerNotifications({
      reviewer: parsed.data.reviewer,
      includeRead: parsed.data.includeRead,
    });

    sendJson(response, 200, feed);
    return;
  }

  const reviewerNotificationReadMatch = url.pathname.match(
    /^\/api\/reviewer-notifications\/([^/]+)\/read$/,
  );
  if (method === "POST" && reviewerNotificationReadMatch) {
    const notificationId = decodeURIComponent(reviewerNotificationReadMatch[1]);
    const body = await readValidatedJsonBody(request, reviewerNotificationStateSchema);
    const result = await markReviewerNotificationRead({
      notificationId,
      reviewer: body.reviewer,
    });

    sendReviewerNotificationResult(response, result, "Reviewer notification not found");
    return;
  }

  const reviewerNotificationUnreadMatch = url.pathname.match(
    /^\/api\/reviewer-notifications\/([^/]+)\/unread$/,
  );
  if (method === "POST" && reviewerNotificationUnreadMatch) {
    const notificationId = decodeURIComponent(reviewerNotificationUnreadMatch[1]);
    const body = await readValidatedJsonBody(request, reviewerNotificationStateSchema);
    const result = await markReviewerNotificationUnread({
      notificationId,
      reviewer: body.reviewer,
    });

    sendReviewerNotificationResult(response, result, "Reviewer notification not found");
    return;
  }

  if (method === "POST" && url.pathname === "/api/workbooks/upload") {
    const fileNameHeader = request.headers["x-file-name"];
    const fileName = Array.isArray(fileNameHeader) ? fileNameHeader[0] : fileNameHeader;

    if (!fileName) {
      sendJson(response, 400, { error: "Missing X-File-Name header" });
      return;
    }

    const decodedFileName = decodeURIComponent(fileName);
    const extension = path.extname(decodedFileName).toLowerCase();

    if (!allowedUploadExtensions.has(extension)) {
      sendJson(response, 415, {
        error: "Unsupported file type. Upload .xlsx, .xls, or .csv files only.",
      });
      return;
    }

    const bytes = await readRequestBody(request);

    if (bytes.byteLength === 0) {
      sendJson(response, 400, { error: "Upload body is empty" });
      return;
    }

    const record = await saveUploadedWorkbook({
      fileName: decodedFileName,
      contentType: request.headers["content-type"] ?? "application/octet-stream",
      bytes,
    });

    sendJson(response, 201, {
      workbookId: record.snapshot.workbook.id,
      review: record.snapshot,
    });
    return;
  }

  const proposalDecisionMatch = url.pathname.match(
    /^\/api\/workbooks\/([^/]+)\/proposal\/decision$/,
  );
  if (method === "POST" && proposalDecisionMatch) {
    const workbookId = decodeURIComponent(proposalDecisionMatch[1]);
    const body = await readValidatedJsonBody(request, proposalDecisionSchema);
    const result = await updateStoredProposalDecision({
      workbookId,
      decision: body.decision,
      reviewer: body.reviewer,
      comment: body.comment,
    });

    sendMutationResult(response, result, "Workbook not found");
    return;
  }

  const itemDecisionMatch = url.pathname.match(
    /^\/api\/workbooks\/([^/]+)\/proposal\/items\/([^/]+)\/decision$/,
  );
  if (method === "POST" && itemDecisionMatch) {
    const workbookId = decodeURIComponent(itemDecisionMatch[1]);
    const diffId = decodeURIComponent(itemDecisionMatch[2]);
    const body = await readValidatedJsonBody(request, proposalDecisionSchema);
    const result = await updateStoredProposalItemDecision({
      workbookId,
      diffId,
      decision: body.decision,
      reviewer: body.reviewer,
      comment: body.comment,
    });

    sendMutationResult(response, result, "Workbook or proposal item not found");
    return;
  }

  const itemCommentMatch = url.pathname.match(
    /^\/api\/workbooks\/([^/]+)\/proposal\/items\/([^/]+)\/comments$/,
  );
  if (method === "POST" && itemCommentMatch) {
    const workbookId = decodeURIComponent(itemCommentMatch[1]);
    const diffId = decodeURIComponent(itemCommentMatch[2]);
    const body = await readValidatedJsonBody(request, proposalCommentSchema);
    const result = await appendStoredProposalItemComment({
      workbookId,
      diffId,
      author: body.author,
      body: body.body,
      parentCommentId: body.parentCommentId,
      replyToCommentId: body.replyToCommentId,
      mentions: body.mentions,
    });

    sendMutationResult(response, result, "Workbook or proposal item not found", {
      itemNotFoundMessage: "Workbook or proposal item not found",
      commentNotFoundMessage: "Parent comment not found",
    });
    return;
  }

  const applyMatch = url.pathname.match(/^\/api\/workbooks\/([^/]+)\/proposal\/apply$/);
  if (method === "POST" && applyMatch) {
    const workbookId = decodeURIComponent(applyMatch[1]);
    const body = await readValidatedJsonBody(request, applySchema);
    const result = await applyApprovedProposalItems({
      workbookId,
      actor: body.actor,
      note: body.note,
    });

    sendMutationResult(response, result, "Workbook not found");
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

export function startHttpServer(port = defaultPort, host = defaultHost) {
  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (error instanceof HttpError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }

      console.error("[http-server] request failed", error);
      sendJson(response, 500, { error: "Internal server error" });
    });
  });

  server.listen(port, host, () => {
    console.log(`[http-server] listening on http://${host}:${port}`);
  });

  return server;
}
