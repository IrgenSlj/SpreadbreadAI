from __future__ import annotations

from typing import Any

from spreadbread_core.llm import OllamaClient
from spreadbread_core.store import Store
from spreadbread_core.tools import ToolRegistry


class _FakeResponse:
    def __init__(self, payload: dict[str, Any]):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeHttp:
    def __init__(self, responses: list[dict[str, Any]]):
        self.responses = responses
        self.requests: list[dict[str, Any]] = []

    def post(self, url: str, json: dict[str, Any]) -> _FakeResponse:  # noqa: A002
        self.requests.append({"url": url, "json": json})
        return _FakeResponse(self.responses.pop(0))


def test_llm_chat_filters_tools_by_mode(tmp_path) -> None:
    registry = ToolRegistry(Store(tmp_path / "llm.sqlite3"))
    client = OllamaClient("http://ollama.test", "test-model", registry)
    fake_http = _FakeHttp([{"message": {"content": "ok"}}])
    client._http = fake_http  # noqa: SLF001

    result = client.chat("inspect only", mode="inspect")

    assert result.final_message == "ok"
    names = {tool["function"]["name"] for tool in fake_http.requests[0]["json"]["tools"]}
    assert "inspect_sheet" in names
    assert "propose_diff" not in names


def test_llm_chat_denies_disallowed_tool_call_even_if_model_requests_it(tmp_path) -> None:
    registry = ToolRegistry(Store(tmp_path / "llm.sqlite3"))
    client = OllamaClient("http://ollama.test", "test-model", registry, max_rounds=2)
    fake_http = _FakeHttp(
        [
            {
                "message": {
                    "content": "",
                    "tool_calls": [
                        {
                            "function": {
                                "name": "propose_diff",
                                "arguments": {"workbook_id": "wb_missing", "cell": "A1", "kind": "update", "rationale": "x"},
                            }
                        }
                    ],
                }
            },
            {"message": {"content": "done"}},
        ]
    )
    client._http = fake_http  # noqa: SLF001

    result = client.chat("inspect only", mode="inspect")

    assert result.final_message == "done"
    assert result.tool_calls[0]["name"] == "propose_diff"
    assert "not available in 'inspect' mode" in result.tool_calls[0]["result"]
