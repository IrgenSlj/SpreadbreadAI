"""Single source of truth for cell reference parsing.

Used by the apply pipeline (writes diffs into a workbook) and by the
LibreOffice extension's Calc bridge (writes into the active document).
A copy of this module lives under extension/python/spreadbreadai/ for
the bundled UNO plugin; both must stay in sync.

Supports:
- plain refs: A1, AA10
- absolute refs: $A$1, A$1, $A1
- sheet-qualified refs: Forecast!C7
- quoted sheet names with spaces or punctuation: 'Q2 Forecast'!C7
- ranges: A1:B2, Sheet1!C3:D9
- named ranges: bare identifiers without digits, returned as a separate kind

Fails loudly via ValueError on inputs it does not understand. Garbage
in -> exception, never silently mis-routed cells.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

# A1-style address with optional absolute markers.
_A1 = r"\$?[A-Z]+\$?\d+"

# Sheet portion: either a quoted name (allowing anything but a closing
# quote) or an unquoted identifier.
_SHEET = r"(?:'(?P<qsheet>[^']+)'|(?P<sheet>[^'!:$\d][^'!:$]*))"

_SINGLE = re.compile(rf"^(?:{_SHEET}!)?(?P<addr>{_A1})$")
_RANGE = re.compile(rf"^(?:{_SHEET}!)?(?P<a>{_A1}):(?P<b>{_A1})$")
_NAMED = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")
_ABS_SPLIT = re.compile(r"^(\$?)([A-Z]+)(\$?)(\d+)$")


@dataclass(frozen=True)
class CellRef:
    """A single A1-style cell reference."""

    sheet: Optional[str]
    column: int  # 0-based
    row: int  # 0-based
    column_absolute: bool = False
    row_absolute: bool = False

    @property
    def address(self) -> str:
        from string import ascii_uppercase

        col = self.column + 1
        letters = ""
        while col > 0:
            col, rem = divmod(col - 1, 26)
            letters = ascii_uppercase[rem] + letters
        c_prefix = "$" if self.column_absolute else ""
        r_prefix = "$" if self.row_absolute else ""
        return f"{c_prefix}{letters}{r_prefix}{self.row + 1}"


@dataclass(frozen=True)
class RangeRef:
    sheet: Optional[str]
    start: CellRef
    end: CellRef


@dataclass(frozen=True)
class NamedRef:
    name: str


def _parse_a1(addr: str) -> tuple[int, int, bool, bool]:
    match = _ABS_SPLIT.match(addr)
    if not match:
        raise ValueError(f"invalid A1 address: {addr!r}")
    col_abs, letters, row_abs, row_str = match.groups()
    col = 0
    for ch in letters:
        col = col * 26 + (ord(ch) - ord("A") + 1)
    return col - 1, int(row_str) - 1, bool(col_abs), bool(row_abs)


def _resolve_sheet(match: re.Match[str]) -> Optional[str]:
    return match.group("qsheet") or match.group("sheet")


def parse_cell(ref: str) -> CellRef:
    """Parse a single-cell reference. Raises ValueError on a range or named ref."""
    match = _SINGLE.match(ref.strip())
    if not match:
        raise ValueError(f"not a single cell reference: {ref!r}")
    column, row, col_abs, row_abs = _parse_a1(match.group("addr"))
    return CellRef(
        sheet=_resolve_sheet(match),
        column=column,
        row=row,
        column_absolute=col_abs,
        row_absolute=row_abs,
    )


def parse_range(ref: str) -> RangeRef:
    match = _RANGE.match(ref.strip())
    if not match:
        raise ValueError(f"not a range reference: {ref!r}")
    sheet = _resolve_sheet(match)
    a_col, a_row, a_col_abs, a_row_abs = _parse_a1(match.group("a"))
    b_col, b_row, b_col_abs, b_row_abs = _parse_a1(match.group("b"))
    return RangeRef(
        sheet=sheet,
        start=CellRef(None, a_col, a_row, a_col_abs, a_row_abs),
        end=CellRef(None, b_col, b_row, b_col_abs, b_row_abs),
    )


def parse(ref: str) -> CellRef | RangeRef | NamedRef:
    """Best-effort parse: returns whichever of cell / range / named matches.

    Use this when accepting model output where the kind is not known in
    advance. For sites that *must* be a single cell (e.g. propose_diff),
    call parse_cell directly so a range / name raises immediately.
    """
    stripped = ref.strip()
    try:
        return parse_cell(stripped)
    except ValueError:
        pass
    try:
        return parse_range(stripped)
    except ValueError:
        pass
    if _NAMED.match(stripped):
        return NamedRef(name=stripped)
    raise ValueError(f"unrecognized reference: {ref!r}")
