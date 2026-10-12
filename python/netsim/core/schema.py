"""Shared helpers for validating JSON-shaped command payloads.

Every ``from_dict`` factory in this package is reachable directly from the HTTP command
surface, so nested values must be validated rather than dereferenced. Reaching
``AttributeError``/``KeyError`` on a malformed payload would be reported as a server fault
instead of a structured client error.
"""

from __future__ import annotations

from typing import Any


def require_dict(value: Any, field: str) -> dict[str, Any]:
    """Return *value* as a mapping, or raise ``ValueError`` describing the expected shape."""
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    raise ValueError(f"'{field}' must be a JSON object (received {type(value).__name__})")


def require_list(value: Any, field: str) -> list[Any]:
    """Return *value* as a list, or raise ``ValueError`` describing the expected shape."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    raise ValueError(f"'{field}' must be a JSON array (received {type(value).__name__})")


def require_int(value: Any, field: str, *, minimum: int | None = None, maximum: int | None = None) -> int:
    """Coerce *value* to ``int`` and enforce optional inclusive bounds."""
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"'{field}' must be an integer (received {value!r})") from exc
    if minimum is not None and result < minimum:
        raise ValueError(f"'{field}' must be >= {minimum} (received {result})")
    if maximum is not None and result > maximum:
        raise ValueError(f"'{field}' must be <= {maximum} (received {result})")
    return result


def require_non_empty(value: Any, field: str) -> str:
    """Coerce *value* to a non-empty string."""
    text = "" if value is None else str(value)
    if not text.strip():
        raise ValueError(f"'{field}' must not be empty")
    return text
