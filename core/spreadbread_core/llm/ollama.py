"""Ollama tool-calling chat loop.

The model receives the tool catalog from ToolRegistry and steers the
conversation by emitting tool calls. This module dispatches them, feeds
results back, and stops when the model produces a final assistant
message with no tool calls or when a safety limit is reached.
"""
from __future__ import annotations

import json
from typing import Any

import httpx

from ..policy import AgentMode
from ..tools import ToolRegistry
from ._prompts import MODE_PROMPTS, SYSTEM_PROMPT
from .base import ChatResult, LLMAdapter


class OllamaClient(LLMAdapter):
    def __init__(self, host: str, model: str, registry: ToolRegistry, max_rounds: int = 8):
        self.host = host.rstrip("/")
        self.model = model
        self.registry = registry
        self.max_rounds = max_rounds
        self._http = httpx.Client(timeout=120.0)

    def close(self) -> None:
        self._http.close()

    def chat(
        self,
        user_message: str,
        system: str = SYSTEM_PROMPT,
        mode: AgentMode | None = None,
    ) -> ChatResult:
        if mode is not None:
            system = f"{system}\n\n{MODE_PROMPTS[mode]}"
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_message},
        ]
        tools = self.registry.to_ollama_schema(mode)
        all_calls: list[dict[str, Any]] = []

        for round_idx in range(self.max_rounds):
            response = self._http.post(
                f"{self.host}/api/chat",
                json={
                    "model": self.model,
                    "messages": messages,
                    "tools": tools,
                    "stream": False,
                },
            )
            response.raise_for_status()
            payload = response.json()
            msg = payload.get("message", {})
            content = msg.get("content", "") or ""
            tool_calls = msg.get("tool_calls") or []

            messages.append(
                {"role": "assistant", "content": content, "tool_calls": tool_calls}
            )

            if not tool_calls:
                return ChatResult(
                    final_message=content,
                    tool_calls=all_calls,
                    rounds=round_idx + 1,
                )

            for call in tool_calls:
                fn = call.get("function", {})
                name = fn.get("name", "")
                raw_args = fn.get("arguments", {})
                args = (
                    raw_args
                    if isinstance(raw_args, dict)
                    else json.loads(raw_args or "{}")
                )
                try:
                    if mode is not None:
                        decision = self.registry.policy_decision(name, mode)
                        if decision.action == "deny":
                            raise PermissionError(decision.reason)
                    result = self.registry.call(name, args)
                    result_text = json.dumps(result, default=str)
                except Exception as exc:  # surface tool errors to the model
                    result_text = json.dumps({"error": str(exc)})
                all_calls.append(
                    {"name": name, "arguments": args, "result": result_text}
                )
                messages.append(
                    {"role": "tool", "name": name, "content": result_text}
                )

        return ChatResult(
            final_message="(stopped: max tool-call rounds reached)",
            tool_calls=all_calls,
            rounds=self.max_rounds,
        )
