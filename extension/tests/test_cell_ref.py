"""Mirror of test_cell_ref against the vendored extension copy."""
from __future__ import annotations

import pytest

from spreadbreadai.cell_ref import CellRef, NamedRef, RangeRef, parse, parse_cell


def test_parse_cell_basic() -> None:
    parsed = parse_cell("Forecast!C7")
    assert isinstance(parsed, CellRef)
    assert parsed.sheet == "Forecast"
    assert (parsed.column, parsed.row) == (2, 6)


def test_parse_absolute() -> None:
    parsed = parse_cell("$AA$10")
    assert parsed.column_absolute and parsed.row_absolute
    assert parsed.address == "$AA$10"


def test_parse_dispatch() -> None:
    assert isinstance(parse("A1:B2"), RangeRef)
    assert isinstance(parse("growth_rate"), NamedRef)
    with pytest.raises(ValueError):
        parse("not-a-thing")
