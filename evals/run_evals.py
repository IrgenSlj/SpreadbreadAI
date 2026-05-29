#!/usr/bin/env python3
"""Eval harness for SpreadbreadAI.

Usage:
    python evals/run_evals.py                          # offline cases only
    python evals/run_evals.py --provider ollama          # + live LLM cases
    python evals/run_evals.py --provider gemini          # via Gemini
    python evals/run_evals.py --list-cases               # list available cases
    python evals/run_evals.py --case propose_diff_valid  # single case

Accepts --provider (ollama|gemini) to enable agent-in-the-loop cases.
Without a provider, only structural/safety cases run (no LLM required).
"""
from __future__ import annotations

import argparse
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

# Ensure the core package and evals package are importable
# ruff: noqa: E402 — sys.path modifications must precede package imports
_repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_repo_root / "core"))
sys.path.insert(0, str(_repo_root))

from spreadbread_core.apply import ApplyError, apply_proposal  # noqa: E402
from spreadbread_core.config import Config  # noqa: E402
from spreadbread_core.parser import parse_xlsx  # noqa: E402
from spreadbread_core.store import Store  # noqa: E402
from spreadbread_core.tools import ToolRegistry  # noqa: E402

import evals.cases as cases_mod  # noqa: E402
import evals.fixtures as fixtures_mod  # noqa: E402


def _load_fixture(name: str) -> tuple[str, str, bytes]:
    """Load a fixture and return (fixture_name, workbook_id, raw_bytes)."""
    fname, raw = fixtures_mod.load(name)
    return fname, raw


def _case_needs_llm(case: dict[str, Any]) -> bool:
    return case.get("requires_llm", False)


def _run_checks(
    case: dict[str, Any],
    store: Store,
    wb_id: str,
    chat_result: dict[str, Any] | None = None,
) -> list[str]:
    """Run all checks for a case. Returns list of failure messages (empty = pass)."""
    failures: list[str] = []
    wb = store.get_workbook(wb_id)
    if wb is None:
        return ["workbook not found in store"]

    for check in case.get("checks", []):
        check_type = check["type"]

        if check_type == "sheet_count":
            actual = len(wb.sheets)
            expected = check["expected"]
            if actual != expected:
                failures.append(
                    f"sheet_count: expected {expected}, got {actual}"
                )

        elif check_type == "sheet_formula_count":
            idx = check["sheet_index"]
            if idx >= len(wb.sheets):
                failures.append(f"sheet_formula_count: sheet index {idx} out of range")
                continue
            actual = wb.sheets[idx].formula_cells
            min_f = check.get("min_formulas", 0)
            if actual < min_f:
                failures.append(
                    f"sheet_formula_count[{idx}]: expected >= {min_f} formulas, got {actual}"
                )

        elif check_type == "risks_contain":
            labels = {r.label for r in wb.risks}
            expected_label = check["label"]
            if expected_label not in labels:
                failures.append(
                    f"risks_contain: expected label {expected_label!r}, "
                    f"got {sorted(labels)}"
                )

        elif check_type == "proposal_item_count":
            proposal = store.latest_proposal_for(wb_id)
            actual = len(proposal.items) if proposal else 0
            expected = check.get("expected")
            min_count = check.get("min_count")
            if expected is not None and actual != expected:
                failures.append(
                    f"proposal_item_count: expected {expected}, got {actual}"
                )
            if min_count is not None and actual < min_count:
                failures.append(
                    f"proposal_item_count: expected >= {min_count}, got {actual}"
                )

        elif check_type.startswith("operation_"):
            proposal = store.latest_proposal_for(wb_id)
            if not proposal:
                failures.append(f"{check_type}: no proposal found")
                continue
            idx = check.get("item_index", 0)
            if idx >= len(proposal.items):
                failures.append(f"{check_type}: item index {idx} out of range")
                continue
            item = proposal.items[idx]
            op = item.operation
            if op is None:
                failures.append(f"{check_type}: item {idx} has no operation")
                continue

            if check_type == "operation_valid":
                expected_status = check["expected_status"]
                if op.validation.status != expected_status:
                    failures.append(
                        f"operation_valid[{idx}]: expected {expected_status!r}, "
                        f"got {op.validation.status!r}: {op.validation.messages}"
                    )

            elif check_type == "operation_kind":
                expected = check["expected"]
                if op.kind != expected:
                    failures.append(
                        f"operation_kind[{idx}]: expected {expected!r}, got {op.kind!r}"
                    )

            elif check_type == "operation_message_contains":
                text = check["text"]
                combined = "; ".join(op.validation.messages)
                if text not in combined:
                    failures.append(
                        f"operation_message_contains[{idx}]: "
                        f"expected {text!r} in {combined!r}"
                    )

        elif check_type == "chat_rounds":
            if chat_result is None:
                failures.append("chat_rounds: no chat result available")
                continue
            min_r = check.get("min_rounds", 1)
            actual_r = chat_result.get("rounds", 0)
            if actual_r < min_r:
                failures.append(
                    f"chat_rounds: expected >= {min_r}, got {actual_r}"
                )

        elif check_type == "chat_tool_called":
            if chat_result is None:
                failures.append("chat_tool_called: no chat result available")
                continue
            tool_name = check["tool_name"]
            called = {c["name"] for c in chat_result.get("tool_calls", [])}
            if tool_name not in called:
                failures.append(
                    f"chat_tool_called: expected {tool_name!r} called, "
                    f"got {sorted(called)}"
                )

    return failures


def _run_offline_case(
    case: dict[str, Any],
    tmp_dir: Path,
) -> tuple[str, list[str], float]:
    """Run an offline case (no LLM). Returns (case_id, failures, elapsed_seconds)."""
    start = time.time()
    fname, raw = _load_fixture(case["fixture"])
    db_path = tmp_dir / f"{case['id']}.sqlite3"
    store = Store(db_path)
    registry = ToolRegistry(store)

    # Parse fixture and save to store with version bytes
    tmp_xlsx = tmp_dir / f"{fname}.xlsx"
    tmp_xlsx.write_bytes(raw)
    wb = parse_xlsx(tmp_xlsx, name=fname)
    store.save_workbook(wb)
    store.save_version_bytes(wb.id, wb.latest_version_id, raw)

    for step in case.get("steps", []):
        tool_name = step["tool"]
        args = dict(step.get("args", {}))

        if tool_name == "chat":
            continue  # handled by LLM path

        if tool_name == "propose_diff":
            args.setdefault("workbook_id", wb.id)
            args.setdefault("before", "")
        elif tool_name in ("get_review_snapshot", "list_risks",
                           "inspect_sheet", "find_external_references",
                           "get_named_ranges", "get_dependencies"):
            args.setdefault("workbook_id", wb.id)
        elif tool_name == "list_workbooks":
            pass

        registry.call(tool_name, args)

    # Run the apply pipeline for any approved proposal items
    proposal = store.latest_proposal_for(wb.id)
    if proposal and any(i.status == "approved" for i in proposal.items):
        try:
            apply_proposal(store, proposal.id, reviewer="eval")
        except ApplyError:
            pass  # apply errors are expected for negative cases

    failures = _run_checks(case, store, wb.id)
    elapsed = time.time() - start
    return case["id"], failures, elapsed


def _run_llm_case(
    case: dict[str, Any],
    provider: str,
    tmp_dir: Path,
) -> tuple[str, list[str], float]:
    """Run a case that requires a live LLM. Returns (case_id, failures, elapsed)."""
    start = time.time()

    # Create app-level config (use env vars as normal)
    cfg = Config.load()
    # Override provider
    object.__setattr__(cfg, "provider", provider)

    fname, raw = _load_fixture(case["fixture"])
    db_path = tmp_dir / f"{case['id']}_llm.sqlite3"
    store = Store(db_path)
    registry = ToolRegistry(store)

    tmp_xlsx = tmp_dir / f"{fname}.xlsx"
    tmp_xlsx.write_bytes(raw)
    wb = parse_xlsx(tmp_xlsx, name=fname)
    store.save_workbook(wb)
    store.save_version_bytes(wb.id, wb.latest_version_id, raw)

    # Build the LLM adapter
    from spreadbread_core.llm.router import create_llm

    llm = create_llm(cfg, registry)
    try:
        chat_result = None
        for step in case.get("steps", []):
            if step.get("tool") == "chat":
                prompt = step["prompt"]
                result = llm.chat(
                    f"Workbook id: {wb.id}\nUser request: {prompt}",
                    mode="propose",
                )
                chat_result = {
                    "final_message": result.final_message,
                    "tool_calls": result.tool_calls,
                    "rounds": result.rounds,
                }
            else:
                # Fall through for non-chat steps within LLM cases
                tool_name = step["tool"]
                args = dict(step.get("args", {}))
                if tool_name != "chat":
                    args.setdefault("workbook_id", wb.id)
                    registry.call(tool_name, args)
    finally:
        llm.close()

    failures = _run_checks(case, store, wb.id, chat_result)
    elapsed = time.time() - start
    return case["id"], failures, elapsed


def _print_header(text: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"  {text}")
    print(f"{'=' * 60}")


def _print_result(case_id: str, failures: list[str], elapsed: float) -> None:
    status = "PASS" if not failures else "FAIL"
    print(f"  [{status:4s}] {case_id} ({elapsed:.2f}s)")
    for f in failures:
        print(f"         {f}")


def main() -> None:
    parser = argparse.ArgumentParser(description="SpreadbreadAI eval harness")
    parser.add_argument("--provider", default=None, help="LLM provider (ollama|gemini)")
    parser.add_argument("--case", default=None, help="Run a single case by ID")
    parser.add_argument("--list-cases", action="store_true", help="List available cases and exit")
    args = parser.parse_args()

    cases = cases_mod.list_cases()

    if args.list_cases:
        _print_header(f"Available cases ({len(cases)})")
        for c in cases:
            llm_tag = " [LLM]" if c.get("requires_llm") else ""
            print(f"  {c['id']:40s} {c['description']}{llm_tag}")
        return

    if args.case:
        try:
            cases = [cases_mod.get(args.case)]
        except KeyError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            sys.exit(1)

    offline = [c for c in cases if not _case_needs_llm(c)]
    llm_cases = [c for c in cases if _case_needs_llm(c)]

    total = 0
    passed = 0
    failed: list[tuple[str, list[str]]] = []

    with tempfile.TemporaryDirectory(prefix="spreadbread_evals_") as tmp_dir_str:
        tmp_dir = Path(tmp_dir_str)

        if offline:
            _print_header(f"Offline cases ({len(offline)})")
            for case in offline:
                cid, failures, elapsed = _run_offline_case(case, tmp_dir)
                _print_result(cid, failures, elapsed)
                total += 1
                if not failures:
                    passed += 1
                else:
                    failed.append((cid, failures))

        if args.provider and llm_cases:
            _print_header(f"LLM cases (provider={args.provider}, {len(llm_cases)})")
            for case in llm_cases:
                try:
                    cid, failures, elapsed = _run_llm_case(case, args.provider, tmp_dir)
                except Exception as exc:
                    cid = case["id"]
                    failures = [str(exc)]
                    elapsed = 0.0
                _print_result(cid, failures, elapsed)
                total += 1
                if not failures:
                    passed += 1
                else:
                    failed.append((cid, failures))
        elif llm_cases:
            print(
                f"\n  Skipping {len(llm_cases)} LLM case(s). "
                f"Use --provider to enable them."
            )

    _print_header(f"Results: {passed}/{total} passed")
    for cid, fails in failed:
        print(f"  FAIL: {cid}")
        for f in fails:
            print(f"    - {f}")

    sys.exit(0 if not failed else 1)


if __name__ == "__main__":
    main()
