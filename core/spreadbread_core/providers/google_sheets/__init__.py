"""Google Sheets provider adapter.

Reads and writes spreadsheets through the Google Sheets API v4 using
a short-lived OAuth 2.0 access token.  The token is supplied via config
(``SPREADBREAD_GOOGLE_TOKEN`` env var) so the adapter itself never
handles the OAuth redirect flow.

Mocked in tests — no test requires network access or real credentials.
"""
from __future__ import annotations

import json
import os
from typing import Any

from .. import ProviderAdapter, ProviderCapabilities

import httpx

SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"


class GoogleSheetsAdapter(ProviderAdapter):
    """Read/write adapter for Google Sheets.

    Parameters
    ----------
    access_token : str
        A valid Google OAuth 2.0 access token.  If empty the adapter
        falls back to ``SPREADBREAD_GOOGLE_TOKEN`` in the environment.
    """

    def __init__(self, access_token: str = "") -> None:
        self._access_token = access_token or os.environ.get("SPREADBREAD_GOOGLE_TOKEN", "")

    @property
    def provider_id(self) -> str:
        return "google_sheets"

    @property
    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            resource_kinds=["spreadsheet"],
            supports_read=True,
            supports_write=True,
            supports_comments=False,
            supports_versioning=True,
            supports_conflict_detection=False,
            supports_batch_apply=True,
            online=True,
        )

    # -- headers -----------------------------------------------------------
    @property
    def _auth_headers(self) -> dict[str, str]:
        if not self._access_token:
            raise ValueError(
                "Google Sheets adapter requires an OAuth 2.0 access token. "
                "Set SPREADBREAD_GOOGLE_TOKEN or pass access_token to the constructor."
            )
        return {"Authorization": f"Bearer {self._access_token}"}

    # -- parse (read) ------------------------------------------------------
    def parse(self, raw: bytes, name: str = "workbook") -> dict[str, Any]:
        """Fetch spreadsheet metadata and cell values.

        ``raw`` is the UTF-8-encoded spreadsheet *id* (the long hash from
        the Sheets URL) or a JSON dict containing ``{"spreadsheet_id": …,
        "ranges": …}``.
        """
        raw_str = raw.decode("utf-8").strip()
        try:
            parsed = json.loads(raw_str)
        except json.JSONDecodeError:
            spreadsheet_id = raw_str
            ranges = None
        else:
            spreadsheet_id = parsed.get("spreadsheet_id", raw_str)
            ranges = parsed.get("ranges")

        meta = self._fetch_metadata(spreadsheet_id, name=name)
        values = self._fetch_values(spreadsheet_id, meta.get("sheets", []), ranges)

        return {
            "sheets": [
                {
                    "name": s["name"],
                    "rows": s.get("row_count", 0),
                    "columns": s.get("column_count", 0),
                    "formula_cells": 0,
                    "populated_cells": len(v.get("rows", [])),
                    "sample_rows": v.get("rows", [])[:5],
                    "external_references": [],
                    "broken_references": [],
                    "stale_markers": [],
                }
                for s, v in zip(meta.get("sheets", []), values)
            ],
            "risks": [],
            "dependencies": {},
            "named_ranges": [
                {"name": nr["name"], "reference": nr.get("range", "")}
                for nr in meta.get("named_ranges", [])
            ],
        }

    def _fetch_metadata(self, spreadsheet_id: str, name: str = "workbook") -> dict[str, Any]:
        """GET spreadsheet metadata (sheets, named ranges, …)."""
        url = f"{SHEETS_BASE}/{spreadsheet_id}"
        params = {"fields": "properties,sheets.properties,namedRanges"}
        resp = httpx.get(url, headers=self._auth_headers, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        sheets = []
        for s in data.get("sheets", []):
            p = s.get("properties", {})
            sheets.append({
                "name": p.get("title", ""),
                "row_count": p.get("gridProperties", {}).get("rowCount", 0),
                "column_count": p.get("gridProperties", {}).get("columnCount", 0),
            })
        return {
            "name": data.get("properties", {}).get("title", name),
            "sheets": sheets,
            "named_ranges": [
                {"name": nr["name"], "range": nr.get("range", "")}
                for nr in data.get("namedRanges", [])
            ],
        }

    def _fetch_values(
        self, spreadsheet_id: str, sheets: list[dict[str, Any]], ranges: list[str] | None = None
    ) -> list[dict[str, Any]]:
        """Batch-get values for the given sheets (or all if ranges is None)."""
        if ranges is None:
            ranges = [f"'{s['name']}'!1:1000" for s in sheets]
        url = f"{SHEETS_BASE}/{spreadsheet_id}/values:batchGet"
        params = {"ranges": ranges, "valueRenderOption": "FORMATTED_VALUE"}
        resp = httpx.get(url, headers=self._auth_headers, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        result = []
        vr = data.get("valueRanges", [])
        for i, s in enumerate(sheets):
            rows = vr[i].get("values", []) if i < len(vr) else []
            result.append({"rows": [[str(c) for c in row] for row in rows]})
        return result

    # -- apply (write) -----------------------------------------------------
    def apply_operations(
        self,
        operations: list[Any],
        base_raw: bytes,
        metadata: dict[str, Any] | None = None,
    ) -> bytes:
        """Apply approved operations through the Sheets API batchUpdate.

        ``base_raw`` is ignored (Google Sheets owns the canonical version).
        ``metadata`` must include ``spreadsheet_id``.
        """
        spreadsheet_id = (metadata or {}).get("spreadsheet_id", "")
        if not spreadsheet_id:
            raise ValueError("google_sheets adapter requires metadata.spreadsheet_id")

        requests = []
        for op in operations:
            req = self._operation_to_request(op)
            if req is not None:
                requests.append(req)

        if not requests:
            return b"[]"

        body = {"requests": requests}
        url = f"{SHEETS_BASE}/{spreadsheet_id}:batchUpdate"
        resp = httpx.post(url, headers=self._auth_headers, json=body, timeout=30)
        resp.raise_for_status()
        return resp.content

    def _operation_to_request(self, operation: Any) -> dict[str, Any] | None:
        kind = operation.kind
        target = operation.target

        if kind == "set_cell_value":
            value = operation.after.get("value", "")
            return {
                "updateCells": {
                    "range": {
                        "sheetId": target.sheet,
                        "startRowIndex": 0,
                        "startColumnIndex": 0,
                    },
                    "rows": [{"values": [{"userEnteredValue": {"stringValue": value}}]}],
                    "fields": "userEnteredValue",
                }
            }

        if kind == "set_cell_formula":
            formula = operation.after.get("formula", "")
            return {
                "updateCells": {
                    "range": {
                        "sheetId": target.sheet,
                    },
                    "rows": [{"values": [{"userEnteredValue": {"formulaValue": formula}}]}],
                    "fields": "userEnteredValue",
                }
            }

        if kind == "clear_cell":
            return {
                "updateCells": {
                    "range": {
                        "sheetId": target.sheet,
                    },
                    "rows": [{"values": [{}]}],
                    "fields": "userEnteredValue",
                }
            }

        return None
