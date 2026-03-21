import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { URL } from "node:url";
import { z } from "zod";
import { serverName, serverVersion } from "./server.js";
import {
  applyApprovedProposalItems,
  getStoredWorkbookReview,
  getStoreRuntimeStatus,
  listStoredWorkbooks,
  type MutationResult,
  saveUploadedWorkbook,
  updateStoredProposalItemDecision,
  updateStoredProposalDecision,
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

const applySchema = z.object({
  actor: z.string().trim().min(1),
  note: z.string().trim().optional(),
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
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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
) {
  if (result.ok) {
    sendJson(response, 200, { review: result.review });
    return;
  }

  switch (result.code) {
    case "not_found":
    case "item_not_found":
      sendJson(response, 404, { error: notFoundMessage });
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
