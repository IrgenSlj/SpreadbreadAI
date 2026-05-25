## Summary

What this PR changes and why. One short paragraph.

## Affected components

- [ ] `core/` (daemon)
- [ ] agent runtime / modes / permissions
- [ ] operation IR / apply pipeline
- [ ] provider adapter
- [ ] skills / MCP tools
- [ ] `extension/` (LibreOffice plugin)
- [ ] UI / artifact workspace
- [ ] `docs/`
- [ ] CI / release workflow
- [ ] other:

## Test plan

- [ ] `cd core && .venv/bin/python -m pytest -q --deselect tests/test_llm_live.py`
- [ ] `cd extension && .../python -m pytest -q -c pyproject.toml`
- [ ] manual smoke (describe what you ran)

## Human-in-the-loop guarantee

- [ ] no new path lets an agent, skill, or MCP tool bypass operation policy
- [ ] every state transition still emits an audit event
- [ ] apply remains idempotent per proposal or operation batch
- [ ] provider adapters expose capabilities instead of hidden side effects
- [ ] direct/autopilot behavior is opt-in, bounded, and auditable

## Docs

- [ ] `docs/development-plan.md` updated if a phase changed
- [ ] `CLAUDE.md` updated if layout, commands, or constraints changed
- [ ] architecture/product docs updated for new providers, skills, or modes
