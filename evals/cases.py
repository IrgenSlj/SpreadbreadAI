"""Eval test cases: structured scenarios for the eval harness.

Each case defines:
- ``id`` — unique name
- ``description`` — human-readable summary
- ``fixture`` — which workbook fixture to load
- ``steps`` — list of tool calls or operations to execute
- ``checks`` — assertions to verify after the run
- ``requires_llm`` — whether this case needs a live LLM
"""
from __future__ import annotations

from typing import Any

_registry: list[dict[str, Any]] = []


def register(
    case_id: str,
    description: str,
    fixture: str,
    steps: list[dict[str, Any]],
    checks: list[dict[str, Any]],
    *,
    requires_llm: bool = False,
) -> None:
    _registry.append(
        {
            "id": case_id,
            "description": description,
            "fixture": fixture,
            "steps": steps,
            "checks": checks,
            "requires_llm": requires_llm,
        }
    )


def list_cases() -> list[dict[str, Any]]:
    return list(_registry)


def get(case_id: str) -> dict[str, Any]:
    for c in _registry:
        if c["id"] == case_id:
            return c
    raise KeyError(f"case {case_id!r} not found")


# ---------------------------------------------------------------------------
# Offline (no LLM needed) cases
# ---------------------------------------------------------------------------

register(
    case_id="risk_detection_external_refs",
    description="Parser must detect external workbook references in broken_refs fixture",
    fixture="broken_refs",
    steps=[
        {
            "tool": "list_risks",
            "args": {},
        }
    ],
    checks=[
        {
            "type": "risks_contain",
            "label": "External workbook reference",
        },
        {
            "type": "risks_contain",
            "label": "Broken sheet reference",
        },
        {
            "type": "risks_contain",
            "label": "Pending input",
        },
    ],
)

register(
    case_id="risk_detection_cycle",
    description="Parser must detect broken sheet reference in cycle_risk fixture",
    fixture="cycle_risk",
    steps=[
        {
            "tool": "list_risks",
            "args": {},
        }
    ],
    checks=[
        {
            "type": "risks_contain",
            "label": "Broken sheet reference",
        },
    ],
)

register(
    case_id="propose_diff_valid",
    description="A valid propose_diff call creates a proposal item with valid operation",
    fixture="simple_forecast",
    steps=[
        {
            "tool": "propose_diff",
            "args": {
                "cell": "Forecast!C3",
                "kind": "update",
                "before": "=B3*1.05",
                "after": "=B3*1.08",
                "after_type": "formula",
                "rationale": "Revised growth assumption",
            },
        }
    ],
    checks=[
        {
            "type": "proposal_item_count",
            "expected": 1,
        },
        {
            "type": "operation_valid",
            "item_index": 0,
            "expected_status": "valid",
        },
        {
            "type": "operation_kind",
            "item_index": 0,
            "expected": "set_cell_formula",
        },
    ],
)

register(
    case_id="propose_diff_cyclic_rejected",
    description="A self-referencing formula must be rejected by the validator",
    fixture="simple_forecast",
    steps=[
        {
            "tool": "propose_diff",
            "args": {
                "cell": "Forecast!C3",
                "kind": "update",
                "before": "=B3*1.05",
                "after": "=C3+1",
                "after_type": "formula",
                "rationale": "Test circular ref detection",
            },
        }
    ],
    checks=[
        {
            "type": "proposal_item_count",
            "expected": 1,
        },
        {
            "type": "operation_valid",
            "item_index": 0,
            "expected_status": "invalid",
        },
        {
            "type": "operation_message_contains",
            "item_index": 0,
            "text": "circular",
        },
    ],
)

register(
    case_id="parser_multi_sheet",
    description="Parser extracts correct metadata from the construction_quote fixture",
    fixture="construction_quote",
    steps=[
        {
            "tool": "get_review_snapshot",
            "args": {},
        }
    ],
    checks=[
        {
            "type": "sheet_count",
            "expected": 5,
        },
        {
            "type": "sheet_formula_count",
            "sheet_index": 0,
            "min_formulas": 3,
        },
    ],
)

# ---------------------------------------------------------------------------
# LLM-required cases (skipped when no provider is given)
# ---------------------------------------------------------------------------

register(
    case_id="llm_inspect_sheet",
    description="LLM should be able to list workbooks and inspect a sheet",
    fixture="simple_forecast",
    steps=[
        {
            "tool": "chat",
            "prompt": "Inspect the Forecast sheet. How many formula cells does it have?",
        }
    ],
    checks=[
        {
            "type": "chat_rounds",
            "min_rounds": 1,
        },
        {
            "type": "chat_tool_called",
            "tool_name": "inspect_sheet",
        },
    ],
    requires_llm=True,
)

register(
    case_id="llm_propose_diff",
    description="LLM proposes a formula change when asked to update growth assumptions",
    fixture="simple_forecast",
    steps=[
        {
            "tool": "chat",
            "prompt": (
                "Review the Forecast sheet. "
                "The growth rate in C3 (May) should be 8% instead of 5%. "
                "Stage the appropriate change."
            ),
        }
    ],
    checks=[
        {
            "type": "chat_tool_called",
            "tool_name": "propose_diff",
        },
        {
            "type": "proposal_item_count",
            "min_count": 1,
        },
    ],
    requires_llm=True,
)
