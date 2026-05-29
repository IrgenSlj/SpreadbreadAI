"""Tests for run/session event tracing."""
from __future__ import annotations

from pathlib import Path
from typing import Generator

import pytest

from spreadbread_core.domain import (
    AgentRun,
    ProposalItem,
    RunEvent,
    Workbook,
)
from spreadbread_core.store import Store


@pytest.fixture
def store(tmp_path: Path) -> Generator[Store, None, None]:
    s = Store(tmp_path / "test.sqlite3")
    yield s


@pytest.fixture
def run(store: Store) -> AgentRun:
    wb = Workbook(
        id="wb_test", name="test", owner="tester",
        created_at="2025-01-01T00:00:00", latest_version_id="v0",
    )
    store.save_workbook(wb)
    r = AgentRun(
        workbook_id="wb_test",
        mode="propose",
        prompt="test prompt",
        model="test-model",
    )
    store.save_agent_run(r)
    return r


# ---------------------------------------------------------------------------
# RunEvent CRUD
# ---------------------------------------------------------------------------

def test_append_and_list_run_events(store: Store, run: AgentRun) -> None:
    e1 = RunEvent(run_id=run.id, kind="tool_call", detail="LLM called propose_diff")
    e2 = RunEvent(run_id=run.id, kind="agent_reply", detail="LLM responded")

    store.append_run_event(e1)
    store.append_run_event(e2)

    events = store.list_run_events(run.id)
    assert len(events) == 2
    assert events[0].id == e1.id
    assert events[0].kind == "tool_call"
    assert events[1].id == e2.id
    assert events[1].kind == "agent_reply"


def test_list_run_events_empty(store: Store, run: AgentRun) -> None:
    events = store.list_run_events(run.id)
    assert events == []


def test_list_run_events_other_run(store: Store, run: AgentRun) -> None:
    e = RunEvent(run_id=run.id, kind="tool_call", detail="test")
    store.append_run_event(e)
    # Query a different run
    other_events = store.list_run_events("other_run")
    assert other_events == []


def test_event_payload(store: Store, run: AgentRun) -> None:
    payload = {"tool_call": {"name": "propose_diff", "arguments": {"cell": "A1"}}}
    e = RunEvent(run_id=run.id, kind="tool_call", detail="LLM called propose_diff", payload=payload)
    store.append_run_event(e)

    events = store.list_run_events(run.id)
    assert len(events) == 1
    assert events[0].payload == payload


# ---------------------------------------------------------------------------
# AgentRun counters
# ---------------------------------------------------------------------------

def test_run_tracks_tool_call_count(store: Store, run: AgentRun) -> None:
    run.tool_calls = 3
    store.save_agent_run(run)
    loaded = store.get_agent_run(run.id)
    assert loaded is not None
    assert loaded.tool_calls == 3


def test_list_agent_runs_with_events(store: Store, run: AgentRun) -> None:
    store.append_run_event(RunEvent(run_id=run.id, kind="tool_call", detail="test"))
    runs = store.list_agent_runs("wb_test")
    assert len(runs) == 1
    # Events are not embedded in runs by default
    assert hasattr(runs[0], "events")


# ---------------------------------------------------------------------------
# RunArtifacts
# ---------------------------------------------------------------------------

def test_build_artifacts_empty_run(store: Store, run: AgentRun) -> None:
    artifacts = store.build_artifacts(run)
    assert artifacts is not None
    assert artifacts.run_id == run.id
    assert artifacts.workbook_id == "wb_test"
    assert artifacts.workbook_name == "test"
    assert artifacts.findings == []
    assert artifacts.operations == []
    assert artifacts.timeline == []
    assert artifacts.dependency_impact == []


def test_build_artifacts_with_findings(store: Store, run: AgentRun) -> None:
    wb = store.get_workbook("wb_test")
    assert wb is not None
    from spreadbread_core.domain import WorkbookRisk
    wb.risks.append(
        WorkbookRisk(label="External ref", severity="high", location="Sheet1!A1", summary="External reference found")
    )
    store.save_workbook(wb)
    artifacts = store.build_artifacts(run)
    assert artifacts is not None
    assert len(artifacts.findings) == 1
    assert artifacts.findings[0].severity == "high"
    assert artifacts.findings[0].location == "Sheet1!A1"


def test_build_artifacts_with_operations(store: Store, run: AgentRun) -> None:
    from spreadbread_core.domain import _id, _now, Proposal, Operation, OperationTarget
    op = Operation(
        id=_id("op"), kind="set_cell_value", target=OperationTarget(cell="B2"),
        after={"value": "42"}, rationale="update value",
        risk="medium", required_capability="spreadsheet.write_cell",
    )
    item = ProposalItem(kind="update", cell="Sheet1!B2", after="42", rationale="update value", operation=op, status="pending")
    prop = Proposal(id=_id("prop"), workbook_id="wb_test", title="Test", summary="test",
                    requested_by="user", created_at=_now(), source_version_id="v0")
    prop.items.append(item)
    store.save_proposal(prop)
    artifacts = store.build_artifacts(run)
    assert artifacts is not None
    assert len(artifacts.operations) == 1
    assert artifacts.operations[0].kind == "set_cell_value"
    assert artifacts.operations[0].target == "B2"


def test_build_artifacts_with_timeline(store: Store, run: AgentRun) -> None:
    store.append_run_event(RunEvent(run_id=run.id, kind="tool_call", detail="test call"))
    store.append_run_event(RunEvent(run_id=run.id, kind="agent_reply", detail="test reply"))
    artifacts = store.build_artifacts(run)
    assert artifacts is not None
    assert len(artifacts.timeline) == 2
    assert artifacts.timeline[0].kind == "tool_call"
    assert artifacts.timeline[1].kind == "agent_reply"


def test_build_artifacts_missing_workbook(store: Store) -> None:
    """Deleting a workbook after a run should make build_artifacts return None."""
    wb = Workbook(id="wb_del", name="del", owner="tester",
                  created_at="2025-01-01T00:00:00", latest_version_id="v0")
    store.save_workbook(wb)
    orphan = AgentRun(workbook_id="wb_del", mode="inspect", prompt="?", model="test")
    store.save_agent_run(orphan)
    # Simulate book being gone by dropping the row directly
    with store._conn() as cx:
        cx.execute("DELETE FROM workbooks WHERE id = ?", ("wb_del",))
    result = store.build_artifacts(orphan)
    assert result is None


def test_build_artifacts_with_dependencies(store: Store, run: AgentRun) -> None:
    wb = store.get_workbook("wb_test")
    assert wb is not None
    wb.dependencies["A1"] = ["B1", "C1"]
    wb.dependencies["D5"] = ["E5"]
    store.save_workbook(wb)
    artifacts = store.build_artifacts(run)
    assert artifacts is not None
    assert len(artifacts.dependency_impact) == 2
    assert artifacts.dependency_impact[0].cell == "A1"
    assert artifacts.dependency_impact[0].dependents == ["B1", "C1"]


def test_build_artifacts_with_legacy_item(store: Store, run: AgentRun) -> None:
    """ProposalItem without an embedded Operation should still produce an artifact."""
    from spreadbread_core.domain import _id, _now, Proposal
    item = ProposalItem(kind="update", cell="C3", after="hello", rationale="test")
    prop = Proposal(id=_id("prop"), workbook_id="wb_test", title="Test", summary="test",
                    requested_by="user", created_at=_now(), source_version_id="v0")
    prop.items.append(item)
    store.save_proposal(prop)
    artifacts = store.build_artifacts(run)
    assert artifacts is not None
    assert len(artifacts.operations) == 1
    assert artifacts.operations[0].target == "C3"
    assert artifacts.operations[0].validation == "not_validated"
