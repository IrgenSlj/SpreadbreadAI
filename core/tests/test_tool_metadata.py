from __future__ import annotations

from spreadbread_core.store import Store
from spreadbread_core.tools import ToolRegistry


def test_tool_metadata_marks_read_and_stage_boundaries(tmp_path) -> None:
    registry = ToolRegistry(Store(tmp_path / "tools.sqlite3"))
    tools = {tool.name: tool for tool in registry.list_tools()}

    assert tools["inspect_sheet"].side_effect == "read"
    assert tools["inspect_sheet"].resource_kind == "spreadsheet"
    assert tools["inspect_sheet"].required_capability == "spreadsheet.read"
    assert tools["inspect_sheet"].risk == "low"

    assert tools["propose_diff"].write is True
    assert tools["propose_diff"].side_effect == "stage"
    assert tools["propose_diff"].resource_kind == "spreadsheet"
    assert tools["propose_diff"].required_capability == "spreadsheet.write_cell"
    assert tools["propose_diff"].allowed_modes == ("propose", "direct")
    assert tools["propose_diff"].risk == "medium"

    assert tools["add_comment"].side_effect == "stage"
    assert tools["add_comment"].required_capability == "spreadsheet.comment"
    assert tools["add_comment"].risk == "low"


def test_ollama_schema_does_not_leak_internal_metadata(tmp_path) -> None:
    registry = ToolRegistry(Store(tmp_path / "tools.sqlite3"))

    schema = registry.to_ollama_schema()
    propose_schema = next(tool for tool in schema if tool["function"]["name"] == "propose_diff")

    assert "parameters" in propose_schema["function"]
    assert "side_effect" not in propose_schema["function"]
    assert "required_capability" not in propose_schema["function"]


def test_tool_policy_filters_by_mode(tmp_path) -> None:
    registry = ToolRegistry(Store(tmp_path / "tools.sqlite3"))

    inspect_names = {tool.name for tool in registry.list_tools(mode="inspect")}
    propose_names = {tool.name for tool in registry.list_tools(mode="propose")}
    locked_names = {tool.name for tool in registry.list_tools(mode="locked")}

    assert "inspect_sheet" in inspect_names
    assert "propose_diff" not in inspect_names
    assert "propose_diff" in propose_names
    assert "add_comment" in propose_names
    assert "propose_diff" not in locked_names


def test_tool_policy_explains_denied_mode(tmp_path) -> None:
    registry = ToolRegistry(Store(tmp_path / "tools.sqlite3"))

    decision = registry.policy_decision("propose_diff", mode="inspect")

    assert decision.action == "deny"
    assert "inspect" in decision.reason


def test_default_tool_listing_remains_unfiltered(tmp_path) -> None:
    registry = ToolRegistry(Store(tmp_path / "tools.sqlite3"))

    names = {tool.name for tool in registry.list_tools()}

    assert "inspect_sheet" in names
    assert "propose_diff" in names
