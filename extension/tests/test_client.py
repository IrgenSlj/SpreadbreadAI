"""DaemonClient tests using a stdlib http.server fixture."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from spreadbreadai.client import DaemonClient, DaemonError


class _Handler(BaseHTTPRequestHandler):
    state: dict = {"healthz_calls": 0, "last_chat": None}

    def log_message(self, *args, **kwargs) -> None:  # silence
        pass

    def do_GET(self) -> None:
        if self.path == "/healthz":
            _Handler.state["healthz_calls"] += 1
            self._json(200, {"ok": True, "model": "gemma4:e2b"})
        elif self.path == "/api/workbooks":
            self._json(200, [{"id": "wb_1", "name": "Q2"}])
        elif self.path.startswith("/api/workbooks/") and self.path.endswith("/review"):
            self._json(200, {"workbook": {"id": "wb_1"}})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b""
        if self.path.endswith("/chat"):
            _Handler.state["last_chat"] = json.loads(body.decode("utf-8"))
            self._json(200, {"reply": "ok", "rounds": 1, "tool_calls": []})
        else:
            self._json(404, {"error": "not found"})

    def _json(self, code: int, payload) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def server():
    httpd = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_healthz(server):
    port = server.server_address[1]
    client = DaemonClient(base_url=f"http://127.0.0.1:{port}")
    assert client.healthz()["ok"] is True


def test_chat(server):
    port = server.server_address[1]
    client = DaemonClient(base_url=f"http://127.0.0.1:{port}")
    result = client.chat("wb_1", "review please")
    assert result["reply"] == "ok"
    assert _Handler.state["last_chat"] == {"message": "review please"}


def test_unreachable():
    client = DaemonClient(base_url="http://127.0.0.1:1")
    with pytest.raises(DaemonError):
        client.healthz()
