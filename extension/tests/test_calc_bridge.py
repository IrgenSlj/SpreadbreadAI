from spreadbreadai.calc_bridge import parse_cell_ref


def test_parse_simple() -> None:
    sheet, col, row = parse_cell_ref("A1")
    assert sheet is None and col == 0 and row == 0


def test_parse_with_sheet() -> None:
    sheet, col, row = parse_cell_ref("Forecast!C7")
    assert sheet == "Forecast" and col == 2 and row == 6


def test_parse_quoted_sheet() -> None:
    sheet, col, row = parse_cell_ref("'Q2 Forecast'!AA10")
    assert sheet == "Q2 Forecast" and col == 26 and row == 9


def test_parse_invalid() -> None:
    import pytest

    with pytest.raises(ValueError):
        parse_cell_ref("not-a-cell")
