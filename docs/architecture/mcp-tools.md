# Tool Surface

The platform exposes a tool registry to the local LLM and to MCP
clients. Tool definitions live in
`core/spreadbread_core/tools.py` and the schemas are emitted in
Ollama / OpenAI tool-calling format.

## v0.1 catalog (implemented)

### Read tools (no side effects)

- `list_workbooks()` — every workbook the user has uploaded.
- `get_review_snapshot(workbook_id)` — workbook + latest proposal +
  audit trail.
- `inspect_sheet(workbook_id, sheet_name)` — dimensions, formula count,
  sample rows.
- `list_risks(workbook_id)` — detected risks (formula chains, stale
  inputs, reference drift).
- `get_dependencies(workbook_id, cell)` — captured formula dependencies.
- `find_external_references(workbook_id)` — cells referencing external
  workbook files.
- `get_named_ranges(workbook_id)` — workbook defined names and ranges.

### Write-staging tools (cannot mutate workbooks)

- `propose_diff(workbook_id, cell, kind, before?, after?, after_type?, rationale)` —
  creates or appends to the workbook's pending proposal. Returns
  `{proposal_id, item_id, status: "pending"}`.
- `add_comment(workbook_id, cell, body)` — convenience over
  `propose_diff` with `kind="comment"`.

The registry rejects any attempt to bypass approval; the model has no
function it can call to apply or write directly.

## Planned tools

- `find_similar_cells(workbook_id, pattern)` — pattern search across
  cells / formulas.
- `summarize_changes(workbook_id, since_version_id)` — diff between two
  versions.
- `request_apply(proposal_id)` — raises an apply request for an
  approver. Apply itself is performed by the daemon, not the model.

## Approval model

1. User asks the daemon to review a workbook.
2. Daemon hands the model the tool catalog and the request.
3. Model emits tool calls. Read tools answer directly. Write tools
   stage items.
4. Approver reviews each item via
   `POST /api/proposals/{proposal_id}/items/{item_id}/decision` with
   `{decision: "approve" | "reject", reviewer, comment?}`.
5. Apply writes a new workbook version from approved items
   only and emits audit events.

## Security rules

- Read tools are least-privilege.
- Write tools create reviewable items, never direct writes.
- Apply requires a fully approved proposal and is one-shot per
  proposal.
- Tool annotations are not security boundaries; the registry enforces
  the read / stage / apply split.
- All tool calls emit audit events.
- Malformed requests fail closed with an explicit error message.

## Audit fields

Each tool call produces or appends to an audit event with:

- timestamp
- actor (`llm`, `user`, `system`, or a reviewer handle)
- action (e.g. `proposal.created`, `proposal.item.added`,
  `proposal.item.approve`)
- detail (free-form, includes proposal id and item id where present)

Apply records the resulting workbook version id and the source proposal
id.
