"""HTTP client for the SpreadbreadAI core daemon.

Uses only the Python standard library so the extension does not depend
on third-party packages inside LibreOffice's Python environment.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional


class DaemonError(RuntimeError):
    """Raised when the daemon is unreachable or returns a non-2xx response."""


@dataclass
class DaemonClient:
    base_url: str = "http://127.0.0.1:8765"
    timeout: float = 60.0

    # --- low-level -----------------------------------------------------
    def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        url = f"{self.base_url.rstrip('/')}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                payload = resp.read()
                if not payload:
                    return None
                return json.loads(payload.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise DaemonError(f"{exc.code} {exc.reason}: {exc.read().decode('utf-8', 'ignore')}") from exc
        except urllib.error.URLError as exc:
            raise DaemonError(f"could not reach daemon at {self.base_url}: {exc.reason}") from exc

    # --- public API ----------------------------------------------------
    def healthz(self) -> dict[str, Any]:
        return self._request("GET", "/healthz")

    def list_workbooks(self) -> list[dict[str, Any]]:
        return self._request("GET", "/api/workbooks") or []

    def review_snapshot(self, workbook_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/workbooks/{workbook_id}/review")

    def chat(self, workbook_id: str, message: str) -> dict[str, Any]:
        return self._request("POST", f"/api/workbooks/{workbook_id}/chat", {"message": message})

    def decide(self, proposal_id: str, item_id: str, decision: str, reviewer: str, comment: str | None = None) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/proposals/{proposal_id}/items/{item_id}/decision",
            {"decision": decision, "reviewer": reviewer, "comment": comment},
        )

    def apply(self, proposal_id: str, reviewer: str = "user") -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/proposals/{proposal_id}/apply",
            {"reviewer": reviewer},
        )

    def upload_workbook(self, file_path: str) -> dict[str, Any]:
        """Upload via multipart/form-data using stdlib only.

        UNO ships its own Python; we cannot rely on `requests`. This builds
        the multipart body by hand.
        """
        boundary = "----spreadbread-boundary"
        with open(file_path, "rb") as fh:
            file_bytes = fh.read()
        filename = file_path.rsplit("/", 1)[-1]
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
        ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url.rstrip('/')}/api/workbooks/upload",
            data=body,
            method="POST",
        )
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise DaemonError(f"upload failed: {exc.code} {exc.reason}") from exc
        except urllib.error.URLError as exc:
            raise DaemonError(f"upload failed: {exc.reason}") from exc
