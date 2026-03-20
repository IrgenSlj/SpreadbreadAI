# SpreadbreadAI Agent Handoff

## Mission

SpreadbreadAI is an open-source, human-in-the-loop spreadsheet operations platform.

The product is not a generic spreadsheet chat assistant. It is a governed control plane for spreadsheet-heavy business workflows where:

- AI inspects workbooks
- AI drafts proposals and commentary
- humans review diffs and approve writes
- the platform owns policy, audit, and versioning

## Current Product Direction

Primary wedge:

- FP&A / finance workbook review and reconciliation

Core interaction model:

1. user uploads a workbook
2. platform parses workbook structure
3. AI or system creates a review snapshot and draft proposal
4. user reviews risks, diffs, and audit trail
5. future apply/write paths must remain approval-gated

## Repository Layout

- `apps/web`
  React + Vite frontend for workbook review, proposals, audit trail, and sketchpad
- `apps/mcp-server`
  MCP server plus local HTTP API and disk-backed workbook store
- `packages/shared`
  shared domain types and helper functions
- `docs/`
  PRD, roadmap, architecture, implementation plan

## What Exists Today

### Frontend

`apps/web` currently supports:

- loading workbook list from local API
- uploading `.xlsx`, `.xls`, and `.csv`
- viewing workbook review metadata
- viewing proposal summary and diff
- viewing audit trail
- switching between persisted workbook snapshots

The sketchpad section is still only a placeholder UI.

### Backend

`apps/mcp-server` currently supports:

- stdio MCP server
- local HTTP API
- persisted disk store under `apps/mcp-server/.data/`
- upload endpoint storing raw workbook bytes
- workbook parsing via open-source `xlsx`
- generated review snapshots from parsed workbook metadata

Current HTTP endpoints:

- `GET /healthz`
- `GET /api/workbooks`
- `GET /api/workbooks/:id/review`
- `POST /api/workbooks/upload`

### MCP

Current MCP tools:

- `workbook.read`
- `workbook.draft`
- `workbook.apply`

Important:

- `workbook.read` is real enough to inspect stored review snapshots
- `workbook.draft` and `workbook.apply` are still placeholder paths
- approval and write enforcement still need full implementation

## Key Files

- `packages/shared/src/index.ts`
  shared domain model
- `apps/mcp-server/src/parser.ts`
  workbook parsing and heuristic review generation
- `apps/mcp-server/src/store.ts`
  persisted local workbook store
- `apps/mcp-server/src/http.ts`
  local HTTP API
- `apps/mcp-server/src/tools.ts`
  MCP tool layer
- `apps/web/src/App.tsx`
  current main review UI

## Working Rules For Future Agents

- Preserve the human-in-the-loop architecture.
- Do not add any direct AI write path that bypasses approval.
- Keep the product model-agnostic. Claude Code and Codex are clients, not the core.
- Treat workbook versions, proposals, diffs, and audit events as first-class entities.
- Prefer extending the shared domain model before adding app-specific ad hoc shapes.
- Keep runtime data out of git. `apps/mcp-server/.data/` is ignored.
- Verify both frontend and backend after meaningful changes.

## Current Technical Constraints

- persistence is still local JSON + raw file storage, not a database
- workbook parsing is structural and heuristic, not a full formula graph engine
- proposal generation is still seeded from parsed metadata, not model-driven
- sketchpad is not implemented yet
- there is no real auth, tenancy, or RBAC yet

## Useful Verification Commands

From repo root:

- web typecheck:
  `cd apps/web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
- web build:
  `cd apps/web && ./node_modules/.bin/vite build`
- backend compile:
  `cd apps/mcp-server && ./node_modules/.bin/tsc -p tsconfig.json`
- MCP health:
  `cd apps/mcp-server && node --import tsx src/health.ts`
- local HTTP server:
  `cd apps/mcp-server && node --import tsx src/http-main.ts`

## Recommended Next Steps

Near-term priority order:

1. enrich parsed workbook intelligence:
   named ranges, sample values, sheet previews, formula/error summaries
2. persist to a real database:
   PostgreSQL for workbooks, proposals, approvals, audits
3. implement real proposal objects:
   reviewable proposal creation from workbook findings
4. add approval workflow:
   approve/reject state transitions and audit events
5. implement sketchpad:
   Excalidraw integration linked to workbook entities

## Current Git State Expectation

The repo should have:

- private GitHub remote at `origin`
- branch `main`

Before starting work, check:

- `git status --short --branch`
- `git remote -v`
- `gh auth status`

If you continue implementation, prefer small commits after each validated slice.
