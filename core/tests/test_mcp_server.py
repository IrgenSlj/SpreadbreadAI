"""Smoke test for the MCP stdio server.

Covers registry wiring without spinning up real stdio: build_server()
returns a Server with the correct tool catalog and a callable
dispatcher that produces the same results the registry would.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from spreadbread_core.config import Config


@pytest.fixture
def cfg(tmp_path: Path, monkeypatch) -> Config:
    monkeypatch.setenv("SPREADBREAD_DATA_DIR", str(tmp_path))
    return Config.load()


def test_build_server_exposes_tool_catalog(cfg: Config) -> None:
    from spreadbread_core import mcp_server

    server, registry = mcp_server.build_server()
    # The server's list_tools handler is registered; we check the
    # underlying registry has the expected tools, which is what the
    # handler returns.
    names = {tool.name for tool in registry.list_tools()}
    assert {"list_workbooks", "propose_diff", "add_comment"} <= names


def test_build_server_dispatches_a_read_tool(cfg: Config) -> None:
    from spreadbread_core import mcp_server

    server, registry = mcp_server.build_server()
    # list_workbooks on an empty store returns an empty list — that is
    # enough to prove the registry is wired in. Real end-to-end MCP
    # transport is exercised by the SDK's own tests.
    assert registry.call("list_workbooks", {}) == []


def test_main_module_attribute() -> None:
    """`spreadbread-mcp` console-script entrypoint resolves."""
    from spreadbread_core import mcp_server

    assert callable(mcp_server.main)
