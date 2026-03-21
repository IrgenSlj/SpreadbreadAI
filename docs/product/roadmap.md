# Roadmap

## Current Status

The repository now has a local prototype with workbook upload, parsing, proposal generation, item-level approvals, and a basic apply flow. The next phase is to harden the workflow and move persistence to a real database.

## Phase 1: Integrity Hardening

- unify proposal and item approval semantics
- make apply idempotent or one-shot
- add strict request validation and clear API error handling
- prevent stale UI actions and double submits
- add tests for approval and apply edge cases

## Phase 2: Database And Versioning

- move workbook, proposal, item, version, and audit persistence to PostgreSQL
- store immutable workbook versions instead of mutating snapshot records in place
- add optimistic locking or transactional guards for concurrent reviewer actions
- add clean cleanup for failed uploads and parse errors

## Phase 3: Workbook Intelligence

- deepen workbook parsing with dependency graphs, formula error summaries, and named range analysis
- surface sample values, sheet previews, and column-level summaries
- add stronger integrity checks for external references, stale inputs, and suspicious formula regions
- generate more precise proposal items from workbook findings

## Phase 4: Draft, Review, Apply

- keep workbook diffs at cell and range level
- allow reviewers to approve or reject individual proposal items
- make apply produce a new workbook version and a clean audit event
- add rollback or re-open flows for follow-up proposals

## Phase 5: Sketchpad

- replace the placeholder canvas with a real collaborative sketchpad
- embed Excalidraw or tldraw
- link shapes to workbook entities, proposals, risks, and approvals
- allow AI to draft diagrams and workflow notes

## Phase 6: MCP And Agents

- expose stable read, draft, review, and apply tools
- define clear tool boundaries for Claude Code, Codex, and other agent clients
- keep tool calls audit logged and workspace-scoped
- support analyze-only and propose-only modes

## Phase 7: Enterprise Controls

- add auth, tenant scoping, and RBAC
- add reviewer assignment and approval queues
- add notifications and report export
- add policy rules for protected workbooks and ranges

## Phase 8: First Vertical Workflow

- ship FP&A workbook review and reconciliation
- validate time saved and trust metrics
- expand to adjacent spreadsheet-heavy operations after the finance wedge proves out
