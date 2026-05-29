"""Tests for the pre-apply validators module.

Covers circular-reference detection (direct and indirect), broken sheet
references, and the safety-net re-validation in the apply pipeline.
"""
from __future__ import annotations

import pytest

from spreadbread_core.domain import Operation, OperationTarget
from spreadbread_core.validators import validate_operation


def test_non_formula_operation_is_always_valid() -> None:
    op = Operation(
        kind="set_cell_value",
        target=OperationTarget(sheet="Sheet1", cell="A1"),
        after={"value": "42", "value_type": "number"},
        rationale="test",
        risk="medium",
        required_capability="spreadsheet.write_cell",
    )
    result = validate_operation(op, {}, ["Sheet1"])
    assert result.status == "valid"


def test_direct_circular_reference_is_detected() -> None:
    """A formula that references its own cell."""
    op = Operation(
        kind="set_cell_formula",
        target=OperationTarget(sheet="Sheet1", cell="A1"),
        after={"formula": "=A1+1"},
        rationale="test",
        risk="medium",
        required_capability="spreadsheet.write_formula",
    )
    result = validate_operation(op, {}, ["Sheet1"])
    assert result.status == "invalid"
    assert any("circular" in msg.lower() for msg in result.messages)


def test_indirect_circular_reference_is_detected() -> None:
    """Formula at A1 references B1, and B1 already depends on A1."""
    op = Operation(
        kind="set_cell_formula",
        target=OperationTarget(sheet="Sheet1", cell="A1"),
        after={"formula": "=B1+1"},
        rationale="test",
        risk="medium",
        required_capability="spreadsheet.write_formula",
    )
    deps = {"Sheet1!B1": ["Sheet1!A1"]}  # B1 depends on A1 → cycle
    result = validate_operation(op, deps, ["Sheet1"])
    assert result.status == "invalid"
    assert any("circular" in msg.lower() for msg in result.messages)


def test_no_circular_reference_without_cycle() -> None:
    """A formula referencing a cell with no back-edge is valid."""
    op = Operation(
        kind="set_cell_formula",
        target=OperationTarget(sheet="Sheet1", cell="A1"),
        after={"formula": "=B1+1"},
        rationale="test",
        risk="medium",
        required_capability="spreadsheet.write_formula",
    )
    deps = {"Sheet1!B1": ["Sheet1!C1"]}  # B1 depends on C1, not A1 → no cycle
    result = validate_operation(op, deps, ["Sheet1"])
    assert result.status == "valid"


def test_broken_sheet_reference_is_detected() -> None:
    """A formula referencing a sheet that does not exist."""
    op = Operation(
        kind="set_cell_formula",
        target=OperationTarget(sheet="Sheet1", cell="A1"),
        after={"formula": "=MissingSheet!B1+1"},
        rationale="test",
        risk="medium",
        required_capability="spreadsheet.write_formula",
    )
    result = validate_operation(op, {}, ["Sheet1"])
    assert result.status == "invalid"
    assert any("sheet" in msg.lower() for msg in result.messages)


def test_valid_formula_passes_validation() -> None:
    """A formula with no issues passes."""
    op = Operation(
        kind="set_cell_formula",
        target=OperationTarget(sheet="Sheet1", cell="A1"),
        after={"formula": "=SUM(B1:B10)"},
        rationale="test",
        risk="medium",
        required_capability="spreadsheet.write_formula",
    )
    result = validate_operation(op, {}, ["Sheet1"])
    assert result.status == "valid"


def test_comment_operation_does_not_trigger_validator() -> None:
    """Non-formula operations skip validation entirely."""
    op = Operation(
        kind="add_cell_comment",
        target=OperationTarget(sheet="Sheet1", cell="A1"),
        after={"comment": "Reviewed"},
        rationale="comment",
        risk="low",
        required_capability="spreadsheet.comment",
    )
    result = validate_operation(op, {}, ["Sheet1"])
    assert result.status == "valid"


def test_empty_formula_is_valid() -> None:
    """An empty formula string does not fail validation."""
    op = Operation(
        kind="set_cell_formula",
        target=OperationTarget(sheet="Sheet1", cell="A1"),
        after={"formula": ""},
        rationale="clear",
        risk="medium",
        required_capability="spreadsheet.write_formula",
    )
    result = validate_operation(op, {}, ["Sheet1"])
    assert result.status == "valid"


def test_apply_rejects_cyclic_formula(tmp_path) -> None:
    """End-to-end: proposal with a cyclic formula is rejected by apply."""
    from openpyxl import Workbook as XlsxWorkbook

    from spreadbread_core.apply import ApplyError, apply_proposal
    from spreadbread_core.domain import ProposalItem, new_proposal
    from spreadbread_core.parser import parse_xlsx
    from spreadbread_core.store import Store

    store = Store(tmp_path / "validators_e2e.sqlite3")

    book = XlsxWorkbook()
    sheet = book.active
    sheet.title = "Forecast"
    sheet.append(["Month", "Quota", "Forecast"])
    sheet.append(["Apr", 500000, 478000])
    sheet.append(["May", 520000, "=B3*1.05"])
    xlsx_path = tmp_path / "sample.xlsx"
    book.save(xlsx_path)

    wb = parse_xlsx(xlsx_path)
    store.save_workbook(wb)
    raw_bytes = xlsx_path.read_bytes()
    store.save_version_bytes(wb.id, wb.latest_version_id, raw_bytes)

    import hashlib
    sha = hashlib.sha256(raw_bytes).hexdigest()
    proposal = new_proposal(
        workbook_id=wb.id,
        title="cycle test",
        summary="test",
        requested_by="llm",
        source_version_id=wb.latest_version_id,
        source_version_sha256=sha,
    )
    item = ProposalItem(
        kind="update",
        cell="Forecast!C3",
        before="=B3*1.05",
        after="=C3+1",  # self-reference!
        after_type="formula",
        rationale="test",
    )
    item.ensure_operation(resource_id=wb.id, validation_status="not_validated")
    from spreadbread_core.validators import validate_operation

    assert item.operation is not None
    item.operation.validation = validate_operation(
        item.operation, wb.dependencies, [s.name for s in wb.sheets]
    )
    proposal.items.append(item)
    for i in proposal.items:
        i.status = "approved"
        i.operation.status = "approved"
    store.save_proposal(proposal)

    with pytest.raises(ApplyError, match="invalid"):
        apply_proposal(store, proposal.id, reviewer="test")
