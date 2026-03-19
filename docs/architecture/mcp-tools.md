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

### Draft Tools

Tools that create proposals but do not mutate approved workbook state.

Examples:

- `proposal.create_from_prompt`
- `proposal.create_formula_fix`
- `proposal.create_scenario_update`
- `canvas.draft_diagram`
- `comment.create_draft`

### Apply Tools

Tools that mutate state only when approval requirements are satisfied.

Examples:

- `proposal.apply`
- `canvas.apply_changes`
- `approval.approve`
- `approval.reject`

## Security Rules

- read tools are least-privilege
- draft tools create reviewable objects, not direct writes
- apply tools require a valid approval state
- tool annotations are not security boundaries
- all tool calls emit audit events

## Approval Model

Suggested flow:

1. agent inspects workbook
2. agent creates a proposal
3. user reviews structured diff
4. user approves or rejects
5. platform applies mutation and records a new version

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
