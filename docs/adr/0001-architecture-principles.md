# ADR 0001: Architecture Principles

## Status

Accepted

## Context

The product must stay open-source, support spreadsheet-heavy business workflows, and integrate with external AI agents without delegating trust or policy enforcement to them.

## Decision

We will:

- design the platform as a governed spreadsheet control plane
- keep human approval in the product core
- expose AI capabilities through MCP rather than vendor-specific logic
- treat workbook versions and diffs as first-class entities
- keep the sketchpad linked to operational spreadsheet entities

## Consequences

- the system remains model-agnostic
- approval and audit are mandatory concerns, not later additions
- we can support Claude Code, Codex, and future clients through one tool surface
- implementation complexity increases in exchange for enterprise trust and defensibility
