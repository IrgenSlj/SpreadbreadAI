"""LLM adapter package.

Re-exports all public symbols previously available from `spreadbread_core.llm`
for backward compatibility. New code should import from this package directly.
"""

from ._prompts import MODE_PROMPTS, SYSTEM_PROMPT
from .base import ChatResult, LLMAdapter
from .ollama import OllamaClient
from .router import create_llm

__all__ = [
    "ChatResult",
    "LLMAdapter",
    "OllamaClient",
    "SYSTEM_PROMPT",
    "MODE_PROMPTS",
    "create_llm",
]
