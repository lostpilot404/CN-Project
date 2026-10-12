"""Bellman-Ford Distance Vector routing algorithm with convergence telemetry."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .graph import RoutingGraph
from .table import RouteTableEntry, RoutingTable


@dataclass
class ConvergenceRound:
    round_number: int
    source_distances: dict[str, int]
    changes: list[str]
    changed: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "round_number": self.round_number,
            "source_distances": self.source_distances,
            "changes": self.changes,
            "changed": self.changed,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ConvergenceRound:
        return cls(
            round_number=int(data["round_number"]),
            source_distances={k: int(v) for k, v in data.get("source_distances", {}).items()},
            changes=data.get("changes", []),
            changed=bool(data.get("changed", False)),
        )


@dataclass
class ConvergenceTelemetry:
    algorithm: str
    source_node_id: str
    total_rounds: int
    converged: bool
    rounds: list[ConvergenceRound]
    final_routing_table: RoutingTable

    def to_dict(self) -> dict[str, Any]:
        return {
            "algorithm": self.algorithm,
            "source_node_id": self.source_node_id,
            "total_rounds": self.total_rounds,
            "converged": self.converged,
            "rounds": [r.to_dict() for r in self.rounds],
            "final_routing_table": self.final_routing_table.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ConvergenceTelemetry:
        return cls(
            algorithm=data.get("algorithm", "Bellman-Ford (Distance-Vector)"),
            source_node_id=data["source_node_id"],
            total_rounds=int(data.get("total_rounds", 0)),
            converged=bool(data.get("converged", False)),
            rounds=[ConvergenceRound.from_dict(r) for r in data.get("rounds", [])],
            final_routing_table=RoutingTable.from_dict(data["final_routing_table"]),
        )


def simulate_distance_vector_convergence(graph: RoutingGraph, source_node_id: str) -> ConvergenceTelemetry:
    source_node = graph.nodes.get(source_node_id)
    if not source_node:
        raise ValueError(f"Node '{source_node_id}' not found in routing graph")

    if not graph.is_routing_device(source_node_id):
        raise ValueError(
            f"Node '{source_node.label}' ({source_node.node_type.value}) is not an L3 routing device. "
            "Routing tables are only generated for Routers."
        )

    all_node_ids = sorted(graph.nodes.keys())
    num_nodes = len(all_node_ids)

    # dist[u][v], next_hop[u][v]
    dist: dict[str, dict[str, int]] = {}
    next_hop: dict[str, dict[str, str | None]] = {}

    for u in all_node_ids:
        u_dist: dict[str, int] = {}
        u_next: dict[str, str | None] = {}
        for v in all_node_ids:
            if u == v:
                u_dist[v] = 0
                u_next[v] = None
            else:
                u_dist[v] = 2**64 - 1
                u_next[v] = None

        for edge in graph.adjacency.get(u, []):
            curr_metric = u_dist[edge.target]
            # Bind the optional next-hop to a local so it narrows on the `is None` test; mypy
            # does not narrow a repeated subscript expression.
            current_next_hop = u_next[edge.target]
            if edge.metric < curr_metric or (
                edge.metric == curr_metric and (current_next_hop is None or edge.target < current_next_hop)
            ):
                u_dist[edge.target] = edge.metric
                u_next[edge.target] = edge.target

        dist[u] = u_dist
        next_hop[u] = u_next

    rounds: list[ConvergenceRound] = []
    round_0_distances = dict(dist[source_node_id])
    rounds.append(
        ConvergenceRound(
            round_number=0,
            source_distances=round_0_distances,
            changes=["Initial local neighbor discovery (Round 0)"],
            changed=True,
        )
    )

    max_rounds = max(1, num_nodes)
    converged = False

    for r in range(1, max_rounds + 1):
        new_dist = {u: dict(v) for u, v in dist.items()}
        new_next_hop = {u: dict(v) for u, v in next_hop.items()}
        round_changes = []
        any_changed = False

        for u in all_node_ids:
            edges = graph.adjacency.get(u, [])
            for edge in edges:
                v = edge.target
                link_cost = edge.metric
                v_can_forward = graph.can_forward_traffic(v)

                for d in all_node_ids:
                    if d == u:
                        continue
                    if not v_can_forward and d != v:
                        continue

                    v_to_d_cost = dist[v].get(d, 2**64 - 1)
                    if v_to_d_cost >= 2**64 - 1:
                        continue

                    candidate_cost = link_cost + v_to_d_cost
                    current_cost = new_dist[u].get(d, 2**64 - 1)
                    current_nh = new_next_hop[u].get(d)

                    should_update = False
                    if candidate_cost < current_cost:
                        should_update = True
                    elif candidate_cost == current_cost and current_cost < 2**64 - 1:
                        if current_nh is None or v < current_nh:
                            should_update = True

                    if should_update:
                        new_dist[u][d] = candidate_cost
                        new_next_hop[u][d] = v

                        if u == source_node_id:
                            round_changes.append(
                                f"Updated route to {d} via {v}: cost {candidate_cost} "
                                f"(was {'inf' if current_cost >= 2**64 - 1 else current_cost})"
                            )
                        any_changed = True

        dist = new_dist
        next_hop = new_next_hop

        rounds.append(
            ConvergenceRound(
                round_number=r,
                source_distances=dict(dist[source_node_id]),
                changes=round_changes,
                changed=any_changed,
            )
        )

        if not any_changed:
            converged = True
            break

    final_routing_table = _build_routing_table_from_vectors(graph, source_node_id, dist, next_hop)

    return ConvergenceTelemetry(
        algorithm="Bellman-Ford (Distance-Vector)",
        source_node_id=source_node_id,
        total_rounds=max(0, len(rounds) - 1),
        converged=converged,
        rounds=rounds,
        final_routing_table=final_routing_table,
    )


def _build_routing_table_from_vectors(
    graph: RoutingGraph,
    source_node_id: str,
    dist: dict[str, dict[str, int]],
    next_hop: dict[str, dict[str, str | None]],
) -> RoutingTable:
    source_node = graph.nodes[source_node_id]
    entries = []
    sorted_destinations = sorted(graph.nodes.keys())
    source_dist = dist[source_node_id]

    for dest_id in sorted_destinations:
        dest_node = graph.nodes[dest_id]
        cost = source_dist.get(dest_id, 2**64 - 1)

        if dest_id == source_node_id:
            entries.append(
                RouteTableEntry(
                    destination=dest_id,
                    destination_label=dest_node.label,
                    next_hop=None,
                    interface_id=None,
                    metric=0,
                    path=[source_node_id],
                    is_reachable=True,
                    protocol="Local",
                )
            )
            continue

        if cost >= 2**64 - 1:
            entries.append(
                RouteTableEntry(
                    destination=dest_id,
                    destination_label=dest_node.label,
                    next_hop=None,
                    interface_id=None,
                    metric=2**64 - 1,
                    path=[],
                    is_reachable=False,
                    protocol="Bellman-Ford",
                )
            )
            continue

        physical_path = [source_node_id]
        curr = source_node_id
        visited = {curr}

        while curr != dest_id:
            nxt = next_hop.get(curr, {}).get(dest_id)
            if not nxt or nxt in visited:
                break
            visited.add(nxt)
            physical_path.append(nxt)
            curr = nxt

        l3_path = graph.normalize_to_l3_path(physical_path)
        l3_next_hop = l3_path[1] if len(l3_path) >= 2 else None

        egress_interface = None
        if len(physical_path) >= 2:
            first_hop = physical_path[1]
            for edge in graph.adjacency.get(source_node_id, []):
                if edge.target == first_hop:
                    egress_interface = edge.source_interface_id
                    break

        entries.append(
            RouteTableEntry(
                destination=dest_id,
                destination_label=dest_node.label,
                next_hop=l3_next_hop,
                interface_id=egress_interface,
                metric=cost,
                path=l3_path,
                is_reachable=True,
                protocol="Bellman-Ford",
            )
        )

    return RoutingTable(
        node_id=source_node_id,
        node_label=source_node.label,
        algorithm="Bellman-Ford (Distance-Vector)",
        metric_type=graph.metric_type.value,
        entries=entries,
    )


def compute_bellman_ford_shortest_paths(graph: RoutingGraph, source_node_id: str) -> RoutingTable:
    telemetry = simulate_distance_vector_convergence(graph, source_node_id)
    return telemetry.final_routing_table
