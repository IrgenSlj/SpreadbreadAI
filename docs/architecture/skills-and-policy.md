# Skills And Permission Policy

Skills and policy are separate concepts.

- Skills teach workflows.
- Policy decides what can run.

No skill should grant itself extra permissions.

## Skill Shape

Initial skills should be local folders:

```text
skills/
  formula-audit/
    SKILL.md
  month-end-review/
    SKILL.md
```

Recommended `SKILL.md` frontmatter:

```yaml
---
name: formula-audit
description: Review formulas, dependencies, named ranges, and reference risks.
resource_kinds: [spreadsheet]
allowed_modes: [inspect, plan, propose]
required_capabilities:
  - spreadsheet.read
  - spreadsheet.comment
risk: medium
---
```

The body should describe the workflow, validation checklist, tool order,
and expected artifacts.

## Built-In Starter Skills

- `formula-audit`
- `month-end-review`
- `scenario-modeling`
- `stale-input-cleanup`
- `external-reference-repair`
- `report-generation`

These should start as instructions and checklists, not Python plugins.

## Policy Inputs

Permission policy evaluates:

- caller: local UI, local agent, MCP client, skill
- mode: inspect, plan, propose, apply, direct, locked
- resource kind
- provider capability
- tool side-effect class
- operation risk
- user trust mode
- explicit user allow/deny rules

Policy result:

- `allow`
- `ask`
- `deny`

## Default Policy

| Request | Default |
|---|---|
| Read workbook/document metadata | allow |
| Inspect formulas/dependencies | allow |
| Stage comments | allow in propose/direct |
| Stage formula/value operations | allow in propose/direct |
| Apply approved operations | allow through apply endpoint |
| Auto-apply low-risk direct-mode operations | allow only when configured |
| Apply high-risk operations | ask |
| Destructive operations | deny until explicitly implemented |
| MCP direct provider write | deny |

## MCP And Skills

MCP tools and skills must be filtered through the same policy layer.

Rules:

- If a tool is denied, do not expose it to the model/client for that run.
- If a tool requires approval, return a structured permission request.
- Every MCP tool call writes an audit event.
- Every skill-selected tool call writes an audit event.
- Skills can recommend operations but cannot apply them directly.

## Cost Policy

Default development behavior:

- local model first
- no paid API calls unless configured
- no background cloud sync
- no provider connector enabled without explicit user setup

Cloud model/provider adapters should expose usage data when available so
the UI can display cost status.
