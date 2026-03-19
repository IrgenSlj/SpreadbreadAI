# Implementation Plan

## Goal

Reach a usable vertical slice where a user can upload a workbook, receive a structured AI review, inspect a proposed diff, and approve or reject the change.

## First Code Milestones

### Milestone 1: Shared Domain Contracts

Create shared schemas and types for:

- `Workbook`
- `WorkbookVersion`
- `Proposal`
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

### Milestone 4: Persistence

Create:

- PostgreSQL schema
- workbook snapshot table
- proposal table
- approval table
- audit event table

### Milestone 5: Workbook Processing Boundary

Create:

- upload normalization contract
- workbook metadata extraction contract
- formula graph extraction contract
- snapshot storage contract

## Recommended First Technical Choices

- package manager: pnpm
- frontend framework: Next.js or Vite React
- API layer: Fastify or NestJS
- schema validation: Zod
- ORM: Prisma or Drizzle

## Definition of the First End-to-End Demo

1. User uploads a workbook.
2. System stores the workbook and extracts metadata.
3. User opens workbook review page.
4. MCP read tool can inspect workbook summary.
5. AI drafts a proposal.
6. User sees the diff and approves it.
7. System creates a new workbook version and audit trail.
