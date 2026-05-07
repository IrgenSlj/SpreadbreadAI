import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatSnapshotForMcp } from "../../../packages/shared/src/index.js";
import { z } from "zod";
import { getStoredWorkbookReview, listStoredWorkbooks } from "./store.js";

export const toolNames = {
  readWorkbook: "workbook.read",
  draftWorkbook: "workbook.draft",
  applyWorkbook: "workbook.apply",
} as const;

const readWorkbookInputShape = {
  workbookId: z.string().min(1),
  sheetName: z.string().min(1).optional(),
};
const readWorkbookInput = z.object(readWorkbookInputShape).strict();

const draftWorkbookInputShape = {
  workbookId: z.string().min(1).optional(),
  prompt: z.string().min(1),
  targetRange: z.string().min(1).optional(),
};
const draftWorkbookInput = z.object(draftWorkbookInputShape).strict();

const applyWorkbookInputShape = {
  proposalId: z.string().min(1),
  approvalToken: z.string().min(1).optional(),
};
const applyWorkbookInput = z.object(applyWorkbookInputShape).strict();

function toText(message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
  };
}

export function registerWorkbookTools(server: McpServer) {
  server.tool(toolNames.readWorkbook, readWorkbookInputShape, async (input) => {
    const parsed = readWorkbookInput.parse(input);
    const snapshot = await getStoredWorkbookReview(parsed.workbookId);

    if (!snapshot) {
      const workbooks = await listStoredWorkbooks();

      return toText(
        [
          "Workbook not found",
          `workbookId: ${parsed.workbookId}`,
          `availableWorkbooks: ${workbooks.map((workbook) => workbook.id).join(", ")}`,
        ].join("\n"),
      );
    }

    return toText(formatSnapshotForMcp(snapshot, parsed.sheetName));
  });

  server.tool(toolNames.draftWorkbook, draftWorkbookInputShape, async (input) => {
    const parsed = draftWorkbookInput.parse(input);
    const snapshot = parsed.workbookId
      ? await getStoredWorkbookReview(parsed.workbookId)
      : null;

    return toText(
      [
        "Workbook draft proposal created",
        parsed.workbookId ? `workbookId: ${parsed.workbookId}` : "workbookId: not provided",
        parsed.targetRange ? `targetRange: ${parsed.targetRange}` : "targetRange: not provided",
        `prompt: ${parsed.prompt}`,
        snapshot ? `seedProposalId: ${snapshot.proposal.id}` : "seedProposalId: unavailable",
        "status: draft_only",
        "Next step: persist a proposal object and route it to approval review.",
      ].join("\n"),
    );
  });

  server.tool(toolNames.applyWorkbook, applyWorkbookInputShape, async (input) => {
    const parsed = applyWorkbookInput.parse(input);

    if (!parsed.approvalToken) {
      return toText(
        [
          "Workbook apply placeholder",
          `proposalId: ${parsed.proposalId}`,
          "status: blocked",
          "reason: approval token missing",
          "Next step: wire this tool to the platform approval gate and workbook versioning layer.",
        ].join("\n")
      );
    }

    return toText(
      [
        "Workbook apply request accepted",
        `proposalId: ${parsed.proposalId}`,
        "status: approved_for_application",
        "Next step: connect to the write path, audit log, and new workbook version creation.",
      ].join("\n"),
    );
  });
}
