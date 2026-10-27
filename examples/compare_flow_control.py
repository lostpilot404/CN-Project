"""Reproduce the audited, controlled flow-control comparison; no third-party dependencies.

Run from the repository root:
    PYTHONPATH=python python examples/compare_flow_control.py > flow-comparison.json
"""

from __future__ import annotations

import json
from typing import Any

from netsim.datalink.flow_control import (
    FlowControlConfig,
    FlowControlProtocol,
    simulate_flow_control,
)


def comparison() -> dict[str, Any]:
    results = {}
    for protocol in (FlowControlProtocol.GO_BACK_N, FlowControlProtocol.SELECTIVE_REPEAT):
        config = FlowControlConfig(
            protocol=protocol,
            window_size=4,
            sequence_space=8,
            total_frames_to_send=8,
            frame_tx_time_us=1000,
            prop_delay_us=2000,
            ack_tx_time_us=100,
            timeout_us=10000,
            seed=42,
            dropped_frame_indices=[2],
        )
        result = simulate_flow_control(config)
        if not result.is_completed or result.metrics.completed_frames != 8:
            raise RuntimeError(f"{protocol.value} did not complete the demonstration")
        results[protocol.value] = result.to_dict()
    return {
        "schema_version": 1,
        "description": "Identical inputs except protocol; initial frame index 2 is dropped",
        "results": results,
    }


if __name__ == "__main__":
    print(json.dumps(comparison(), indent=2, allow_nan=False))
