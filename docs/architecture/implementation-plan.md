# Implementation Plan

## Goal

Reach a usable vertical slice where a user can upload a workbook, receive a structured AI review, inspect a proposed diff, and approve or reject the change.

The prototype currently reaches that basic slice locally. The next implementation stage is to make the workflow trustworthy: consistent approval semantics, one-shot apply, stricter validation, and durable persistence.

## First Code Milestones

### Milestone 1: Shared Domain Contracts

Create shared schemas and types for:

- `Workbook`
- `WorkbookVersion`
- `Proposal`
- `ProposalItem`
- `ProposalDiff`
- `ApprovalRequest`
- `AuditEvent`
- `CanvasDocument`

### Milestone 2: Web App Shell

Create:

- app shell and routing
- workbook upload page
- workbook detail page
- proposal review UI
- audit log panel
- sketchpad page or panel

### Milestone 3: MCP Server Skeleton

Create:

- health endpoint
- tool registry
- read tools for workbook metadata
- draft tool placeholder
- approval-gated apply tool placeholder

Current state:

- the MCP server exists and serves a working local prototype
- the read path is functional
- the apply path still needs one-shot semantics and stronger state guarantees

### Milestone 4: Persistence

Create:

- PostgreSQL schema
- workbook snapshot table
- proposal table
- proposal item table
- approval table
- audit event table

Add:

- workbook version history as immutable records
- optimistic locking or transactional guards
- cleanup for failed parse or upload paths

### Milestone 5: Workbook Processing Boundary

Create:

- upload normalization contract
- workbook metadata extraction contract
- formula graph extraction contract
- snapshot storage contract

Add:

- named range extraction
- sample row summaries
- error marker detection
- workbook dependency graph reporting

## Recommended First Technical Choices

- package manager: pnpm
- frontend framework: Next.js or Vite React
- API layer: Fastify or NestJS
- schema validation: Zod
- ORM: Prisma or Drizzle

The current prototype uses Vite, React, and a local TypeScript HTTP server. The next phase should keep the same product shape unless a migration clearly simplifies the system.

## Definition of the First End-to-End Demo

1. User uploads a workbook.
2. System stores the workbook and extracts metadata.
3. User opens workbook review page.
4. MCP read tool can inspect workbook summary.
5. AI drafts a proposal.
6. User sees the diff and approves it.
7. System creates a new workbook version and audit trail.

## Next Demo Bar

The next demo should prove:

1. proposal state is derived from item decisions
2. apply is idempotent or one-shot
3. invalid requests return clean client errors
4. a workbook review persists cleanly in PostgreSQL
5. the sketchpad can link notes to workbook entities
