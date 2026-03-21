# MCP Server

TypeScript MCP server scaffold for workbook automation.

## Scripts

- `pnpm --filter @spreadbreadai/mcp-server start`
- `pnpm --filter @spreadbreadai/mcp-server dev`
- `pnpm --filter @spreadbreadai/mcp-server start:http`
- `pnpm --filter @spreadbreadai/mcp-server dev:http`
- `pnpm --filter @spreadbreadai/mcp-server db:init`
- `pnpm --filter @spreadbreadai/mcp-server health`
- `pnpm --filter @spreadbreadai/mcp-server build`

## Tool Surface

- `workbook.read` for workbook inspection
- `workbook.draft` for proposal creation
- `workbook.apply` for approval-gated application

The current local prototype also exposes a small HTTP API for workbook upload, review lookup, proposal decisions, and apply actions.

The current implementation now supports two persistence modes behind the same store API:

- local file-backed storage by default
- PostgreSQL-backed storage when `DATABASE_URL` is set

The PostgreSQL path stores first-class workbook, version, proposal, item, and audit rows instead of one mutable JSON snapshot.

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

## PostgreSQL

Set `DATABASE_URL` to switch the backend to PostgreSQL, then initialize the schema:

```bash
cd apps/mcp-server && DATABASE_URL=postgres://... node --import tsx src/db-init.ts
```

The initial schema lives in `apps/mcp-server/sql/001_initial_schema.sql`.
