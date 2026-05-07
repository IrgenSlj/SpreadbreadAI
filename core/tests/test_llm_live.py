"""Live test: requires Ollama running locally with gemma4:e2b pulled.

Skipped automatically if Ollama is unreachable.
"""
from __future__ import annotations

import os
from pathlib import Path

import httpx
import pytest
from openpyxl import Workbook as XlsxWorkbook

from spreadbread_core.llm import OllamaClient
from spreadbread_core.parser import parse_xlsx
from spreadbread_core.store import Store
from spreadbread_core.tools import ToolRegistry

OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
MODEL = os.environ.get("SPREADBREAD_MODEL", "gemma4:e2b")


def _ollama_up() -> bool:
    try:
        return httpx.get(f"{OLLAMA}/api/tags", timeout=2.0).status_code == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _ollama_up(), reason="ollama not reachable")


def _seed_workbook(tmp_path: Path, store: Store) -> str:
    book = XlsxWorkbook()
    sheet = book.active
    sheet.title = "Forecast"
    sheet.append(["Month", "Quota", "Forecast"])
    sheet.append(["Apr", 500000, 478000])
    sheet.append(["May", 520000, "=B3*1.05"])
    out = tmp_path / "sample.xlsx"
    book.save(out)
    wb = parse_xlsx(out)
    store.save_workbook(wb)
    return wb.id


def test_llm_can_call_tools(tmp_path: Path) -> None:
    store = Store(tmp_path / "live.sqlite3")
    registry = ToolRegistry(store)
    wb_id = _seed_workbook(tmp_path, store)

    client = OllamaClient(OLLAMA, MODEL, registry, max_rounds=6)
    try:
        result = client.chat(
            f"List the workbooks available. The workbook id we care about is {wb_id}. "
            "Inspect the Forecast sheet and tell me how many formula cells it has."
        )
    finally:
        client.close()

    assert result.rounds >= 1
    called_names = {c["name"] for c in result.tool_calls}
    # the model should have called at least one read tool
    assert called_names & {"list_workbooks", "get_review_snapshot", "inspect_sheet"}
