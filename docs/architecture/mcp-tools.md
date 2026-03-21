# MCP Tool Design

## Tool Classes

### Read Tools

Safe inspection tools with no side effects.

Examples:

- `workbook.list`
- `workbook.get_structure`
- `workbook.get_formula_graph`
- `workbook.get_risk_summary`
- `proposal.list`
- `canvas.get_document`

Current prototype status:

- `workbook.read` is the main implemented read path
- the remaining read tools are target surfaces for the next contract pass

### Draft Tools

Tools that create proposals but do not mutate approved workbook state.

Examples:

- `proposal.create_from_prompt`
- `proposal.create_formula_fix`
- `proposal.create_scenario_update`
- `canvas.draft_diagram`
- `comment.create_draft`

Current prototype status:

- proposal generation exists, but the draft contract still needs to be formalized around durable proposal records and item-level review items

### Apply Tools

Tools that mutate state only when approval requirements are satisfied.

Examples:

- `proposal.apply`
- `canvas.apply_changes`
- `approval.approve`
- `approval.reject`

Current prototype status:

- apply exists, but it still needs one-shot semantics, canonical approval state, and stronger validation

## Security Rules

- read tools are least-privilege
- draft tools create reviewable objects, not direct writes
- apply tools require a valid approval state
- tool annotations are not security boundaries
- all tool calls emit audit events
- tool invocations should be workspace-scoped
- malformed requests should fail closed with explicit errors
- apply tools should not be repeatable without a new proposal revision

## Approval Model

Suggested flow:

1. agent inspects workbook
2. agent creates a proposal
3. user reviews structured diff
4. user approves or rejects
5. platform applies mutation and records a new version

Recommended next refinement:

- make proposal status derived from proposal item state
- keep approval and apply as separate operations
- treat applied proposals as immutable history rather than editable drafts

## Audit Requirements

Capture at minimum:

- tool name
- caller identity
- tenant and workspace
- proposal id if present
- argument hash
- timestamp
- approval outcome
- resulting workbook version

For the next phase, audit records should also capture:

- proposal item id
- request validation result
- apply idempotency outcome
- review state transitions
