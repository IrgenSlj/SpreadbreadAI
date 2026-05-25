# Operation IR

The operation IR is the provider-neutral contract between agent work and
provider mutation. Agents, skills, and MCP tools can propose operations.
Only the daemon apply pipeline can execute them.

## Goals

- Represent spreadsheet and document changes before they touch a provider.
- Validate capability, address, conflict, and risk independently of the model.
- Let LibreOffice, Google Sheets, Google Docs, Excel, and local files
  share one proposal/apply/audit model.
- Support artifact-centered UI: every proposed change can be rendered,
  reviewed, approved, rejected, applied, and audited.

## Non-Goals

- Replacing provider APIs.
- Building a custom spreadsheet formula engine.
- Allowing agents to write directly to documents.
- Designing a generic workflow language before real operations exist.

## Base Shape

```json
{
  "id": "op_...",
  "resource_id": "res_...",
  "provider_id": "local_xlsx",
  "resource_kind": "spreadsheet",
  "kind": "set_cell_formula",
  "target": {
    "sheet": "Forecast",
    "cell": "D12"
  },
  "before": {
    "formula": "=B12*C12"
  },
  "after": {
    "formula": "=B12*$C$3"
  },
  "rationale": "Use the shared margin assumption instead of row-local value.",
  "risk": "medium",
  "required_capability": "spreadsheet.write_formula",
  "validation": {
    "status": "valid",
    "messages": []
  },
  "source_run_id": "run_...",
  "approval_status": "pending"
}
```

## Operation Status

- `draft` — created but not yet validated.
- `valid` — passes local validation and provider capability checks.
- `invalid` — cannot be applied.
- `pending` — waiting for approval or policy decision.
- `approved` — approved for apply.
- `rejected` — rejected by reviewer or policy.
- `applied` — committed through provider adapter.
- `failed` — apply attempted but failed.

## Risk Levels

- `low` — comments, labels, non-destructive formatting, read-derived notes.
- `medium` — value/formula edits with localized impact.
- `high` — broad range edits, formulas with downstream dependencies,
  external links, sheet structure changes.
- `critical` — destructive or hard-to-reverse changes; deny until strong
  rollback/support exists.

## Initial Spreadsheet Operations

| Kind | Capability | Notes |
|---|---|---|
| `set_cell_value` | `spreadsheet.write_cell` | Writes a scalar value. |
| `set_cell_formula` | `spreadsheet.write_formula` | Writes a formula string. |
| `add_cell_comment` | `spreadsheet.comment` | Adds a review/comment artifact. |
| `replace_range_values` | `spreadsheet.batch_update` | Batch operation; higher risk by default. |
| `create_sheet` | `spreadsheet.structure` | Requires provider support and explicit approval. |
| `rename_sheet` | `spreadsheet.structure` | Requires dependency validation. |

## Initial Text Document Operations

| Kind | Capability | Notes |
|---|---|---|
| `add_document_comment` | `document.comment` | Low-risk review note. |
| `replace_document_text` | `document.replace_text` | Requires before-text match/conflict check. |
| `insert_document_section` | `document.insert_section` | Used by report generation skills. |

## Validation Rules

Validation must run before approval/apply:

- resource exists
- provider supports required capability
- target address/range is valid
- `before` value matches current provider snapshot where available
- operation risk is allowed in the current mode/trust policy
- destructive operations are denied until explicitly supported
- batch operations are bounded by size limits
- external provider operations include revision/conflict guards where available

## Migration From Proposal Items

The existing `ProposalItem` model remains compatible.

Migration steps:

1. Add optional operation metadata to proposal items.
2. Convert current `propose_diff` and `add_comment` outputs into
   operation-backed proposal items.
3. Update apply internals to execute operation batches.
4. Expose operations in review/artifact APIs.
5. Normalize operation storage only when UI/run queries require it.

## Apply Contract

Apply receives an approved/trusted operation batch and:

1. reloads current resource/provider state
2. revalidates operations
3. checks conflicts/revisions
4. executes operations through the provider adapter
5. records provider version/revision output
6. marks operations applied or failed
7. writes audit events

Apply must be idempotent. Retrying an already-applied batch returns the
existing result rather than applying twice.
