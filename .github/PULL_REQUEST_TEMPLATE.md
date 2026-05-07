## Summary

What this PR changes and why. One short paragraph.

## Affected components

- [ ] `core/` (daemon)
- [ ] `extension/` (LibreOffice plugin)
- [ ] `docs/`
- [ ] CI / release workflow
- [ ] other:

## Test plan

- [ ] `cd core && .venv/bin/python -m pytest -q --deselect tests/test_llm_live.py`
- [ ] `cd extension && .../python -m pytest -q -c pyproject.toml`
- [ ] manual smoke (describe what you ran)

## Human-in-the-loop guarantee

- [ ] no new path lets the LLM mutate a workbook without human approval
- [ ] every state transition still emits an audit event
- [ ] apply remains idempotent per proposal

## Docs

- [ ] `docs/development-plan.md` updated if a phase changed
- [ ] `CLAUDE.md` updated if layout, commands, or constraints changed
