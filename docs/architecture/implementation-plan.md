# Implementation Plan

> The detailed and current plan lives in
> [`docs/development-plan.md`](../development-plan.md).
>
> This document is kept as a short pointer for compatibility with
> existing links.

## Where to look

- Phases, decisions, and rationale: [`docs/development-plan.md`](../development-plan.md)
- Tool surface: [`docs/architecture/mcp-tools.md`](mcp-tools.md)
- Component shapes: [`docs/architecture/system-architecture.md`](system-architecture.md)
- Setup: [`docs/runbooks/setup.md`](../runbooks/setup.md)

## Current bar

The first end-to-end demo (the MVP target) is:

1. Install the LibreOffice extension and run `spreadbread-core`.
2. Open an FP&A workbook in Calc.
3. Click "Review with SpreadbreadAI"; the extension shows risks and
   staged proposals from Gemma 4 E2B.
4. Approve the staged diff.
5. Click "Apply approved"; Calc updates the cell, the daemon writes a
   new workbook version, the audit trail records every step.

All of this must run fully offline.
