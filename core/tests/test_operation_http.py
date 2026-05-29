"""Tests for the HTTP operation IR endpoints."""
from __future__ import annotations

from typing import Any, Generator

import pytest
from fastapi.testclient import TestClient

from spreadbread_core.domain import Operation, OperationTarget, _id
from spreadbread_core.store import Store


def _seed_op(store: Store, **overrides: Any) -> Operation:
    op = Operation(
        id=overrides.get("id", _id("op")),
        kind=overrides.get("kind", "set_cell_value"),  # type: ignore[arg-type]
        target=OperationTarget.from_cell(overrides.get("cell", "Sheet1!A1")),
        before={"value": "old"},
        after={"value": "new"},
        rationale=overrides.get("rationale", "test"),
        risk=overrides.get("risk", "low"),  # type: ignore[arg-type]
        required_capability=overrides.get("capability", "spreadsheet.write_cell"),
        status=overrides.get("status", "draft"),  # type: ignore[arg-type]
    )
    store.save_operation(op)
    return op


# ---------------------------------------------------------------------------
# Actually, let's make a simpler fixture that uses a real store with
# a real TestClient. The trick is we need to create an app that talks
# to our temp store.
# ---------------------------------------------------------------------------

@pytest.fixture
def client_store(tmp_path: Any) -> Generator[tuple[TestClient, Store], None, None]:
    store = Store(tmp_path / "ops_test.sqlite3")
    import spreadbread_core.http as http_mod

    # Monkey-patch Store so create_app uses ours
    original_store = http_mod.Store
    http_mod.Store = lambda db_path: store  # type: ignore[assignment]
    app2 = http_mod.create_app()
    http_mod.Store = original_store
    with TestClient(app2) as c:
        yield c, store


def test_list_operations_empty(client_store: tuple[TestClient, Store]) -> None:
    client, _store = client_store
    resp = client.get("/api/operations")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_operations_with_data(client_store: tuple[TestClient, Store]) -> None:
    client, store = client_store
    _seed_op(store, id="op_001", kind="set_cell_value", status="draft")
    _seed_op(store, id="op_002", kind="set_cell_formula", status="valid")
    resp = client.get("/api/operations")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 2


def test_get_operation(client_store: tuple[TestClient, Store]) -> None:
    client, store = client_store
    _seed_op(store, id="op_get_1")
    resp = client.get("/api/operations/op_get_1")
    assert resp.status_code == 200
    assert resp.json()["id"] == "op_get_1"
    assert resp.json()["kind"] == "set_cell_value"


def test_get_operation_not_found(client_store: tuple[TestClient, Store]) -> None:
    client, _store = client_store
    resp = client.get("/api/operations/nonexistent")
    assert resp.status_code == 404


def test_validate_operation(client_store: tuple[TestClient, Store]) -> None:
    client, store = client_store
    _seed_op(store, id="op_val", kind="set_cell_value", status="draft")
    resp = client.post("/api/operations/op_val/validate")
    assert resp.status_code == 200
    data = resp.json()
    assert data["validation"]["status"] == "valid"
    assert data["status"] == "valid"


def test_validate_operation_not_found(client_store: tuple[TestClient, Store]) -> None:
    client, _store = client_store
    resp = client.post("/api/operations/nonexistent/validate")
    assert resp.status_code == 404


def test_transition_operation(client_store: tuple[TestClient, Store]) -> None:
    client, store = client_store
    _seed_op(store, id="op_trans", status="draft")
    resp = client.post("/api/operations/op_trans/transition", json={"status": "valid"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "valid"


def test_transition_invalid(client_store: tuple[TestClient, Store]) -> None:
    client, store = client_store
    _seed_op(store, id="op_bad", status="draft")
    resp = client.post("/api/operations/op_bad/transition", json={"status": "applied"})
    assert resp.status_code == 400


def test_transition_not_found(client_store: tuple[TestClient, Store]) -> None:
    client, _store = client_store
    resp = client.post("/api/operations/nonexistent/transition", json={"status": "valid"})
    assert resp.status_code == 404


def test_list_operations_filter_by_status(client_store: tuple[TestClient, Store]) -> None:
    client, store = client_store
    _seed_op(store, id="op_d1", status="draft")
    _seed_op(store, id="op_v1", status="valid")
    resp = client.get("/api/operations?status=draft")
    assert resp.status_code == 200
    data = resp.json()
    assert all(op["status"] == "draft" for op in data)
    assert any(op["id"] == "op_d1" for op in data)
