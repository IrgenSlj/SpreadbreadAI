# Contributing

Thanks for considering a contribution. SpreadbreadAI is an
open-source, local-first agentic workspace for spreadsheet and document
work. The bar is correctness, traceability, predictability, and clear
policy boundaries between agents and document providers.

## Operation policy guarantees

Every change must preserve these:

1. Agents, skills, and MCP tools operate through declared tools and
   provider capabilities. They do not receive hidden write channels.
2. Write-capable tools produce typed operations or proposal items
   first. Provider mutation happens only through the apply pipeline.
3. `apply` is the single code path that commits approved or explicitly
   trusted operations to a provider-backed document version.
4. Every state transition writes an audit event.
5. Workbook/document versions are immutable where the provider allows
   it; updates create new versions or auditable provider revisions.

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
6. Prefer skill/config changes over Python plugin code when a workflow
   can be expressed declaratively.

## Where work lives

- `core/` — Python daemon. Domain types, tools, store, apply, MCP.
- `extension/` — LibreOffice Calc plugin. UNO component and sidebar.
- `docs/` — product, architecture, ADRs, runbooks, development plan.
- future provider adapters — Google Sheets, Google Docs, Excel, and
  local files should depend on the shared operation model, not bespoke
  agent logic.

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
- Operation policy and audit guarantees remain intact.

## Security

Do not commit secrets, production credentials, or customer workbook
data. Local data lives under `core/.data/` and is gitignored. See
[`SECURITY.md`](SECURITY.md) for how to report a vulnerability.
