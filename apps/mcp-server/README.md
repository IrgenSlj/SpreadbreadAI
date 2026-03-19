# MCP Server

TypeScript MCP server scaffold for workbook automation.

## Scripts

- `pnpm --filter @spreadbreadai/mcp-server start`
- `pnpm --filter @spreadbreadai/mcp-server dev`
- `pnpm --filter @spreadbreadai/mcp-server health`
- `pnpm --filter @spreadbreadai/mcp-server build`

## Tool Surface

- `workbook.read` for workbook inspection
- `workbook.draft` for proposal creation
- `workbook.apply` for approval-gated application

The current implementation is intentionally minimal. It wires a real stdio MCP server and returns explicit placeholder responses so the next phase can replace them with workbook metadata, proposal storage, and the approval workflow.
