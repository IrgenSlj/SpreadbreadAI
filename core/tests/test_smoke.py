"""End-to-end smoke test: parse a tiny xlsx, run the registry, verify
proposal items are staged (not auto-applied) and audit events accrete.
"""
from __future__ import annotations

from pathlib import Path

from openpyxl import Workbook as XlsxWorkbook

from spreadbread_core.config import Config
from spreadbread_core.parser import parse_xlsx
from spreadbread_core.store import Store
from spreadbread_core.tools import ToolRegistry


def _build_sample_xlsx(tmp_path: Path) -> Path:
    book = XlsxWorkbook()
    sheet = book.active
    sheet.title = "Forecast"
    sheet.append(["Month", "Quota", "Forecast"])
    sheet.append(["Apr", 500000, 478000])
    sheet.append(["May", 520000, "=B3*1.05"])
    out = tmp_path / "sample.xlsx"
    book.save(out)
    return out


def test_end_to_end(tmp_path: Path) -> None:
    db_path = tmp_path / "test.sqlite3"
    store = Store(db_path)
    registry = ToolRegistry(store)

    # parse + save
    xlsx_path = _build_sample_xlsx(tmp_path)
    wb = parse_xlsx(xlsx_path)
    store.save_workbook(wb)
    assert wb.sheets[0].name == "Forecast"
    assert wb.sheets[0].formula_cells == 1

    # tool: list_workbooks
    listed = registry.call("list_workbooks", {})
    assert len(listed) == 1
    assert listed[0]["id"] == wb.id

    # tool: inspect_sheet
    sheet = registry.call("inspect_sheet", {"workbook_id": wb.id, "sheet_name": "Forecast"})
    assert sheet["formula_cells"] == 1

    # tool: propose_diff stages an item, does NOT mutate workbook
    result = registry.call(
        "propose_diff",
        {
            "workbook_id": wb.id,
            "cell": "Forecast!C3",
            "kind": "update",
            "before": "=B3*1.05",
            "after": "=B3*1.08",
            "rationale": "Aligns May forecast with revised growth assumption.",
        },
    )
    assert result["status"] == "pending"

    snap = store.review_snapshot(wb.id)
    assert snap is not None
    assert snap.proposal is not None
    assert len(snap.proposal.items) == 1
    item = snap.proposal.items[0]
    assert item.status == "pending"  # human approval still required
    assert item.cell == "Forecast!C3"

    # decision: approve
    proposal = store.decide_item(snap.proposal.id, item.id, "approve", reviewer="finance_manager")
    assert proposal.items[0].status == "approved"

    # audit accreted: upload? no — parser only writes via http path.
    # but tool flow appended proposal.created + proposal.item.added
    audit = store.list_audit(wb.id)
    actions = {e.action for e in audit}
    assert "proposal.created" in actions
    assert "proposal.item.added" in actions


def test_config_loads(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("SPREADBREAD_DATA_DIR", str(tmp_path))
    cfg = Config.load()
    assert cfg.db_path.parent == tmp_path
    assert cfg.model  # default present
