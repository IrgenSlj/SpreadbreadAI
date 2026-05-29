"""Tests for standalone Operation storage and lifecycle.

Operations can live independently of ProposalItems in the
dedicated ``operations`` SQLite table.
"""
from __future__ import annotations

from pathlib import Path
from typing import Generator

import pytest

from spreadbread_core.domain import Operation, OperationTarget
from spreadbread_core.store import Store


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def store(tmp_path: Path) -> Generator[Store, None, None]:
    s = Store(tmp_path / "test.sqlite3")
    yield s


def _make_op(
    kind: str = "set_cell_value",
    cell: str = "Sheet1!A1",
    status: str = "draft",
) -> Operation:
    return Operation(
        kind=kind,  # type: ignore[arg-type]
        target=OperationTarget.from_cell(cell),
        before={"value": "old"},
        after={"value": "new"},
        rationale="test op",
        risk="low",
        required_capability="spreadsheet.write_cell",
        status=status,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# Save / Get / Delete
# ---------------------------------------------------------------------------

def test_save_and_get_operation(store: Store) -> None:
    op = _make_op()
    store.save_operation(op)
    loaded = store.get_operation(op.id)
    assert loaded is not None
    assert loaded.id == op.id
    assert loaded.kind == "set_cell_value"
    assert loaded.target.cell == "A1"
    assert loaded.target.sheet == "Sheet1"
    assert loaded.before == {"value": "old"}
    assert loaded.after == {"value": "new"}
    assert loaded.status == "draft"
    assert loaded.validation.status == "not_validated"


def test_get_missing_operation(store: Store) -> None:
    assert store.get_operation("nonexistent") is None


def test_delete_operation(store: Store) -> None:
    op = _make_op()
    store.save_operation(op)
    store.delete_operation(op.id)
    assert store.get_operation(op.id) is None


# ---------------------------------------------------------------------------
# List / Query
# ---------------------------------------------------------------------------

def test_list_operations_default(store: Store) -> None:
    op1 = _make_op(cell="A1", status="draft")
    op2 = _make_op(cell="B2", status="valid")
    store.save_operation(op1)
    store.save_operation(op2)
    all_ops = store.list_operations()
    assert len(all_ops) >= 2


def test_list_operations_by_resource(store: Store) -> None:
    op1 = _make_op(cell="A1")
    op1.resource_id = "wb_alpha"
    op2 = _make_op(cell="B2")
    op2.resource_id = "wb_beta"
    store.save_operation(op1)
    store.save_operation(op2)
    results = store.list_operations(resource_id="wb_alpha")
    assert len(results) == 1
    assert results[0].id == op1.id


def test_list_operations_by_status(store: Store) -> None:
    op1 = _make_op(status="draft")
    op2 = _make_op(status="valid")
    store.save_operation(op1)
    store.save_operation(op2)
    drafts = store.list_operations(status="draft")
    assert all(r.status == "draft" for r in drafts)


def test_list_operations_by_kind(store: Store) -> None:
    op1 = _make_op(kind="set_cell_value")
    op2 = _make_op(kind="clear_cell")
    store.save_operation(op1)
    store.save_operation(op2)
    results = store.list_operations(kind="clear_cell")
    assert all(r.kind == "clear_cell" for r in results)


# ---------------------------------------------------------------------------
# Validation lifecycle
# ---------------------------------------------------------------------------

def test_validate_and_save_non_formula(store: Store) -> None:
    op = _make_op(kind="set_cell_value")
    store.save_operation(op)
    result = store.validate_and_save_operation(op)
    assert result.validation.status == "valid"
    assert result.status == "valid"
    # Verify persistence
    loaded = store.get_operation(op.id)
    assert loaded is not None
    assert loaded.validation.status == "valid"
    assert loaded.status == "valid"


def test_validate_and_save_formula_circular(store: Store) -> None:
    op = Operation(
        kind="set_cell_formula",
        target=OperationTarget.from_cell("Sheet1!A1"),
        after={"formula": "=A1+1"},
        rationale="self-ref test",
        risk="medium",
        required_capability="spreadsheet.write_formula",
    )
    store.save_operation(op)
    deps = {"Sheet1!A1": []}
    result = store.validate_and_save_operation(op, deps, ["Sheet1"])
    assert result.validation.status == "invalid"
    assert result.status == "invalid"
    assert any("references itself" in m.lower() for m in result.validation.messages)


# ---------------------------------------------------------------------------
# Status transitions
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("from_status", "to_status", "should_work"),
    [
        ("draft", "valid", True),
        ("draft", "invalid", True),
        ("valid", "pending", True),
        ("valid", "invalid", True),
        ("invalid", "draft", True),
        ("pending", "approved", True),
        ("pending", "rejected", True),
        ("approved", "applied", True),
        ("approved", "pending", True),
        ("rejected", "pending", True),
        ("applied", "draft", False),
        ("draft", "approved", False),
        ("draft", "applied", False),
        ("applied", "approved", False),
    ],
)
def test_transition_operation(store: Store, from_status: str, to_status: str, should_work: bool) -> None:
    op = _make_op(status=from_status)
    store.save_operation(op)
    if should_work:
        result = store.transition_operation(op.id, to_status)
        assert result.status == to_status
        if to_status in ("approved", "rejected"):
            assert result.approval_status == to_status
    else:
        with pytest.raises(ValueError, match="Cannot transition"):
            store.transition_operation(op.id, to_status)


def test_transition_missing_operation(store: Store) -> None:
    with pytest.raises(KeyError):
        store.transition_operation("nonexistent", "valid")


# ---------------------------------------------------------------------------
# Embedded operation sync from proposal items
# ---------------------------------------------------------------------------

def test_decision_syncs_operation_to_store(store: Store) -> None:
    """When a proposal item is decided, its embedded operation should
    be saved to the standalone operations table."""
    from spreadbread_core.domain import ProposalItem, new_proposal, new_workbook

    wb = new_workbook(name="test_wb")
    store.save_workbook(wb)
    wb_id = wb.id
    op = _make_op(status="pending")
    item = ProposalItem(
        id="item_1",
        kind="update",
        cell="Sheet1!A1",
        after="new_val",
        rationale="test",
        operation=op,
    )
    proposal = new_proposal(workbook_id=wb_id, title="t", summary="s", requested_by="test")
    proposal.items.append(item)
    store.save_proposal(proposal)

    # Decision triggers _sync_operation
    store.decide_item(proposal.id, "item_1", "approve", "tester")

    loaded_op = store.get_operation(op.id)
    assert loaded_op is not None
    assert loaded_op.status == "approved"
    assert loaded_op.approval_status == "approved"
