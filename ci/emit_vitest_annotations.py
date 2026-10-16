#!/usr/bin/env python3
"""Emit GitHub Actions error annotations for failed vitest cases.

Reads a JUnit XML report produced by `vitest --reporter=junit` and prints one
`::error` annotation per failed test so the failing names and messages are
visible through the GitHub checks API even when raw job logs are unavailable.

Usage: python3 ci/emit_vitest_annotations.py test-results/vitest-junit.xml
"""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "test-results/vitest-junit.xml"
    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError) as exc:
        print(f"::warning title=vitest-junit::could not read {path}: {exc}")
        return 0

    emitted = 0
    for case in root.iter("testcase"):
        for child in case:
            if child.tag not in ("failure", "error"):
                continue
            name = case.get("name") or case.get("classname") or "unknown test"
            message = (child.get("message") or child.text or "").strip()
            message = " | ".join(message.splitlines())[:600]
            # Annotation messages must not contain newlines or stray percent signs.
            message = message.replace("%", "%25").replace("\r", " ")
            print(f"::error title=vitest failed::{name} :: {message}", flush=True)
            emitted += 1
            if emitted >= 25:
                print("::warning title=vitest::more than 25 failures; annotations truncated")
                return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
