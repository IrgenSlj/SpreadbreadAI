# Product Requirements Document

## Product Name

SpreadbreadAI

## Positioning

An open-source spreadsheet operations platform that lets AI analyze and draft work while humans review, approve, and apply changes.

## Target Users

- FP&A teams
- finance operations teams
- revenue operations teams
- procurement and supply-chain operators
- spreadsheet-heavy operations managers

## Primary User Problems

- critical workbook logic is difficult to review
- spreadsheet changes are hard to trace and approve
- formula and reference errors are expensive and common
- operational workflows live in ad hoc spreadsheet processes
- AI copilots are not trusted to write directly to business-critical workbooks

## MVP Scope

### In Scope

- workbook upload and versioning
- workbook metadata extraction
- formula graph inspection
- anomaly and integrity checks
- AI-generated commentary and draft workbook changes
- cell and range diffs before apply
- approval workflow for writes
- audit log for all AI and user actions
- collaborative sketchpad linked to workbook entities
- MCP server for read, draft, and apply tools

### Out of Scope

- full Excel replacement
- autonomous AI execution without approval
- deep ERP-native orchestration in v1
- custom on-sheet formula language in v1
- broad multi-industry workflow coverage before validating the finance wedge

## MVP Success Metrics

- reduce workbook review time by at least 50%
- detect broken formulas, missing references, or suspicious values before close
- achieve repeat usage on weekly or monthly review workflows
- maintain zero unapproved AI writes to protected workbooks

## Core User Stories

1. As a finance manager, I upload a workbook and receive a structured review of risk areas, broken references, and suspicious formulas.
2. As an analyst, I can ask AI to draft a scenario update without directly modifying the workbook.
3. As an approver, I can compare a proposed workbook diff and approve or reject it.
4. As an operator, I can see who changed what, why it changed, and which model or user proposed it.
5. As a team, we can sketch a process or planning model and link it to workbook ranges and approvals.

## Differentiation

- approval-first AI workflow
- workbook diff and lineage as first-class product concepts
- open MCP tool surface rather than a hard-coded model dependency
- sketchpad linked to operational spreadsheet objects

## Risks

- Excel compatibility edge cases
- users expecting a full spreadsheet editor immediately
- overbuilding generic AI features before proving the first wedge
- weak trust if explanations and diffs are not precise

## MVP Exit Criteria

- one end-to-end finance review workflow in production quality
- durable workbook snapshot model
- audit and approval trail for all write actions
- usable MCP interface for external agent clients
