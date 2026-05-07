from __future__ import annotations

from pathlib import Path
from typing import Optional

from openpyxl import load_workbook as _load

from .domain import Workbook, WorkbookRisk, WorkbookSheet, new_workbook


def parse_xlsx(path: Path, name: Optional[str] = None, owner: str = "user") -> Workbook:
    wb = new_workbook(name or path.stem, owner=owner)
    book = _load(path, data_only=False, read_only=True)
    sheets: list[WorkbookSheet] = []
    risks: list[WorkbookRisk] = []
    for ws in book.worksheets:
        rows = ws.max_row or 0
        cols = ws.max_column or 0
        formula_cells = 0
        populated = 0
        sample: list[list[str]] = []
        for i, row in enumerate(ws.iter_rows(values_only=False)):
            sample_row: list[str] = []
            for cell in row:
                if cell.value is None:
                    sample_row.append("")
                    continue
                populated += 1
                value = cell.value
                if isinstance(value, str) and value.startswith("="):
                    formula_cells += 1
                sample_row.append(str(value))
            if i < 5:
                sample.append(sample_row[:8])
        sheets.append(
            WorkbookSheet(
                name=ws.title,
                rows=rows,
                columns=cols,
                formula_cells=formula_cells,
                populated_cells=populated,
                sample_rows=sample,
            )
        )
        if formula_cells > 0:
            risks.append(
                WorkbookRisk(
                    label="Formula review pending",
                    severity="medium",
                    location=f"{ws.title}!A1:{chr(64 + min(cols, 26))}{rows}",
                    summary=f"{formula_cells} formula cells need first-pass review.",
                )
            )
    wb.sheets = sheets
    wb.risks = risks
    return wb
