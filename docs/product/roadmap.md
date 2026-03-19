# Roadmap

## Phase 0: Foundation

- define domain model for workbooks, sheets, ranges, proposals, approvals, and audits
- scaffold monorepo and shared TypeScript packages
- establish coding, testing, and documentation standards

## Phase 1: Workbook Intelligence

- add workbook upload flow
- parse workbook metadata and sheet structure
- build formula graph and reference analysis
- surface integrity checks and anomaly summaries

## Phase 2: Draft and Review

- add proposal objects for AI-suggested edits
- render workbook diffs at cell and range level
- implement review UI and approval actions
- persist audit events and version snapshots

## Phase 3: MCP Integration

- expose read tools for workbook inspection
- expose draft tools for suggestion generation
- expose apply tools behind approval gates
- add auth and tenant scoping

## Phase 4: Sketchpad

- embed Excalidraw
- link shapes to workbook entities
- allow AI to draft diagrams and workflow notes
- keep shape mutations subject to approval where needed

## Phase 5: First Vertical Workflow

- ship FP&A workbook review and reconciliation
- add report export and reviewer signoff
- validate time saved and trust metrics
