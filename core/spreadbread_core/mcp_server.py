"""MCP stdio server.

Exposes the same tool registry the local LLM uses to external MCP
clients (Claude Desktop, Cursor, VS Code agents, Codex). Tool calls
from external clients flow through the same registry, so write tools
still stage proposal items and never mutate workbooks directly — the
human-in-the-loop guarantee is preserved end-to-end.

Run via:

    spreadbread-mcp

or, when configured in an MCP client (e.g. Claude Desktop's config):

    {
      "mcpServers": {
        "spreadbreadai": {
          "command": "spreadbread-mcp"
        }
      }
    }
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from .config import Config
from .domain import AuditEvent
from .store import Store
from .tools import ToolRegistry


def build_server() -> tuple[Server, ToolRegistry]:
    cfg = Config.load()
    store = Store(cfg.db_path)
    registry = ToolRegistry(store)
    server = Server("spreadbreadai")

    @server.list_tools()
    async def _list_tools() -> list[Tool]:
        return [
            Tool(
                name=tool.name,
                description=tool.description,
                inputSchema=tool.parameters,
            )
            for tool in registry.list_tools()
        ]

    @server.call_tool()
    async def _call_tool(name: str, arguments: dict[str, Any] | None) -> list[TextContent]:
        try:
            result = registry.call(name, arguments or {})
        except Exception as exc:  # surface the error to the client
            return [TextContent(type="text", text=json.dumps({"error": str(exc)}))]
        # Audit every external invocation distinctly from local-LLM calls.
        wb_id = (arguments or {}).get("workbook_id")
        if isinstance(wb_id, str) and store.get_workbook(wb_id):
            store.append_audit(
                AuditEvent(
                    workbook_id=wb_id,
                    actor="mcp-client",
                    action=f"mcp.tool.{name}",
                    detail=f"External MCP client invoked {name}",
                )
            )
        return [TextContent(type="text", text=json.dumps(result, default=str))]

    return server, registry


def main() -> None:
    async def _run() -> None:
        server, _registry = build_server()
        async with stdio_server() as (read, write):
            await server.run(read, write, server.create_initialization_options())

    asyncio.run(_run())


if __name__ == "__main__":
    main()
