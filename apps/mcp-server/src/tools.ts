import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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

    return toText(
      [
        "Workbook read placeholder",
        `workbookId: ${parsed.workbookId}`,
        parsed.sheetName ? `sheetName: ${parsed.sheetName}` : "sheetName: all",
        "Next step: connect this tool to workbook metadata, formula graph, and risk summaries.",
      ].join("\n")
    );
  });

  server.tool(toolNames.draftWorkbook, draftWorkbookInputShape, async (input) => {
    const parsed = draftWorkbookInput.parse(input);

    return toText(
      [
        "Workbook draft placeholder",
        parsed.workbookId ? `workbookId: ${parsed.workbookId}` : "workbookId: not provided",
        parsed.targetRange ? `targetRange: ${parsed.targetRange}` : "targetRange: not provided",
        `prompt: ${parsed.prompt}`,
        "Next step: generate a reviewable proposal object instead of mutating workbook state.",
      ].join("\n")
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
        "Workbook apply placeholder",
        `proposalId: ${parsed.proposalId}`,
        "status: approved_for_application",
        "Next step: connect to the write path, audit log, and new workbook version creation.",
      ].join("\n")
    );
  });
}
