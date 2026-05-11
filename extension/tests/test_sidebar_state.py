from spreadbreadai.sidebar import (
    _file_url_to_path,
    _remember_workbook,
    _remembered_workbook,
)


def test_file_url_to_path_decodes_spaces() -> None:
    assert _file_url_to_path("file:///tmp/Q2%20Forecast.xlsx") == "/tmp/Q2 Forecast.xlsx"


def test_file_url_to_path_handles_windows_drive_paths() -> None:
    assert _file_url_to_path("file:///C:/Users/Ada/Forecast.xlsx") == "C:/Users/Ada/Forecast.xlsx"


def test_remembers_workbook_per_file_url() -> None:
    _remember_workbook("file:///tmp/a.xlsx", "wb_a")
    _remember_workbook("file:///tmp/b.xlsx", "wb_b")

    assert _remembered_workbook("file:///tmp/a.xlsx") == "wb_a"
    assert _remembered_workbook("file:///tmp/b.xlsx") == "wb_b"
    assert _remembered_workbook("file:///tmp/c.xlsx") is None
