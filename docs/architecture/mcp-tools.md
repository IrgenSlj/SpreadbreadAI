# Tool, Skill, And MCP Surface

SpreadbreadAI exposes tools to the local LLM and to MCP clients. The
same permission policy must govern native tools, skills, MCP calls, and
future provider adapters.

## Definitions

- **Tool** — executable capability exposed by the daemon.
- **Skill** — workflow guidance and configuration that teaches the
  agent how to use tools for a task.
- **MCP bridge** — external client surface for tools/resources.
- **Operation** — typed proposed mutation to a spreadsheet/document
  resource.
- **Apply** — daemon-owned commit path that executes approved or
  explicitly trusted operations through a provider adapter.

Tools act. Skills teach. MCP connects. Operations describe changes.
Apply mutates providers.

## Current Tool Catalog

### Read tools

Read tools have no side effects:

- `list_workbooks()` — uploaded workbooks.
- `get_review_snapshot(workbook_id)` — workbook, latest proposal, and audit trail.
- `inspect_sheet(workbook_id, sheet_name)` — dimensions, formulas, sample rows.
- `list_risks(workbook_id)` — detected structural risks.
- `get_dependencies(workbook_id, cell)` — captured formula dependencies.
- `find_external_references(workbook_id)` — external workbook references.
- `get_named_ranges(workbook_id)` — workbook defined names and ranges.

### Write-staging tools

Write-staging tools cannot mutate providers:

- `propose_diff(workbook_id, cell, kind, before?, after?, after_type?, rationale)`
- `add_comment(workbook_id, cell, body)`

These currently create proposal items. The next contract maps proposal
items onto typed operations.

## Planned Tool Metadata

Every tool should declare:

- tool name
- resource kind
- provider capability required
- side-effect class: read, stage, apply-request, provider-write
- allowed modes
- risk level
- audit action
- whether it can be exposed over MCP
- whether it can be used by skills

Example:

```json
{
  "name": "propose_diff",
  "resource_kind": "spreadsheet",
  "required_capability": "spreadsheet.write_cell",
  "side_effect": "stage",
  "allowed_modes": ["propose", "direct"],
  "risk": "medium",
  "mcp_exposed": true,
  "skill_exposed": true
}
```

## Permission Policy

Policy evaluates a requested tool/operation as:

- `allow` — execute immediately.
- `ask` — require user approval or a UI permission prompt.
- `deny` — do not expose or execute.

Inputs to policy:

- agent mode
- trust mode
- provider capability
- resource kind
- operation risk
- caller: local UI, local LLM, MCP client, skill
- workbook/document protection state
- user-configured allow/deny rules

Default stance:

- read-only inspection: allow
- write staging: allow in propose/direct modes, otherwise deny
- apply: ask or require prior approval unless explicitly trusted
- destructive operations: ask/deny until implemented with strong undo
- MCP write-capable tools: stage only, never direct provider write

## Agent Modes And Tool Exposure

| Mode | Tool exposure |
|---|---|
| `inspect` | read-only tools |
| `plan` | read-only tools plus planning artifacts |
| `propose` | read tools and write-staging tools |
| `apply` | apply-request/approved-operation tools only |
| `direct` | read, stage, validate, and bounded auto-apply through policy |
| `locked` | read tools and per-item approval only |

The model should only see tools that survive policy filtering. If a
tool is denied, it should not appear in the model/tool schema for that
run.

Current implementation status:

- `ToolRegistry.list_tools(mode=...)` and `to_ollama_schema(mode=...)`
  can filter tools by mode.
- `/api/workbooks/{id}/chat` accepts optional `mode`, defaulting to
  `propose`.
- The Ollama loop denies disallowed tool calls even if a model requests
  one that was not exposed.
- `/api/tools?mode=...` exposes the mode-filtered schema.
- `/chat` creates an `AgentRun` and returns `run_id` so prompt, mode,
  audit, and future tool-call rows have a common trace id.

## MCP Rules

MCP is an integration boundary, not a bypass.

- MCP clients use the same tool registry as the local LLM.
- MCP tool calls write distinct audit events.
- MCP write-capable tools stage operations/proposal items only.
- MCP exposure is filtered by mode, policy, provider capability, and
  resource.
- External MCP clients should be treated as local untrusted callers
  unless explicitly configured otherwise.

## Skills Rules

Skills are local workflow packs. Initial format should be a directory
with a `SKILL.md` and optional metadata.

Skill metadata should include:

- name
- description
- supported resource kinds
- required tools/capabilities
- risk level
- allowed modes
- optional model/provider recommendation
- optional environment/binary requirements

Skills may:

- add task-specific instructions
- recommend tool sequences
- define validation checklists
- produce artifacts

Skills may not:

- bypass permission policy
- call provider APIs directly
- hide write operations from audit
- require paid services by default

## Operation And Apply Flow

1. User starts a run through UI, API, or MCP.
2. Daemon selects agent mode and filters tools.
3. Agent calls read tools and, when allowed, write-staging tools.
4. Write-staging tools create typed operations or proposal items.
5. Validators check addresses, capabilities, conflicts, and risk.
6. UI/artifact API shows findings and proposed operations.
7. Policy decides whether approval is required.
8. Apply commits approved/trusted operations through the provider adapter.
9. Daemon records version/revision information and audit events.

## Audit Fields

Every tool call and operation transition should record:

- timestamp
- run id
- resource id
- caller
- actor
- mode
- tool or operation name
- provider
- decision: allow, ask, deny, approved, rejected, applied
- detail payload with proposal/operation ids where applicable

## Planned Tools

Near-term deterministic tools:

- `find_similar_cells(workbook_id, pattern)`
- `summarize_changes(workbook_id, since_version_id)`
- `validate_operations(proposal_id)`
- `list_artifacts(run_id)`

Provider-expansion tools:

- `list_resources(workspace_id)`
- `inspect_resource(resource_id)`
- `connect_google_sheets(...)`
- `refresh_provider_snapshot(resource_id)`

These should be added only when the operation and policy contracts can
support them without special-case bypasses.
