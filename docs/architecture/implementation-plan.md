# Implementation Plan

> The detailed and current multisession sprint plan lives in
> [`docs/development-plan.md`](../development-plan.md).
>
> This file is kept as a compatibility pointer for existing links and a
> short summary of the current implementation bar.

## Current implementation bar

SpreadbreadAI is moving from a LibreOffice-only review assistant toward
a local-first agentic workspace for spreadsheet and document work. The
LibreOffice Calc path remains the first proving ground, but the core
engine must now be provider-neutral.

The next implementation slices are:

1. Stabilize the operation IR and map current proposal items onto it.
2. Add explicit agent modes: inspect, plan, propose, apply, direct.
3. Normalize event/tool-call/proposal storage enough for artifact UI.
4. Add skill loading with permission-gated tool exposure.
5. Build the artifact-centered local UI shell.
6. Add Google Sheets as the first non-LibreOffice provider.

## Where to look

- Multisession sprints: [`docs/development-plan.md`](../development-plan.md)
- Product requirements: [`docs/product/prd.md`](../product/prd.md)
- Roadmap: [`docs/product/roadmap.md`](../product/roadmap.md)
- Tool and MCP policy: [`docs/architecture/mcp-tools.md`](mcp-tools.md)
- Operation IR: [`docs/architecture/operation-ir.md`](operation-ir.md)
- Skills and policy: [`docs/architecture/skills-and-policy.md`](skills-and-policy.md)
- Component contracts: [`docs/architecture/system-architecture.md`](system-architecture.md)
- UX principles: [`docs/product/ux-principles.md`](../product/ux-principles.md)
- Setup: [`docs/runbooks/setup.md`](../runbooks/setup.md)

## Non-negotiables

- Local-first and low-cost by default.
- No direct model write path to a provider.
- Provider mutation goes through typed operations, policy, apply, and
  audit.
- Skills teach workflows; tools act; provider adapters read and write
  documents through declared capabilities.
