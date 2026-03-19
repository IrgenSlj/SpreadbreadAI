# SpreadbreadAI

SpreadbreadAI is an open-source, human-in-the-loop spreadsheet operations platform for teams that still run critical parts of the business in spreadsheets.

The product direction is not "chat with Excel." It is a governed control plane where AI can inspect workbooks, draft formulas and edits, explain recommendations, and propose operational actions while humans review and approve every meaningful change.

## Product Thesis

Companies already rely on spreadsheets for planning, reconciliation, pricing, inventory, commissions, and reporting. The pain is not the lack of AI chat. The pain is weak control, manual review, poor traceability, and unsafe changes.

SpreadbreadAI addresses that by combining:

- spreadsheet-native workflows
- approval gates and policy controls
- audit logs and workbook lineage
- AI tool interoperability over MCP
- a collaborative sketchpad linked to workbook entities

## MVP Focus

The first wedge is **FP&A workbook review and reconciliation**.

Core MVP outcomes:

- ingest `.xlsx` workbooks and normalize them
- inspect formulas, references, stale values, and anomalies
- let AI draft workbook edits and review commentary
- present cell and range diffs before apply
- require explicit user approval for writes
- maintain append-only audit history
- support a linked sketchpad for process maps and planning notes

## Opinionated Stack

- Frontend: React + TypeScript
- Spreadsheet and data workspace: Grist-inspired app model with explicit workbook abstractions
- Sketchpad: Excalidraw
- Realtime collaboration: Yjs
- Backend API: Node.js + TypeScript
- Excel I/O and recalculation: Apache POI service boundary
- AI tool boundary: Model Context Protocol (MCP)
- Database: PostgreSQL
- Object storage: S3-compatible snapshots for workbook versions and artifacts

## Architecture Principle

SpreadbreadAI owns:

- policy
- approvals
- audit
- workbook versioning
- permissions
- UI for review and apply

Claude Code and Codex are optional clients that connect to SpreadbreadAI through MCP. They are not the product core.

## Repository Layout

```text
apps/
  web/                Frontend application
  mcp-server/         MCP server exposing read/draft/apply tools
packages/
  shared/             Shared types and domain utilities
docs/
  product/            PRD, roadmap, workflows
  architecture/       System architecture and MCP tool design
  adr/                Architecture decisions
  runbooks/           Local setup and operational notes
```

## Initial Milestones

1. Define workbook domain model, approval model, and audit model.
2. Stand up the web app shell and shared TypeScript workspace.
3. Implement workbook ingestion, normalization, and snapshot storage.
4. Implement MCP read tools, then draft tools, then approval-gated apply tools.
5. Embed the sketchpad and link it to workbook entities.
6. Ship the first finance review workflow end to end.

## Status

This repository is scaffolded for implementation. See the documents under `docs/` for product scope, architecture, and roadmap.
