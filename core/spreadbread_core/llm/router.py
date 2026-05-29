"""Adapter selection: picks the right LLM adapter based on config."""

from __future__ import annotations

import logging

from ..config import Config
from ..tools import ToolRegistry
from .base import LLMAdapter

logger = logging.getLogger(__name__)


def create_llm(config: Config, registry: ToolRegistry) -> LLMAdapter:
    """Create an LLM adapter based on the configuration.

    Selection order:
      1. If config.provider is explicitly set to a known provider, use it.
      2. If provider is not set, default to ollama (always available).
    """
    provider = config.provider or "ollama"

    if provider == "gemini":
        if not config.gemini_api_key:
            logger.warning(
                "GEMINI_API_KEY not set — falling back to Ollama"
            )
            provider = "ollama"
        else:
            from .gemini import GeminiClient

            try:
                return GeminiClient(
                    api_key=config.gemini_api_key,
                    model=config.model,
                    registry=registry,
                )
            except ImportError:
                logger.warning(
                    "google-genai not installed — falling back to Ollama"
                )
                provider = "ollama"

    # default: ollama
    from .ollama import OllamaClient

    return OllamaClient(
        host=config.ollama_host,
        model=config.model,
        registry=registry,
    )
