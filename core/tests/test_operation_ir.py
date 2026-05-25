from __future__ import annotations

from spreadbread_core.domain import ProposalItem


def test_update_formula_item_converts_to_operation() -> None:
    item = ProposalItem(
        id="diff_abc123",
        kind="update",
        cell="Forecast!C3",
        before="=B3*1.05",
        after="=B3*1.08",
        after_type="formula",
        rationale="Use revised growth assumption.",
    )

    operation = item.to_operation(resource_id="wb_123", validation_status="valid")

    assert operation.id == "op_abc123"
    assert operation.resource_id == "wb_123"
    assert operation.provider_id == "local_xlsx"
    assert operation.resource_kind == "spreadsheet"
    assert operation.kind == "set_cell_formula"
    assert operation.target.sheet == "Forecast"
    assert operation.target.cell == "C3"
    assert operation.before == {"formula": "=B3*1.05"}
    assert operation.after == {"formula": "=B3*1.08"}
    assert operation.required_capability == "spreadsheet.write_formula"
    assert operation.risk == "medium"
    assert operation.validation.status == "valid"
    assert operation.status == "pending"
    assert operation.approval_status == "pending"


def test_comment_item_converts_to_low_risk_comment_operation() -> None:
    item = ProposalItem(
        id="diff_comment",
        kind="comment",
        cell="Forecast!A1",
        after="Check source data before close.",
        rationale="Reviewer note",
    )

    operation = item.to_operation(resource_id="wb_123")

    assert operation.kind == "add_cell_comment"
    assert operation.after == {"comment": "Check source data before close."}
    assert operation.required_capability == "spreadsheet.comment"
    assert operation.risk == "low"


def test_remove_item_converts_to_clear_cell_operation() -> None:
    item = ProposalItem(
        id="diff_remove",
        kind="remove",
        cell="Forecast!B2",
        before="500000",
        rationale="Remove stale input.",
    )

    operation = item.to_operation(resource_id="wb_123")

    assert operation.kind == "clear_cell"
    assert operation.before == {"value": "500000"}
    assert operation.after == {"value": None, "value_type": "blank"}
    assert operation.required_capability == "spreadsheet.write_cell"
