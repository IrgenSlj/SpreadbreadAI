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
5. user approves or rejects proposal items
6. approved items can be applied into a new workbook version

The current implementation is a local prototype, not a production service. It already supports upload, parsing, proposal generation, item-level review, and a first integrity-hardening pass on approval/apply behavior.

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
- applying approved proposal items

The sketchpad section is still only a placeholder UI and should be replaced with a real collaborative canvas.

### Backend

`apps/mcp-server` currently supports:

- stdio MCP server
- local HTTP API
- persisted disk store under `apps/mcp-server/.data/`
- upload endpoint storing raw workbook bytes
- workbook parsing via open-source `xlsx`
- generated review snapshots from parsed workbook metadata
- item-level proposal decisions
- apply flow that creates a new workbook version

Current HTTP endpoints:

- `GET /healthz`
- `GET /api/workbooks`
- `GET /api/workbooks/:id/review`
- `POST /api/workbooks/upload`
- `POST /api/workbooks/:id/proposal/decision`
- `POST /api/workbooks/:id/proposal/items/:diffId/decision`
- `POST /api/workbooks/:id/proposal/apply`

### MCP

Current MCP tools:

- `workbook.read`
- `workbook.draft`
- `workbook.apply`

Important:

- `workbook.read` is real enough to inspect stored review snapshots
- `workbook.draft` and `workbook.apply` are still prototype paths
- approval and write enforcement still need full integrity hardening

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
- persistence still uses mutable snapshots rather than first-class relational records
- approval semantics are now partially hardened, but the platform still needs a canonical proposal/item/apply state machine
- request validation is improved, but still not backed by a full domain schema layer across all surfaces
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

1. persist workbook, proposal, item, version, and audit records in PostgreSQL
2. finish the canonical approval/apply state machine and enforce it through one relational model
3. enrich parsed workbook intelligence:
   named ranges, sample values, sheet previews, formula/error summaries, dependency graphs
4. implement a real collaborative sketchpad:
   Excalidraw integration linked to workbook entities
5. expose a fuller MCP contract for workbook, proposal, and sketch operations

## Current Git State Expectation

The repo should have:

- private GitHub remote at `origin`
- branch `main`

Before starting work, check:

- `git status --short --branch`
- `git remote -v`
- `gh auth status`

If you continue implementation, prefer small commits after each validated slice.
