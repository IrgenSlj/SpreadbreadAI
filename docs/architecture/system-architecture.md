# System Architecture

## Top-Level Components

### Web App

Responsibilities:

- workbook upload and review UI
- approval and policy UI
- sketchpad UI
- audit log viewer
- collaboration surfaces

### API Backend

Responsibilities:

- auth and tenancy
- workbook metadata and snapshot lifecycle
- proposal storage
- approval workflow
- audit event persistence
- orchestration between workbook analysis and MCP tooling

### Workbook Processing Service

Responsibilities:

- `.xlsx` ingestion
- workbook normalization
- formula recalculation
- structure extraction
- generation of workbook snapshots and derived metadata

This service can be JVM-based if Apache POI is used directly.

### MCP Server

Responsibilities:

- expose read, draft, and apply tool surfaces
- enforce workspace scoping
- require approval tokens or workflow state for apply actions
- emit auditable tool invocation events

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
- `ProposalDiff`
- `ApprovalRequest`
- `AuditEvent`
- `CanvasDocument`
- `EntityLink`

## Design Constraints

- AI never writes directly to a protected workbook
- all meaningful mutations create audit events
- workbook state is versioned, not overwritten in place
- agent clients are replaceable
- policy is enforced by the platform, not delegated to the model

## Suggested Delivery Shape

- `apps/web`: review-first frontend
- `apps/mcp-server`: tool server exposing workbook and sketch operations
- `packages/shared`: shared domain contracts and validation
- future `services/workbook-processor`: Excel ingestion and recalc boundary
