"""Authoritative routing graph built from Project topology."""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass
from enum import Enum
from typing import Any

from ..models.link import LinkStatus
from ..models.node import Node, NodeType
from ..models.project import Project


class MetricType(str, Enum):
    HOP_COUNT = "hop_count"
    PROPAGATION_DELAY = "propagation_delay"
    INVERSE_BANDWIDTH = "inverse_bandwidth"


class RoutingAlgorithm(str, Enum):
    DIJKSTRA = "dijkstra"
    BELLMAN_FORD = "bellman_ford"


@dataclass
class GraphEdge:
    link_id: str
    source: str
    target: str
    source_interface_id: str
    target_interface_id: str
    metric: int
    bandwidth_bps: int
    delay_us: int
    status: LinkStatus

    def to_dict(self) -> dict[str, Any]:
        return {
            "link_id": self.link_id,
            "source": self.source,
            "target": self.target,
            "source_interface_id": self.source_interface_id,
            "target_interface_id": self.target_interface_id,
            "metric": self.metric,
            "bandwidth_bps": self.bandwidth_bps,
            "delay_us": self.delay_us,
            "status": self.status.value,
        }


class RoutingGraph:
    def __init__(
        self,
        nodes: dict[str, Node],
        adjacency: dict[str, list[GraphEdge]],
        metric_type: MetricType,
    ):
        self.nodes = nodes
        self.adjacency = adjacency
        self.metric_type = metric_type

    @classmethod
    def from_project(cls, project: Project, metric_type: MetricType) -> RoutingGraph:
        nodes: dict[str, Node] = {node.id: node for node in project.nodes}
        adjacency: dict[str, list[GraphEdge]] = {node.id: [] for node in project.nodes}

        for link in project.links:
            if link.status == LinkStatus.DOWN:
                continue
            if link.source.node_id not in nodes or link.target.node_id not in nodes:
                continue

            if metric_type == MetricType.HOP_COUNT:
                base_metric = 1
            elif metric_type == MetricType.PROPAGATION_DELAY:
                base_metric = max(1, link.propagation_delay_us)
            elif metric_type == MetricType.INVERSE_BANDWIDTH:
                bw = max(1, link.bandwidth_bps)
                base_metric = max(1, math.ceil(1_000_000_000 / bw))
            else:
                base_metric = 1

            if link.status == LinkStatus.UP:
                effective_metric = base_metric
            elif link.status == LinkStatus.DEGRADED:
                effective_metric = max(base_metric * 3, base_metric + 50)
            else:
                continue

            # Edge A -> B
            adjacency[link.source.node_id].append(
                GraphEdge(
                    link_id=link.id,
                    source=link.source.node_id,
                    target=link.target.node_id,
                    source_interface_id=link.source.interface_id,
                    target_interface_id=link.target.interface_id,
                    metric=effective_metric,
                    bandwidth_bps=link.bandwidth_bps,
                    delay_us=link.propagation_delay_us,
                    status=link.status,
                )
            )

            # Edge B -> A (bidirectional)
            adjacency[link.target.node_id].append(
                GraphEdge(
                    link_id=link.id,
                    source=link.target.node_id,
                    target=link.source.node_id,
                    source_interface_id=link.target.interface_id,
                    target_interface_id=link.source.interface_id,
                    metric=effective_metric,
                    bandwidth_bps=link.bandwidth_bps,
                    delay_us=link.propagation_delay_us,
                    status=link.status,
                )
            )

        return cls(nodes=nodes, adjacency=adjacency, metric_type=metric_type)

    def is_l3_transit_capable(self, node_id: str) -> bool:
        node = self.nodes.get(node_id)
        if not node:
            return False
        return node.node_type == NodeType.ROUTER

    def is_transit_capable(self, node_id: str) -> bool:
        return self.is_l3_transit_capable(node_id)

    def is_routing_device(self, node_id: str) -> bool:
        node = self.nodes.get(node_id)
        if not node:
            return False
        return node.node_type == NodeType.ROUTER

    def is_l2_transparent_forwarder(self, node_id: str) -> bool:
        node = self.nodes.get(node_id)
        if not node:
            return False
        return node.node_type == NodeType.SWITCH

    def can_forward_traffic(self, node_id: str) -> bool:
        return self.is_l3_transit_capable(node_id) or self.is_l2_transparent_forwarder(node_id)

    def normalize_to_l3_path(self, physical_path: list[str]) -> list[str]:
        if not physical_path:
            return []
        if len(physical_path) <= 2:
            return list(physical_path)
        last_idx = len(physical_path) - 1
        res = []
        for idx, hop in enumerate(physical_path):
            if idx == 0 or idx == last_idx or not self.is_l2_transparent_forwarder(hop):
                res.append(hop)
        return res

    def find_path(self, source_node_id: str, target_node_id: str) -> tuple[list[str], list[GraphEdge]] | None:
        if source_node_id not in self.nodes or target_node_id not in self.nodes:
            return None
        if source_node_id == target_node_id:
            return ([source_node_id], [])

        dist: dict[str, float] = {n: float("inf") for n in self.nodes}
        dist[source_node_id] = 0
        prev: dict[str, tuple[str, GraphEdge]] = {}

        # Heap items: (cost, node_id)
        heap = [(0, source_node_id)]

        while heap:
            cost, node_id = heapq.heappop(heap)
            if cost > dist[node_id]:
                continue
            if node_id == target_node_id:
                break
            if node_id != source_node_id and not self.can_forward_traffic(node_id):
                continue

            for edge in self.adjacency.get(node_id, []):
                next_cost = cost + edge.metric
                curr_best = dist[edge.target]

                should_update = False
                if next_cost < curr_best:
                    should_update = True
                elif next_cost == curr_best and curr_best < float("inf"):
                    if edge.target in prev:
                        prev_node = prev[edge.target][0]
                        if node_id < prev_node:
                            should_update = True

                if should_update:
                    dist[edge.target] = next_cost
                    prev[edge.target] = (node_id, edge)
                    heapq.heappush(heap, (next_cost, edge.target))

        if target_node_id not in prev:
            return None

        path_nodes = []
        path_edges = []
        curr = target_node_id
        while curr != source_node_id:
            if curr not in prev:
                return None
            p_node, p_edge = prev[curr]
            path_nodes.append(curr)
            path_edges.append(p_edge)
            curr = p_node
        path_nodes.append(source_node_id)
        path_nodes.reverse()
        path_edges.reverse()
        return (path_nodes, path_edges)
