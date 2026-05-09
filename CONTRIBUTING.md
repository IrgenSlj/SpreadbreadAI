# Contributing

Thanks for considering a contribution. SpreadbreadAI is an
open-source spreadsheet AI assistant intended for professional and
enterprise use; the bar is correctness, traceability, and
predictability.

## Approval and audit guarantees

Every change must preserve these:

1. The LLM has read tools and write-staging tools only. There is no
   tool path that mutates a workbook directly.
2. `apply` is the single code path that produces a new workbook
   version, and it requires approved items.
3. Every state transition writes an audit event.
4. Workbook versions are immutable; updates create new versions.

If a change weakens any of these, it does not ship.

## Workflow

1. Open an issue or a short proposal before non-trivial work.
2. Read [`docs/development-plan.md`](docs/development-plan.md). If the
   change shifts a phase, update that document in the same PR.
3. Keep PRs focused on one concern.
4. Add or update tests for behavior changes. Live LLM tests must skip
   gracefully when Ollama is unreachable.
5. Update `CLAUDE.md` when the layout, commands, or constraints
   change.

## Where work lives

- `core/` — Python daemon. Domain types, tools, store, apply, MCP.
- `extension/` — LibreOffice Calc plugin. UNO component and sidebar.
- `docs/` — product, architecture, ADRs, runbooks, development plan.

## Commit guidance

- Small, focused commits. Reference the affected subsystem in the
  subject line.
- Document follow-up work in the PR description, not in half-finished
  code.

## Definition of done

- The behavior lands in the right layer.
- Tests cover the new behavior and the risk areas it touches.
- `README.md`, `CLAUDE.md`, and the development plan are updated when
  the change affects layout, commands, or constraints.
- Approval and audit guarantees remain intact.

## Security

Do not commit secrets, production credentials, or customer workbook
data. Local data lives under `core/.data/` and is gitignored. See
[`SECURITY.md`](SECURITY.md) for how to report a vulnerability.
