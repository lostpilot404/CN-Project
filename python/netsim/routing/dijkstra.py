"""Dijkstra Link-State shortest path routing algorithm."""

import heapq

from .graph import RoutingGraph
from .table import RouteTableEntry, RoutingTable


def compute_dijkstra_shortest_paths(graph: RoutingGraph, source_node_id: str) -> RoutingTable:
    source_node = graph.nodes.get(source_node_id)
    if not source_node:
        raise ValueError(f"Node '{source_node_id}' not found in routing graph")

    if not graph.is_routing_device(source_node_id):
        raise ValueError(
            f"Node '{source_node.label}' ({source_node.node_type.value}) is not an L3 routing device. "
            "Routing tables are only generated for Routers."
        )

    dist: dict[str, float] = {node_id: float("inf") for node_id in graph.nodes}
    dist[source_node_id] = 0
    prev: dict[str, str] = {}

    heap: list[tuple[float, str]] = [(0.0, source_node_id)]

    while heap:
        cost, node_id = heapq.heappop(heap)
        if cost > dist[node_id]:
            continue

        if node_id != source_node_id and not graph.can_forward_traffic(node_id):
            continue

        for edge in graph.adjacency.get(node_id, []):
            next_cost = cost + edge.metric
            curr_best = dist[edge.target]

            should_update = False
            if next_cost < curr_best:
                should_update = True
            elif next_cost == curr_best and curr_best < float("inf"):
                if edge.target in prev:
                    if node_id < prev[edge.target]:
                        should_update = True

            if should_update:
                dist[edge.target] = next_cost
                prev[edge.target] = node_id
                heapq.heappush(heap, (next_cost, edge.target))

    entries: list[RouteTableEntry] = []
    sorted_destinations = sorted(graph.nodes.keys())

    for dest_id in sorted_destinations:
        dest_node = graph.nodes[dest_id]
        cost = dist[dest_id]

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

        if cost == float("inf"):
            entries.append(
                RouteTableEntry(
                    destination=dest_id,
                    destination_label=dest_node.label,
                    next_hop=None,
                    interface_id=None,
                    metric=2**64 - 1,
                    path=[],
                    is_reachable=False,
                    protocol="Dijkstra",
                )
            )
            continue

        physical_path = [dest_id]
        curr = dest_id
        while curr != source_node_id:
            if curr in prev:
                curr = prev[curr]
                physical_path.append(curr)
            else:
                break
        physical_path.reverse()

        l3_path = graph.normalize_to_l3_path(physical_path)
        next_hop = l3_path[1] if len(l3_path) >= 2 else None

        egress_interface: str | None = None
        if len(physical_path) >= 2:
            first_physical_hop = physical_path[1]
            for e in graph.adjacency.get(source_node_id, []):
                if e.target == first_physical_hop:
                    egress_interface = e.source_interface_id
                    break

        entries.append(
            RouteTableEntry(
                destination=dest_id,
                destination_label=dest_node.label,
                next_hop=next_hop,
                interface_id=egress_interface,
                metric=int(cost),
                path=l3_path,
                is_reachable=True,
                protocol="Dijkstra",
            )
        )

    return RoutingTable(
        node_id=source_node_id,
        node_label=source_node.label,
        algorithm="Dijkstra (Link-State)",
        metric_type=graph.metric_type.value,
        entries=entries,
    )
