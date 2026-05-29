"""Abstract base class for LLM adapters and shared result type."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from ..policy import AgentMode


@dataclass
class ChatResult:
    final_message: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    rounds: int = 0


class LLMAdapter(ABC):
    @abstractmethod
    def chat(
        self,
        user_message: str,
        system: str = "",
        mode: AgentMode | None = None,
    ) -> ChatResult:
        ...

    def supports_tools(self) -> bool:
        return True

    def supports_vision(self) -> bool:
        return False

    def close(self) -> None:
        pass
