# Contributing

## Principles

- Keep the product human-in-the-loop.
- Prefer deterministic behavior over opaque automation.
- Every write path must remain approval-gated.
- Preserve auditability and workbook traceability in every feature.
- Favor open standards and open-source dependencies.

## Workflow

1. Open an issue or write a short proposal for any non-trivial change.
2. Update the relevant document in `docs/` if the change affects product scope or architecture.
3. Keep pull requests focused and reviewable.
4. Add or update tests for behavior changes.
5. Do not introduce write paths that bypass policy and approval checks.

## Commit Guidance

- Use small, focused commits.
- Mention the affected workflow or subsystem in the commit message.
- Document follow-up work instead of hiding it in partially complete code.

## Definition of Done

- behavior is implemented
- tests cover the new behavior or risk area
- docs are updated when needed
- security and audit implications were considered

## Security

Never commit secrets, production credentials, or customer workbook data.
