# MCP Server

TypeScript MCP server scaffold for workbook automation.

## Scripts

- `pnpm --filter @spreadbreadai/mcp-server start`
- `pnpm --filter @spreadbreadai/mcp-server dev`
- `pnpm --filter @spreadbreadai/mcp-server start:http`
- `pnpm --filter @spreadbreadai/mcp-server dev:http`
- `pnpm --filter @spreadbreadai/mcp-server health`
- `pnpm --filter @spreadbreadai/mcp-server build`

## Tool Surface

- `workbook.read` for workbook inspection
- `workbook.draft` for proposal creation
- `workbook.apply` for approval-gated application

The current local prototype also exposes a small HTTP API for workbook upload, review lookup, proposal decisions, and apply actions.

The current implementation is intentionally minimal. It wires a real stdio MCP server and a local HTTP API, but the workflow still needs stronger validation, idempotency, and persistence in PostgreSQL.

## Local HTTP API

The local server exposes:

- `GET /healthz`
- `GET /api/workbooks`
- `GET /api/workbooks/:id/review`
- `POST /api/workbooks/upload`
- `POST /api/workbooks/:id/proposal/decision`
- `POST /api/workbooks/:id/proposal/items/:diffId/decision`
- `POST /api/workbooks/:id/proposal/apply`

Uploads are stored under `apps/mcp-server/.data/` and are ignored by git.
