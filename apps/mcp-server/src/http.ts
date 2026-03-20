import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { ApprovalDecision } from "../../../packages/shared/src/index.js";
import { serverName, serverVersion } from "./server.js";
import {
  getStoredWorkbookReview,
  listStoredWorkbooks,
  saveUploadedWorkbook,
  updateStoredProposalDecision,
} from "./store.js";

const defaultPort = Number.parseInt(process.env.PORT ?? "4242", 10);
const defaultHost = process.env.HOST ?? "127.0.0.1";

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

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const bytes = await readRequestBody(request);
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
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
    sendJson(response, 200, {
      status: "ok",
      name: serverName,
      version: serverVersion,
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/workbooks") {
    const workbooks = await listStoredWorkbooks();
    sendJson(response, 200, { workbooks });
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/api/workbooks/")) {
    const workbookId = decodeURIComponent(
      url.pathname.replace("/api/workbooks/", "").replace(/\/review$/, ""),
    );
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
    const fileName = Array.isArray(fileNameHeader)
      ? fileNameHeader[0]
      : fileNameHeader;

    if (!fileName) {
      sendJson(response, 400, { error: "Missing X-File-Name header" });
      return;
    }

    const bytes = await readRequestBody(request);

    if (bytes.byteLength === 0) {
      sendJson(response, 400, { error: "Upload body is empty" });
      return;
    }

    const record = await saveUploadedWorkbook({
      fileName: decodeURIComponent(fileName),
      contentType: request.headers["content-type"] ?? "application/octet-stream",
      bytes,
    });

    sendJson(response, 201, {
      workbookId: record.snapshot.workbook.id,
      review: record.snapshot,
    });
    return;
  }

  if (method === "POST" && url.pathname.match(/^\/api\/workbooks\/[^/]+\/proposal\/decision$/)) {
    const workbookId = decodeURIComponent(
      url.pathname.replace("/api/workbooks/", "").replace(/\/proposal\/decision$/, ""),
    );
    const body = await readJsonBody<{
      decision?: ApprovalDecision;
      reviewer?: string;
      comment?: string;
    }>(request);

    if (body.decision !== "approve" && body.decision !== "reject") {
      sendJson(response, 400, { error: "Invalid decision" });
      return;
    }

    if (!body.reviewer || body.reviewer.trim().length === 0) {
      sendJson(response, 400, { error: "Reviewer is required" });
      return;
    }

    const review = await updateStoredProposalDecision({
      workbookId,
      decision: body.decision,
      reviewer: body.reviewer.trim(),
      comment: body.comment?.trim(),
    });

    if (!review) {
      sendJson(response, 404, { error: "Workbook not found" });
      return;
    }

    sendJson(response, 200, { review });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

export function startHttpServer(port = defaultPort, host = defaultHost) {
  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error("[http-server] request failed", error);
      sendJson(response, 500, { error: "Internal server error" });
    });
  });

  server.listen(port, host, () => {
    console.log(`[http-server] listening on http://${host}:${port}`);
  });

  return server;
}
