"""Cell reference parser used by the LibreOffice extension's Calc bridge.

This module is a vendored copy of core/spreadbread_core/cell_ref.py.
The extension is shipped as a self-contained .oxt and cannot import
from the daemon's package, so we duplicate the file. Both copies must
stay in sync — there is a CI guard for this in .github/workflows/ci.yml.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional, Union

_A1 = r"\$?[A-Z]+\$?\d+"
_SHEET = r"(?:'(?P<qsheet>[^']+)'|(?P<sheet>[^'!:$\d][^'!:$]*))"
_SINGLE = re.compile(rf"^(?:{_SHEET}!)?(?P<addr>{_A1})$")
_RANGE = re.compile(rf"^(?:{_SHEET}!)?(?P<a>{_A1}):(?P<b>{_A1})$")
_NAMED = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")
_ABS_SPLIT = re.compile(r"^(\$?)([A-Z]+)(\$?)(\d+)$")


@dataclass(frozen=True)
class CellRef:
    sheet: Optional[str]
    column: int
    row: int
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


def _parse_a1(addr: str):
    match = _ABS_SPLIT.match(addr)
    if not match:
        raise ValueError(f"invalid A1 address: {addr!r}")
    col_abs, letters, row_abs, row_str = match.groups()
    col = 0
    for ch in letters:
        col = col * 26 + (ord(ch) - ord("A") + 1)
    return col - 1, int(row_str) - 1, bool(col_abs), bool(row_abs)


def _resolve_sheet(match):
    return match.group("qsheet") or match.group("sheet")


def parse_cell(ref):
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


def parse_range(ref):
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


def parse(ref) -> Union[CellRef, RangeRef, NamedRef]:
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
