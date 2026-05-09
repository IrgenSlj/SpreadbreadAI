"""Cell reference parser tests."""
from __future__ import annotations

import pytest

from spreadbread_core.cell_ref import (
    CellRef,
    NamedRef,
    RangeRef,
    parse,
    parse_cell,
    parse_range,
)


@pytest.mark.parametrize(
    "ref,sheet,col,row,col_abs,row_abs,roundtrip",
    [
        ("A1", None, 0, 0, False, False, "A1"),
        ("AA10", None, 26, 9, False, False, "AA10"),
        ("$C$7", None, 2, 6, True, True, "$C$7"),
        ("$A1", None, 0, 0, True, False, "$A1"),
        ("A$1", None, 0, 0, False, True, "A$1"),
        ("Forecast!C7", "Forecast", 2, 6, False, False, "C7"),
        ("'Q2 Forecast'!AA10", "Q2 Forecast", 26, 9, False, False, "AA10"),
    ],
)
def test_parse_cell(ref, sheet, col, row, col_abs, row_abs, roundtrip) -> None:
    parsed = parse_cell(ref)
    assert parsed.sheet == sheet
    assert parsed.column == col
    assert parsed.row == row
    assert parsed.column_absolute is col_abs
    assert parsed.row_absolute is row_abs
    assert parsed.address == roundtrip


def test_parse_cell_rejects_range() -> None:
    with pytest.raises(ValueError):
        parse_cell("A1:B2")


def test_parse_cell_rejects_named() -> None:
    with pytest.raises(ValueError):
        parse_cell("growth_assumptions")


def test_parse_cell_rejects_garbage() -> None:
    with pytest.raises(ValueError):
        parse_cell("definitely not a cell")


def test_parse_range_simple() -> None:
    rng = parse_range("A1:B2")
    assert isinstance(rng, RangeRef)
    assert rng.sheet is None
    assert rng.start.column == 0 and rng.start.row == 0
    assert rng.end.column == 1 and rng.end.row == 1


def test_parse_range_with_sheet() -> None:
    rng = parse_range("Sheet1!C3:D9")
    assert rng.sheet == "Sheet1"
    assert rng.start.address == "C3"
    assert rng.end.address == "D9"


def test_parse_dispatch() -> None:
    assert isinstance(parse("A1"), CellRef)
    assert isinstance(parse("A1:B2"), RangeRef)
    assert isinstance(parse("growth_rate"), NamedRef)
    with pytest.raises(ValueError):
        parse("not-a-thing")


def test_address_roundtrip_for_high_column() -> None:
    parsed = parse_cell("AB100")
    assert parsed.column == 27
    assert parsed.address == "AB100"
