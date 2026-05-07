# Contributing

## The hard rule

No write path may bypass human approval. Tools that look like writes
(`propose_diff`, `add_comment`, future apply tools) must stage items
for an approver. The model is a junior analyst, not an admin.

If a change makes that rule weaker, do not ship it.

## Principles

- Human-in-the-loop is the product, not a feature.
- Prefer deterministic behavior over opaque automation.
- Auditability is mandatory: every state transition writes an audit
  event.
- Open source and offline-first by default. Cloud LLMs are an option,
  not a requirement.

## Workflow

1. Open an issue or write a short proposal for any non-trivial change.
2. Read [`docs/development-plan.md`](docs/development-plan.md). If your
   change shifts a phase, update that document in the same PR.
3. Keep PRs focused — one slice, one concern.
4. Add or update tests for behavior changes. Live LLM tests should skip
   gracefully when Ollama is unreachable.
5. Update `CLAUDE.md` when the layout, commands, or constraints change.

## Where work happens

- `core/` — Python daemon. New domain types, tools, and APIs.
- `extension/` — LibreOffice plugin. UNO component, sidebar UI.
- `docs/` — product, architecture, ADRs, runbooks, the development plan.

## Commit guidance

- Small, focused commits. Mention the affected subsystem in the message.
- Document follow-ups in the PR description, not in half-finished code.

## Definition of done

- behavior is implemented in the right layer
- tests cover the new behavior or risk area
- docs are updated when needed (README, CLAUDE.md, development plan)
- the human-in-the-loop guarantee is intact

## Security

Never commit secrets, production credentials, or customer workbook data.
Local data lives under `core/.data/` and is gitignored.
