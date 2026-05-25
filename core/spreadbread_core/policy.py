from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

AgentMode = Literal["inspect", "plan", "propose", "apply", "direct", "locked"]
PermissionAction = Literal["allow", "ask", "deny"]


@dataclass(frozen=True)
class PermissionDecision:
    action: PermissionAction
    reason: str


def evaluate_tool_metadata(metadata: dict[str, Any], mode: AgentMode) -> PermissionDecision:
    allowed_modes = set(metadata.get("allowed_modes") or [])
    if mode not in allowed_modes:
        return PermissionDecision("deny", f"tool is not available in {mode!r} mode")

    side_effect = metadata.get("side_effect")
    if side_effect == "provider_write":
        return PermissionDecision("deny", "direct provider writes are not exposed to agents")
    if side_effect == "apply_request" and mode not in {"apply", "direct"}:
        return PermissionDecision("ask", "apply-capable tools require apply/direct mode")
    return PermissionDecision("allow", "allowed by mode and side-effect policy")
