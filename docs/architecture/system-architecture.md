# System Architecture

## Top-Level Components

### Web App

Responsibilities:

- workbook upload and review UI
- approval and policy UI
- sketchpad UI
- audit log viewer
- collaboration surfaces

Current state:

- the web app is a working prototype
- workbook review, proposal review, audit history, and apply actions are present
- the sketchpad is still a placeholder and needs a real collaborative canvas

### API Backend

Responsibilities:

- auth and tenancy
- workbook metadata and snapshot lifecycle
- proposal storage
- approval workflow
- audit event persistence
- orchestration between workbook analysis and MCP tooling

Current state:

- the API backend is a local HTTP server backed by disk files
- upload, review lookup, proposal decisions, and apply endpoints exist
- request validation, concurrency control, and idempotency still need hardening

### Workbook Processing Service

Responsibilities:

- `.xlsx` ingestion
- workbook normalization
- formula recalculation
- structure extraction
- generation of workbook snapshots and derived metadata

This service can be JVM-based if Apache POI is used directly.

Current state:

- workbook parsing is handled inside the MCP server for the prototype
- the next architecture step is to split parsing into a dedicated service or module boundary

### MCP Server

Responsibilities:

- expose read, draft, and apply tool surfaces
- enforce workspace scoping
- require approval tokens or workflow state for apply actions
- emit auditable tool invocation events

Current state:

- the MCP server is implemented in TypeScript
- `workbook.read` is wired to persisted review snapshots
- `workbook.draft` and `workbook.apply` exist as prototype surfaces and should be aligned with the approval model

### Realtime Collaboration Layer

Responsibilities:

- shared comments
- shared presence
- collaborative review state
- linked sketch annotations

## Canonical Domain Objects

- `Workbook`
- `WorkbookVersion`
- `Sheet`
- `CellReference`
- `Proposal`
- `ProposalItem`
- `ProposalDiff`
- `ApprovalRequest`
- `AuditEvent`
- `CanvasDocument`
- `EntityLink`

For the next phase, persistence should promote these objects to first-class database records rather than storing them inside a single mutable snapshot.

## Design Constraints

- AI never writes directly to a protected workbook
- all meaningful mutations create audit events
- workbook state is versioned, not overwritten in place
- agent clients are replaceable
- policy is enforced by the platform, not delegated to the model
- approval state must be canonical and derived consistently
- apply actions should be idempotent or one-shot
- request validation must fail closed with clear errors

## Suggested Delivery Shape

- `apps/web`: review-first frontend
- `apps/mcp-server`: tool server exposing workbook and sketch operations
- `packages/shared`: shared domain contracts and validation
- future `services/workbook-processor`: Excel ingestion and recalc boundary
- future `services/api`: PostgreSQL-backed workflow and approval service
