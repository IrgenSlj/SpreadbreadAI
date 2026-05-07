"""Read and write the active LibreOffice Calc document.

Imports are deferred so this module is importable for unit tests outside
LibreOffice (the `uno` module only exists inside the LO Python).
"""
from __future__ import annotations

import re
from typing import Any, Optional

CELL_REF = re.compile(r"^(?:'?(?P<sheet>[^'!]+)'?!)?(?P<col>[A-Z]+)(?P<row>\d+)$")


def parse_cell_ref(ref: str) -> tuple[Optional[str], int, int]:
    """Convert "Sheet!C7" into (sheet_name, column_index, row_index).

    Both indices are zero-based as expected by UNO's getCellByPosition.
    """
    match = CELL_REF.match(ref.strip())
    if not match:
        raise ValueError(f"invalid cell reference: {ref!r}")
    sheet = match.group("sheet")
    col_letters = match.group("col")
    row_number = int(match.group("row"))
    col = 0
    for ch in col_letters:
        col = col * 26 + (ord(ch) - ord("A") + 1)
    return sheet, col - 1, row_number - 1


class ActiveCalc:
    """Thin wrapper over the active SpreadsheetDocument."""

    def __init__(self, ctx: Any):
        self.ctx = ctx
        self._doc = None

    def _document(self):  # pragma: no cover - requires UNO
        if self._doc is None:
            smgr = self.ctx.ServiceManager
            desktop = smgr.createInstanceWithContext(
                "com.sun.star.frame.Desktop", self.ctx
            )
            self._doc = desktop.getCurrentComponent()
        return self._doc

    def file_url(self) -> Optional[str]:  # pragma: no cover - requires UNO
        doc = self._document()
        return doc.getURL() if doc and doc.getURL() else None

    def write_cell(self, ref: str, value: str) -> None:  # pragma: no cover - requires UNO
        sheet_name, col, row = parse_cell_ref(ref)
        doc = self._document()
        if sheet_name:
            sheet = doc.getSheets().getByName(sheet_name)
        else:
            sheet = doc.getSheets().getByIndex(0)
        cell = sheet.getCellByPosition(col, row)
        if value.startswith("="):
            cell.setFormula(value)
        else:
            try:
                cell.setValue(float(value))
            except ValueError:
                cell.setString(value)
