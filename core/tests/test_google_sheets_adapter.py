"""Tests for the Google Sheets provider adapter.

All HTTP calls are mocked — no network access required.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import httpx
import pytest

from spreadbread_core.domain import Operation, OperationTarget
from spreadbread_core.providers.google_sheets import GoogleSheetsAdapter


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def adapter() -> GoogleSheetsAdapter:
    return GoogleSheetsAdapter(access_token="fake-token")


MOCK_METADATA_RESPONSE = {
    "properties": {"title": "Test Sheet"},
    "sheets": [
        {
            "properties": {
                "sheetId": 0,
                "title": "Sheet1",
                "gridProperties": {"rowCount": 100, "columnCount": 26},
            }
        },
        {
            "properties": {
                "sheetId": 1,
                "title": "Data",
                "gridProperties": {"rowCount": 50, "columnCount": 10},
            }
        },
    ],
    "namedRanges": [
        {"name": "MyRange", "range": "Sheet1!A1:C10"},
    ],
}

MOCK_VALUES_RESPONSE = {
    "valueRanges": [
        {
            "range": "Sheet1!A1:Z100",
            "values": [
                ["Header1", "Header2"],
                ["val1", "val2"],
            ],
        },
        {
            "range": "Data!A1:J50",
            "values": [
                ["Name", "Value"],
                ["foo", "42"],
            ],
        },
    ],
    "spreadsheetId": "test_sheet_id",
}


# ---------------------------------------------------------------------------
# Capabilities
# ---------------------------------------------------------------------------

def test_provider_id(adapter: GoogleSheetsAdapter) -> None:
    assert adapter.provider_id == "google_sheets"


def test_capabilities(adapter: GoogleSheetsAdapter) -> None:
    caps = adapter.capabilities
    assert caps.resource_kinds == ["spreadsheet"]
    assert caps.supports_read is True
    assert caps.supports_write is True
    assert caps.supports_comments is False
    assert caps.supports_versioning is True
    assert caps.supports_conflict_detection is False
    assert caps.supports_batch_apply is True
    assert caps.online is True


# ---------------------------------------------------------------------------
# Parse (read)
# ---------------------------------------------------------------------------

@patch.object(httpx, "get")
def test_parse_returns_workbook_shape(mock_get: MagicMock, adapter: GoogleSheetsAdapter) -> None:
    def side_effect(url, **kwargs):
        resp = MagicMock(spec=httpx.Response)
        resp.raise_for_status.return_value = None
        if "values:batchGet" in url:
            resp.json.return_value = MOCK_VALUES_RESPONSE
        else:
            resp.json.return_value = MOCK_METADATA_RESPONSE
        return resp

    mock_get.side_effect = side_effect

    raw = b"test_sheet_id"
    result = adapter.parse(raw, name="My Workbook")

    assert "sheets" in result
    assert len(result["sheets"]) == 2

    sheet1 = result["sheets"][0]
    assert sheet1["name"] == "Sheet1"
    assert sheet1["rows"] == 100
    assert sheet1["columns"] == 26
    assert sheet1["populated_cells"] == 2
    assert len(sheet1["sample_rows"]) == 2
    assert sheet1["sample_rows"][0] == ["Header1", "Header2"]

    sheet2 = result["sheets"][1]
    assert sheet2["name"] == "Data"
    assert sheet2["populated_cells"] == 2

    assert len(result["named_ranges"]) == 1
    assert result["named_ranges"][0]["name"] == "MyRange"

    # Verify both API calls were made with auth header
    calls = mock_get.call_args_list
    assert len(calls) == 2
    for call in calls:
        headers = call.kwargs.get("headers", {})
        assert headers.get("Authorization") == "Bearer fake-token"


@patch.object(httpx, "get")
def test_parse_with_specified_ranges(mock_get: MagicMock, adapter: GoogleSheetsAdapter) -> None:
    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.raise_for_status.return_value = None
    mock_resp.json.return_value = MOCK_METADATA_RESPONSE
    mock_get.return_value = mock_resp

    mock_val_resp = MagicMock(spec=httpx.Response)
    mock_val_resp.raise_for_status.return_value = None
    mock_val_resp.json.return_value = {
        "valueRanges": [
            {"range": "Sheet1!A1:B10", "values": [["H1", "H2"]]},
        ]
    }

    def side_effect(url, **kwargs):
        if "values:batchGet" in url:
            assert "ranges" in kwargs.get("params", {})
            ranges = kwargs["params"]["ranges"]
            assert "Sheet1" in str(ranges) or "Sheet1" in ranges
            return mock_val_resp
        return mock_resp

    mock_get.side_effect = side_effect

    raw = json.dumps({"spreadsheet_id": "test_sheet_id", "ranges": ["Sheet1!A1:B10"]}).encode()
    result = adapter.parse(raw)
    assert len(result["sheets"]) == 2


def test_parse_raises_on_empty_token() -> None:
    adapter = GoogleSheetsAdapter(access_token="")
    with pytest.raises(ValueError, match="access token"):
        adapter.parse(b"some_id")


# ---------------------------------------------------------------------------
# Apply (write)
# ---------------------------------------------------------------------------

@patch.object(httpx, "post")
def test_apply_operations_sends_batch_update(mock_post: MagicMock) -> None:
    adapter = GoogleSheetsAdapter(access_token="fake-token")
    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.raise_for_status.return_value = None
    mock_resp.content = b'{"spreadsheetId":"test","replies":[]}'
    mock_post.return_value = mock_resp

    ops = [
        Operation(
            kind="set_cell_value",
            target=OperationTarget(sheet="Sheet1", cell="A1"),
            after={"value": "hello"},
            rationale="test",
            risk="low",
            required_capability="spreadsheet.write_cell",
        ),
    ]

    result = adapter.apply_operations(ops, b"", metadata={"spreadsheet_id": "test_sheet_id"})

    assert result == b'{"spreadsheetId":"test","replies":[]}'
    mock_post.assert_called_once()
    call_url = mock_post.call_args[0][0]
    assert "test_sheet_id:batchUpdate" in call_url
    headers = mock_post.call_args.kwargs.get("headers", {})
    assert headers.get("Authorization") == "Bearer fake-token"

    sent_body = mock_post.call_args.kwargs.get("json", {})
    assert "requests" in sent_body
    assert len(sent_body["requests"]) == 1
    assert "updateCells" in sent_body["requests"][0]


@patch.object(httpx, "post")
def test_apply_operations_with_formula(mock_post: MagicMock) -> None:
    adapter = GoogleSheetsAdapter(access_token="fake-token")
    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.raise_for_status.return_value = None
    mock_resp.content = b'{"ok":true}'
    mock_post.return_value = mock_resp

    ops = [
        Operation(
            kind="set_cell_formula",
            target=OperationTarget(sheet="Sheet1", cell="B2"),
            after={"formula": "=SUM(A1:A10)"},
            rationale="sum column",
            risk="medium",
            required_capability="spreadsheet.write_formula",
        ),
    ]

    adapter.apply_operations(ops, b"", metadata={"spreadsheet_id": "tid"})
    body = mock_post.call_args.kwargs["json"]
    req = body["requests"][0]
    assert req["updateCells"]["rows"][0]["values"][0]["userEnteredValue"]["formulaValue"] == "=SUM(A1:A10)"


@patch.object(httpx, "post")
def test_apply_operations_clear_cell(mock_post: MagicMock) -> None:
    adapter = GoogleSheetsAdapter(access_token="fake-token")
    mock_resp = MagicMock(spec=httpx.Response)
    mock_resp.raise_for_status.return_value = None
    mock_resp.content = b"{}"
    mock_post.return_value = mock_resp

    ops = [
        Operation(
            kind="clear_cell",
            target=OperationTarget(sheet="Sheet1", cell="C3"),
            after={},
            rationale="clear stale",
            risk="medium",
            required_capability="spreadsheet.write_cell",
        ),
    ]

    adapter.apply_operations(ops, b"", metadata={"spreadsheet_id": "tid"})
    body = mock_post.call_args.kwargs["json"]
    req = body["requests"][0]
    assert req["updateCells"]["rows"][0]["values"][0] == {}


def test_apply_operations_raises_without_spreadsheet_id(adapter: GoogleSheetsAdapter) -> None:
    ops = [
        Operation(
            kind="set_cell_value",
            target=OperationTarget(cell="A1"),
            after={"value": "x"},
            rationale="test",
            risk="low",
            required_capability="spreadsheet.write_cell",
        ),
    ]
    with pytest.raises(ValueError, match="spreadsheet_id"):
        adapter.apply_operations(ops, b"")


def test_apply_operations_empty_ops(adapter: GoogleSheetsAdapter) -> None:
    result = adapter.apply_operations([], b"", metadata={"spreadsheet_id": "tid"})
    assert result == b"[]"


# ---------------------------------------------------------------------------
# Environment fallback
# ---------------------------------------------------------------------------

def test_token_fallback_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SPREADBREAD_GOOGLE_TOKEN", "env-token")
    adapter = GoogleSheetsAdapter()
    assert adapter._auth_headers["Authorization"] == "Bearer env-token"
