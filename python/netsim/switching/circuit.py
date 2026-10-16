"""Circuit-switching educational model.

This module models the *circuit switching* paradigm: before any data moves, a
connection setup phase reserves a fixed amount of capacity on **every** link of an
end-to-end path. A request is admitted only if the whole path is available at the
requested rate; otherwise it is **blocked** (no partial reservations are ever
left behind). A teardown phase releases the reservations so the capacity can be
reused.

Model assumptions and simplifications (stated so the educational scope is honest):

* Path selection reuses the authoritative routing graph
  (``netsim.routing.graph.RoutingGraph.find_path``) with the hop-count metric — the
  same shortest-path machinery that governs live packet forwarding. There is no
  separate circuit-routing algorithm.
* Capacity is reserved per link in a **shared** manner: one reservation pool per
  link regardless of direction, because the topology model has no full/half-duplex
  distinction.
* Reservations are static while a circuit is up: no renegotiation, no preemption,
  no holding-time timers, no call-setup latency modelling. Setup/teardown are
  instantaneous bookkeeping operations, deliberately separate from the packet
  engine's virtual clock.
* Links that are DOWN cannot carry new circuits (the routing graph omits them).
* A topology mutation that touches a reserved link (removal, or a capacity/status
  change) releases the circuits that traverse it, so reservations can never
  exceed what the topology can actually carry.

The manager keeps acceptance/blocking counters so the workspace can report the
classic circuit-switching admission metrics.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..models.link import Link
from ..models.node import Node
from ..routing.graph import MetricType, RoutingGraph

CIRCUIT_ACTIVE = "active"
CIRCUIT_RELEASED = "released"


@dataclass
class Circuit:
    circuit_id: str
    source_node_id: str
    target_node_id: str
    path: list[str]
    link_ids: list[str]
    bandwidth_bps: int
    request_index: int
    state: str = CIRCUIT_ACTIVE
    released_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "circuit_id": self.circuit_id,
            "source_node_id": self.source_node_id,
            "target_node_id": self.target_node_id,
            "path": list(self.path),
            "link_ids": list(self.link_ids),
            "bandwidth_bps": self.bandwidth_bps,
            "state": self.state,
            "request_index": self.request_index,
            "released_reason": self.released_reason,
        }


@dataclass
class LinkReservationView:
    link_id: str
    capacity_bps: int
    reserved_bps: int
    available_bps: int
    utilization: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "link_id": self.link_id,
            "capacity_bps": self.capacity_bps,
            "reserved_bps": self.reserved_bps,
            "available_bps": self.available_bps,
            "utilization": self.utilization,
        }


@dataclass
class CircuitRequestResult:
    accepted: bool
    circuit_id: str | None
    source_node_id: str
    target_node_id: str
    bandwidth_bps: int
    path: list[str] = field(default_factory=list)
    link_ids: list[str] = field(default_factory=list)
    reason: str = ""
    metrics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "accepted": self.accepted,
            "circuit_id": self.circuit_id,
            "source_node_id": self.source_node_id,
            "target_node_id": self.target_node_id,
            "bandwidth_bps": self.bandwidth_bps,
            "path": list(self.path),
            "link_ids": list(self.link_ids),
            "reason": self.reason,
            "metrics": dict(self.metrics),
        }


class CircuitManager:
    """Session-wide circuit registry with capacity accounting and admission metrics."""

    def __init__(self) -> None:
        self.circuits: dict[str, Circuit] = {}
        self.next_circuit_number = 1
        self.requests_total = 0
        self.requests_accepted = 0
        self.requests_blocked = 0
        self.circuits_released = 0

    # -- admission -----------------------------------------------------------

    def request_circuit(
        self,
        nodes: list[Node],
        links: list[Link],
        source_node_id: str,
        target_node_id: str,
        bandwidth_bps: int,
        circuit_id: str | None = None,
    ) -> CircuitRequestResult:
        """Attempt to set up a circuit; never leaves partial reservations behind.

        Raises ``ValueError`` for malformed requests (a duplicate circuit identifier);
        returns a blocked result for legitimate admission-control outcomes.
        """
        if circuit_id is not None and circuit_id in self.circuits:
            raise ValueError(f"Circuit identifier '{circuit_id}' is already in use")

        self.requests_total += 1
        request_index = self.requests_total

        graph = RoutingGraph.from_topology(nodes, links, MetricType.HOP_COUNT)
        result = graph.find_path(source_node_id, target_node_id)
        if result is None:
            self.requests_blocked += 1
            return self._blocked(
                source_node_id,
                target_node_id,
                bandwidth_bps,
                "No path exists between the endpoints in the current topology",
            )
        path, edges = result
        if not edges:
            self.requests_blocked += 1
            return self._blocked(
                source_node_id,
                target_node_id,
                bandwidth_bps,
                "A circuit requires at least one link between distinct endpoints",
            )

        # Capacity validation across the WHOLE path before any reservation is made.
        reserved = self._reserved_per_link()
        for edge in edges:
            available = edge.bandwidth_bps - reserved.get(edge.link_id, 0)
            if available < bandwidth_bps:
                self.requests_blocked += 1
                return self._blocked(
                    source_node_id,
                    target_node_id,
                    bandwidth_bps,
                    f"Insufficient capacity on link {edge.link_id}: "
                    f"need {bandwidth_bps} bps, {max(0, available)} bps available",
                )

        cid = circuit_id or f"circuit-{self.next_circuit_number}"
        self.next_circuit_number += 1
        circuit = Circuit(
            circuit_id=cid,
            source_node_id=source_node_id,
            target_node_id=target_node_id,
            path=list(path),
            link_ids=[edge.link_id for edge in edges],
            bandwidth_bps=bandwidth_bps,
            request_index=request_index,
        )
        self.circuits[cid] = circuit
        self.requests_accepted += 1
        return CircuitRequestResult(
            accepted=True,
            circuit_id=cid,
            source_node_id=source_node_id,
            target_node_id=target_node_id,
            bandwidth_bps=bandwidth_bps,
            path=circuit.path,
            link_ids=circuit.link_ids,
            reason="",
            metrics=self.metrics_dict(),
        )

    def teardown_circuit(self, circuit_id: str) -> Circuit:
        circuit = self.circuits.get(circuit_id)
        if circuit is None:
            raise KeyError(f"Circuit '{circuit_id}' does not exist")
        if circuit.state != CIRCUIT_ACTIVE:
            raise ValueError(f"Circuit '{circuit_id}' has already been released")
        circuit.state = CIRCUIT_RELEASED
        circuit.released_reason = "Released by teardown"
        self.circuits_released += 1
        return circuit

    def clear(self) -> None:
        """Drop all circuits and counters (project create/import)."""
        self.circuits.clear()
        self.next_circuit_number = 1
        self.requests_total = 0
        self.requests_accepted = 0
        self.requests_blocked = 0
        self.circuits_released = 0

    def release_circuits_for_link(self, link_id: str, reason: str) -> list[Circuit]:
        """Release every active circuit that reserved ``link_id`` (topology change)."""
        released: list[Circuit] = []
        for circuit in self.circuits.values():
            if circuit.state == CIRCUIT_ACTIVE and link_id in circuit.link_ids:
                circuit.state = CIRCUIT_RELEASED
                circuit.released_reason = reason
                self.circuits_released += 1
                released.append(circuit)
        return released

    # -- accounting ----------------------------------------------------------

    def _reserved_per_link(self) -> dict[str, int]:
        reserved: dict[str, int] = {}
        for circuit in self.circuits.values():
            if circuit.state != CIRCUIT_ACTIVE:
                continue
            for link_id in circuit.link_ids:
                reserved[link_id] = reserved.get(link_id, 0) + circuit.bandwidth_bps
        return reserved

    def _blocked(
        self,
        source_node_id: str,
        target_node_id: str,
        bandwidth_bps: int,
        reason: str,
    ) -> CircuitRequestResult:
        return CircuitRequestResult(
            accepted=False,
            circuit_id=None,
            source_node_id=source_node_id,
            target_node_id=target_node_id,
            bandwidth_bps=bandwidth_bps,
            reason=reason,
            metrics=self.metrics_dict(),
        )

    def metrics_dict(self) -> dict[str, Any]:
        acceptance_rate = self.requests_accepted / self.requests_total if self.requests_total else 0.0
        blocking_rate = self.requests_blocked / self.requests_total if self.requests_total else 0.0
        return {
            "requests_total": self.requests_total,
            "requests_accepted": self.requests_accepted,
            "requests_blocked": self.requests_blocked,
            "circuits_released": self.circuits_released,
            "circuits_active": sum(1 for c in self.circuits.values() if c.state == CIRCUIT_ACTIVE),
            "acceptance_rate": acceptance_rate,
            "blocking_rate": blocking_rate,
        }

    def link_views(self, links: list[Link]) -> list[LinkReservationView]:
        reserved = self._reserved_per_link()
        views: list[LinkReservationView] = []
        for link in sorted(links, key=lambda ln: ln.id):
            res = reserved.get(link.id, 0)
            capacity = max(0, link.bandwidth_bps)
            views.append(
                LinkReservationView(
                    link_id=link.id,
                    capacity_bps=capacity,
                    reserved_bps=res,
                    available_bps=max(0, capacity - res),
                    utilization=(res / capacity) if capacity else 0.0,
                )
            )
        return views

    def get_state(self, nodes: list[Node], links: list[Link]) -> dict[str, Any]:
        return {
            "circuits": [c.to_dict() for c in self.circuits.values()],
            "links": [v.to_dict() for v in self.link_views(links)],
            "metrics": self.metrics_dict(),
        }
