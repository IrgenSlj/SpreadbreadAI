"""Read and write the active LibreOffice Calc document.

Imports are deferred so this module is importable for unit tests outside
LibreOffice (the `uno` module only exists inside the LO Python).
"""
from __future__ import annotations

from typing import Any, Optional

from .cell_ref import parse_cell


def parse_cell_ref(ref: str) -> tuple[Optional[str], int, int]:
    """Compatibility wrapper for the historical (sheet, col, row) tuple shape.

    New code should call cell_ref.parse_cell directly to also handle
    absolute markers, ranges, and named ranges.
    """
    parsed = parse_cell(ref)
    return parsed.sheet, parsed.column, parsed.row


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

    def write_cell(
        self,
        ref: str,
        value: str | None,
        value_type: str | None = None,
    ) -> None:  # pragma: no cover - requires UNO
        parsed = parse_cell(ref)
        sheet_name, col, row = parsed.sheet, parsed.column, parsed.row
        doc = self._document()
        if sheet_name:
            sheet = doc.getSheets().getByName(sheet_name)
        else:
            sheet = doc.getSheets().getByIndex(0)
        cell = sheet.getCellByPosition(col, row)
        if value is None or value_type == "blank":
            # VALUE | DATETIME | STRING | ANNOTATION | FORMULA
            cell.clearContents(31)
        elif value_type == "formula" or (value_type is None and value.startswith("=")):
            cell.setFormula(value)
        elif value_type == "number":
            cell.setValue(float(value))
        elif value_type == "boolean":
            normalized = value.strip().lower()
            if normalized in ("true", "1", "yes"):
                cell.setValue(1.0)
            elif normalized in ("false", "0", "no"):
                cell.setValue(0.0)
            else:
                raise ValueError(f"invalid boolean cell value: {value!r}")
        else:
            cell.setString(value)
