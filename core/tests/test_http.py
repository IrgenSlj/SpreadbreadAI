"""HTTP-level smoke tests using FastAPI's TestClient.

Specifically guards against the FastAPI + `from __future__ import annotations`
trap where Pydantic body models defined inside `create_app` cannot be
resolved by FastAPI's type-hint introspection.
"""
from __future__ import annotations

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook as XlsxWorkbook

from spreadbread_core.config import Config
from spreadbread_core.http import create_app


@pytest.fixture
def client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("SPREADBREAD_DATA_DIR", str(tmp_path))
    cfg = Config.load()
    return TestClient(create_app(cfg))


def _sample_xlsx() -> bytes:
    book = XlsxWorkbook()
    sheet = book.active
    sheet.title = "Forecast"
    sheet.append(["Month", "Quota", "Forecast"])
    sheet.append(["Apr", 500000, 478000])
    sheet.append(["May", 520000, "=B3*1.05"])
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def test_healthz(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert "list_workbooks" in body["tools"]


def test_tools_endpoint_filters_by_mode(client: TestClient) -> None:
    response = client.get("/api/tools", params={"mode": "inspect"})
    assert response.status_code == 200, response.text

    names = {tool["function"]["name"] for tool in response.json()}

    assert "inspect_sheet" in names
    assert "propose_diff" not in names


def test_tools_endpoint_rejects_invalid_mode(client: TestClient) -> None:
    response = client.get("/api/tools", params={"mode": "bogus"})

    assert response.status_code == 400
    assert "mode must be one of" in response.text


def test_upload_and_review(client: TestClient) -> None:
    files = {"file": ("sample.xlsx", _sample_xlsx(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    upload = client.post("/api/workbooks/upload", files=files)
    assert upload.status_code == 200, upload.text
    wb = upload.json()
    assert wb["sheets"][0]["name"] == "Forecast"
    assert wb["trust_mode"] == "review"

    review = client.get(f"/api/workbooks/{wb['id']}/review")
    assert review.status_code == 200
    assert review.json()["workbook"]["id"] == wb["id"]


def test_chat_endpoint_accepts_json_body(client: TestClient, monkeypatch) -> None:
    """Direct guard against the body-model resolution bug."""
    files = {"file": ("sample.xlsx", _sample_xlsx(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    wb = client.post("/api/workbooks/upload", files=files).json()

    # Stub the LLM so this test does not require Ollama.
    from spreadbread_core import http as http_module
    from spreadbread_core.llm import ChatResult

    captured: dict = {}

    def fake_chat(self, message: str, system: str = "", mode=None) -> ChatResult:  # noqa: ANN001, ARG001
        captured["message"] = message
        captured["mode"] = mode
        return ChatResult(final_message="ok", tool_calls=[], rounds=1)

    monkeypatch.setattr(http_module.OllamaClient, "chat", fake_chat)

    response = client.post(f"/api/workbooks/{wb['id']}/chat", json={"message": "review", "mode": "inspect"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["run_id"].startswith("run_")
    assert payload["reply"] == "ok"
    assert payload["rounds"] == 1
    assert payload["mode"] == "inspect"
    assert "review" in captured["message"]
    assert captured["mode"] == "inspect"

    from spreadbread_core.config import Config
    from spreadbread_core.store import Store

    store = Store(Config.load().db_path)
    run = store.get_agent_run(payload["run_id"])
    assert run is not None
    assert run.status == "completed"
    assert run.mode == "inspect"
    assert run.prompt == "review"
    actions = {event.action for event in store.list_audit(wb["id"])}
    assert "agent.run.started" in actions
    assert "agent.run.completed" in actions

    runs = client.get(f"/api/workbooks/{wb['id']}/runs")
    assert runs.status_code == 200, runs.text
    assert [run["id"] for run in runs.json()] == [payload["run_id"]]

    run_lookup = client.get(f"/api/runs/{payload['run_id']}")
    assert run_lookup.status_code == 200, run_lookup.text
    assert run_lookup.json()["id"] == payload["run_id"]


def test_run_endpoints_return_404_for_missing_records(client: TestClient) -> None:
    missing_runs = client.get("/api/workbooks/wb_missing/runs")
    assert missing_runs.status_code == 404

    missing_run = client.get("/api/runs/run_missing")
    assert missing_run.status_code == 404


def test_chat_endpoint_rejects_invalid_mode(client: TestClient) -> None:
    files = {"file": ("sample.xlsx", _sample_xlsx(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    wb = client.post("/api/workbooks/upload", files=files).json()

    response = client.post(f"/api/workbooks/{wb['id']}/chat", json={"message": "review", "mode": "bogus"})

    assert response.status_code == 400
    assert "mode must be one of" in response.text


def test_direct_mode_auto_applies_after_chat(client: TestClient, monkeypatch) -> None:
    """In direct mode, pending items are approved and applied as part of /chat."""
    from spreadbread_core import http as http_module
    from spreadbread_core.config import Config
    from spreadbread_core.domain import ProposalItem, new_proposal
    from spreadbread_core.llm import ChatResult
    from spreadbread_core.store import Store

    files = {"file": ("sample.xlsx", _sample_xlsx(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    wb_resp = client.post("/api/workbooks/upload", files=files).json()
    trust_resp = client.post(
        f"/api/workbooks/{wb_resp['id']}/trust-mode",
        json={"mode": "direct"},
    )
    assert trust_resp.status_code == 200, trust_resp.text
    assert trust_resp.json()["trust_mode"] == "direct"

    # Pre-seed a proposal with two pending items before calling /chat.
    cfg = Config.load()
    store = Store(cfg.db_path)
    proposal = new_proposal(wb_resp["id"], "auto test", "auto", "llm")
    proposal.items = [
        ProposalItem(kind="update", cell="Forecast!C3", before="=B3*1.05",
                     after="=B3*1.08", rationale="growth"),
        ProposalItem(kind="comment", cell="Forecast!A1", after="Reviewed",
                     rationale="note"),
    ]
    store.save_proposal(proposal)

    def fake_chat(self, message: str, system: str = "", mode=None) -> ChatResult:  # noqa: ANN001, ARG001
        return ChatResult(final_message="done", tool_calls=[], rounds=1)

    monkeypatch.setattr(http_module.OllamaClient, "chat", fake_chat)

    response = client.post(f"/api/workbooks/{wb_resp['id']}/chat", json={"message": "review"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["mode"] == "propose"
    assert payload["auto_applied"] is True
    assert payload["applied_version_id"] is not None

    snap = client.get(f"/api/workbooks/{wb_resp['id']}/review").json()
    assert snap["proposal"]["status"] == "applied"


def test_direct_trust_does_not_auto_apply_in_inspect_mode(client: TestClient, monkeypatch) -> None:
    from spreadbread_core import http as http_module
    from spreadbread_core.config import Config
    from spreadbread_core.domain import ProposalItem, new_proposal
    from spreadbread_core.llm import ChatResult
    from spreadbread_core.store import Store

    files = {"file": ("sample.xlsx", _sample_xlsx(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    wb_resp = client.post("/api/workbooks/upload", files=files).json()
    trust_resp = client.post(f"/api/workbooks/{wb_resp['id']}/trust-mode", json={"mode": "direct"})
    assert trust_resp.status_code == 200, trust_resp.text

    cfg = Config.load()
    store = Store(cfg.db_path)
    proposal = new_proposal(wb_resp["id"], "inspect test", "inspect", "llm")
    proposal.items = [
        ProposalItem(kind="update", cell="Forecast!C3", before="=B3*1.05",
                     after="=B3*1.08", rationale="growth"),
    ]
    store.save_proposal(proposal)

    def fake_chat(self, message: str, system: str = "", mode=None) -> ChatResult:  # noqa: ANN001, ARG001
        return ChatResult(final_message="done", tool_calls=[], rounds=1)

    monkeypatch.setattr(http_module.OllamaClient, "chat", fake_chat)

    response = client.post(
        f"/api/workbooks/{wb_resp['id']}/chat",
        json={"message": "inspect only", "mode": "inspect"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["mode"] == "inspect"
    assert payload["auto_applied"] is False
    snap = client.get(f"/api/workbooks/{wb_resp['id']}/review").json()
    assert snap["proposal"]["status"] == "pending_approval"


def test_review_mode_does_not_auto_apply(client: TestClient, monkeypatch) -> None:
    """In review mode, pending items are left pending after /chat."""
    from spreadbread_core import http as http_module
    from spreadbread_core.config import Config
    from spreadbread_core.domain import ProposalItem, new_proposal
    from spreadbread_core.llm import ChatResult
    from spreadbread_core.store import Store

    files = {"file": ("sample.xlsx", _sample_xlsx(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    wb_resp = client.post("/api/workbooks/upload", files=files).json()

    trust_resp = client.post(
        f"/api/workbooks/{wb_resp['id']}/trust-mode",
        json={"mode": "review"},
    )
    assert trust_resp.status_code == 200, trust_resp.text
    assert trust_resp.json()["trust_mode"] == "review"

    cfg = Config.load()
    store = Store(cfg.db_path)
    proposal = new_proposal(wb_resp["id"], "review test", "review", "llm")
    proposal.items = [
        ProposalItem(kind="update", cell="Forecast!C3", before="=B3*1.05",
                     after="=B3*1.08", rationale="growth"),
    ]
    store.save_proposal(proposal)

    def fake_chat(self, message: str, system: str = "", mode=None) -> ChatResult:  # noqa: ANN001, ARG001
        return ChatResult(final_message="done", tool_calls=[], rounds=1)

    monkeypatch.setattr(http_module.OllamaClient, "chat", fake_chat)

    response = client.post(f"/api/workbooks/{wb_resp['id']}/chat", json={"message": "review"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["mode"] == "propose"
    assert payload["auto_applied"] is False
    assert payload["applied_version_id"] is None

    snap = client.get(f"/api/workbooks/{wb_resp['id']}/review").json()
    assert snap["proposal"]["status"] == "pending_approval"


def test_locked_mode_blocks_bulk_approve(client: TestClient) -> None:
    """In locked mode, /approve-all returns HTTP 403."""
    from spreadbread_core.config import Config
    from spreadbread_core.domain import ProposalItem, new_proposal
    from spreadbread_core.store import Store

    files = {"file": ("sample.xlsx", _sample_xlsx(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    wb_resp = client.post("/api/workbooks/upload", files=files).json()

    trust_resp = client.post(
        f"/api/workbooks/{wb_resp['id']}/trust-mode",
        json={"mode": "locked"},
    )
    assert trust_resp.status_code == 200, trust_resp.text

    cfg = Config.load()
    store = Store(cfg.db_path)
    proposal = new_proposal(wb_resp["id"], "locked test", "locked", "llm")
    proposal.items = [
        ProposalItem(kind="update", cell="Forecast!C3", before="=B3*1.05",
                     after="=B3*1.08", rationale="growth"),
    ]
    store.save_proposal(proposal)

    bulk = client.post(
        f"/api/proposals/{proposal.id}/approve-all",
        json={"decision": "approve", "reviewer": "auditor"},
    )
    assert bulk.status_code == 403, bulk.text


def test_trust_mode_endpoint_rejects_invalid_mode(client: TestClient) -> None:
    """Posting an unrecognised trust mode returns HTTP 400 or 422."""
    files = {"file": ("sample.xlsx", _sample_xlsx(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    wb_resp = client.post("/api/workbooks/upload", files=files).json()

    resp = client.post(
        f"/api/workbooks/{wb_resp['id']}/trust-mode",
        json={"mode": "bogus"},
    )
    assert resp.status_code in (400, 422), resp.text


def test_decision_and_approve_all_endpoints(client: TestClient) -> None:
    """End-to-end: upload, hand-craft a proposal, approve, apply."""
    from spreadbread_core.config import Config
    from spreadbread_core.domain import ProposalItem, new_proposal
    from spreadbread_core.store import Store

    files = {"file": ("sample.xlsx", _sample_xlsx(),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    wb = client.post("/api/workbooks/upload", files=files).json()

    cfg = Config.load()
    store = Store(cfg.db_path)
    proposal = new_proposal(wb["id"], "test", "test", "llm")
    proposal.items = [
        ProposalItem(kind="update", cell="Forecast!C3", before="=B3*1.05",
                     after="=B3*1.08", rationale="growth"),
        ProposalItem(kind="comment", cell="Forecast!A1", after="Reviewed",
                     rationale="note"),
    ]
    store.save_proposal(proposal)

    bulk = client.post(
        f"/api/proposals/{proposal.id}/approve-all",
        json={"decision": "approve", "reviewer": "finance"},
    )
    assert bulk.status_code == 200, bulk.text
    assert len(bulk.json()["flipped_item_ids"]) == 2

    apply_resp = client.post(f"/api/proposals/{proposal.id}/apply", json={"reviewer": "finance"})
    assert apply_resp.status_code == 200, apply_resp.text
    assert apply_resp.json()["proposal"]["status"] == "applied"

    # idempotent: applying again returns the same version
    again = client.post(f"/api/proposals/{proposal.id}/apply", json={"reviewer": "finance"})
    assert again.status_code == 200
    assert again.json()["version"]["id"] == apply_resp.json()["version"]["id"]
