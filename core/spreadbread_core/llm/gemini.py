"""Gemini / Google AI adapter.

Uses the google-genai SDK. Falls back gracefully if not installed.
Gemini free tier is sufficient for development.
"""
from __future__ import annotations

import json
from typing import Any

from ..policy import AgentMode
from ..tools import ToolRegistry
from ._prompts import MODE_PROMPTS, SYSTEM_PROMPT
from .base import ChatResult, LLMAdapter


class GeminiClient(LLMAdapter):
    def __init__(
        self,
        api_key: str,
        model: str,
        registry: ToolRegistry,
        max_rounds: int = 8,
    ):
        self.api_key = api_key
        self.model = model
        self.registry = registry
        self.max_rounds = max_rounds
        self._client = None

    def _get_client(self):
        if self._client is not None:
            return self._client
        try:
            from google import genai

            self._client = genai.Client(api_key=self.api_key)
        except ImportError:
            raise ImportError(
                "google-genai package is required for the Gemini adapter. "
                "Install with: pip install google-genai"
            )
        return self._client

    def _convert_tools(self, mode: AgentMode | None) -> list[dict[str, Any]] | None:
        """Convert Ollama-format tool schema to Gemini format."""
        from google.genai import types

        schema = self.registry.to_ollama_schema(mode)
        if not schema:
            return None
        functions = []
        for tool in schema:
            fn = tool["function"]
            functions.append(
                types.FunctionDeclaration(
                    name=fn["name"],
                    description=fn["description"],
                    parameters=fn["parameters"],
                )
            )
        return [types.Tool(function_declarations=functions)]

    def _handle_gemini_function_call(
        self,
        fc: Any,
        mode: AgentMode | None,
        all_calls: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Execute a Gemini function call and return the Content payload
        to append to the conversation."""
        from google.genai import types

        name = fc.name
        args = dict(fc.args) if fc.args else {}
        try:
            if mode is not None:
                decision = self.registry.policy_decision(name, mode)
                if decision.action == "deny":
                    raise PermissionError(decision.reason)
            result = self.registry.call(name, args)
            result_text = json.dumps(result, default=str)
        except Exception as exc:
            result_text = json.dumps({"error": str(exc)})
        all_calls.append({"name": name, "arguments": args, "result": result_text})
        return types.Content(
            role="function",
            parts=[
                types.Part.from_function_response(
                    name=name, response={"response": result_text}
                )
            ],
        )

    def chat(
        self,
        user_message: str,
        system: str = SYSTEM_PROMPT,
        mode: AgentMode | None = None,
    ) -> ChatResult:
        if mode is not None:
            system = f"{system}\n\n{MODE_PROMPTS[mode]}"

        from google.genai import types

        client = self._get_client()
        tools = self._convert_tools(mode)

        contents: list[types.Content] = []

        all_calls: list[dict[str, Any]] = []

        for round_idx in range(self.max_rounds):
            if round_idx == 0:
                contents.append(
                    types.Content(
                        role="user",
                        parts=[types.Part.from_text(user_message)],
                    )
                )

            response = client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    tools=tools,
                ),
            )

            candidate = response.candidates[0]
            content = candidate.content

            function_calls = [
                p.function_call for p in content.parts if p.function_call
            ]
            text_parts = [p.text for p in content.parts if p.text]

            if not function_calls:
                final_text = " ".join(text_parts)
                return ChatResult(
                    final_message=final_text,
                    tool_calls=all_calls,
                    rounds=round_idx + 1,
                )

            for fc in function_calls:
                response_content = self._handle_gemini_function_call(
                    fc, mode, all_calls
                )
                contents.append(response_content)

        return ChatResult(
            final_message="(stopped: max tool-call rounds reached)",
            tool_calls=all_calls,
            rounds=self.max_rounds,
        )
