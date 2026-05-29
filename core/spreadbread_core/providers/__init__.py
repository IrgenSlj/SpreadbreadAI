"""Provider adapter interface.

Each provider (local_xlsx, google_sheets, google_docs) implements this
interface so the engine can dispatch read/write operations without
knowing the provider details.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from ..domain import ResourceKind

# Re-use the Operation type from domain
from ..domain import Operation  # noqa: F401


@dataclass(frozen=True)
class ProviderCapabilities:
    """Declared capabilities of a provider adapter."""

    resource_kinds: list[ResourceKind] = field(default_factory=lambda: ["spreadsheet"])
    supports_read: bool = True
    supports_write: bool = True
    supports_comments: bool = True
    supports_versioning: bool = True
    supports_conflict_detection: bool = True
    supports_batch_apply: bool = True
    online: bool = False


class ProviderAdapter(ABC):
    """Base class for all provider adapters."""

    @property
    @abstractmethod
    def provider_id(self) -> str:
        """Unique identifier, e.g. 'local_xlsx', 'google_sheets'."""
        ...

    @property
    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities()

    @abstractmethod
    def parse(self, raw: bytes, name: str = "workbook") -> dict[str, Any]:
        """Parse provider-specific raw data into a Workbook-compatible dict.

        Args:
            raw: Raw bytes (for local_xlsx) or provider-specific blob.
            name: Human-readable name for the resource.

        Returns:
            A dict matching the Workbook model shape, including at minimum
            ``sheets``, ``risks``, ``dependencies``, ``named_ranges``.
        """
        ...

    @abstractmethod
    def apply_operations(
        self,
        operations: list[Operation],
        base_raw: bytes,
        metadata: dict[str, Any] | None = None,
    ) -> bytes:
        """Apply operations to the base resource bytes.

        Args:
            operations: Ordered list of validated, approved operations.
            base_raw: Raw bytes of the base version.
            metadata: Optional provider-specific metadata (sheet names, etc.).

        Returns:
            Raw bytes of the new version.
        """
        ...


# ---------------------------------------------------------------------------
# Lazy provider registry
# ---------------------------------------------------------------------------

_PROVIDERS: dict[str, type[ProviderAdapter]] = {}


def register_provider(provider_id: str, cls: type[ProviderAdapter]) -> None:
    _PROVIDERS[provider_id] = cls


def get_provider(provider_id: str, **kwargs: Any) -> ProviderAdapter:
    """Return an instance of the registered provider adapter.

    Raises KeyError if the provider_id is not registered.
    """
    cls = _PROVIDERS.get(provider_id)
    if cls is None:
        msg = f"unknown provider: {provider_id}"
        raise KeyError(msg)
    return cls(**kwargs)


def list_providers() -> list[str]:
    return list(_PROVIDERS.keys())


# Register built-in providers (lazy imports for optional-dependency adapters)
from .local_xlsx import LocalXlsxAdapter  # noqa: E402

register_provider("local_xlsx", LocalXlsxAdapter)

try:
    from .google_sheets import GoogleSheetsAdapter  # noqa: E402

    register_provider("google_sheets", GoogleSheetsAdapter)
except ImportError:
    pass  # google-auth not installed
