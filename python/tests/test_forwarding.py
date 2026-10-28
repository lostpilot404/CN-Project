"""Live packet-forwarding model: routing-table-driven next hops, TTL, faults and drop accounting.

The engine resolves every forwarding decision with the authoritative routing graph
(``netsim.routing.graph.RoutingGraph``) — the same Dijkstra shortest-path machinery that
builds the Routing Studio tables. These tests pin the documented forwarding policy
(dijkstra + hop_count), the failure semantics (an unreachable destination is an explicit
drop, never a delivery) and the exactly-once terminal accounting.

Expected values are hand-calculated from the documented timing model:
  ingress queueing delay 5 us at the source, 1 us per transit forwarding decision,
  serialisation + propagation per link.
"""

from __future__ import annotations

import pytest
from netsim.core.clock import SimTime
from netsim.core.engine import (
    DEFAULT_PACKET_TTL,
    MAX_NODE_VISITS,
    SimulationEngine,
)
from netsim.models.link import Link, LinkEndpoint, LinkStatus
from netsim.models.node import Node, NodeType
from netsim.models.packet import PacketState
from netsim.models.project import Project
from netsim.routing.graph import MetricType, RoutingAlgorithm, RoutingGraph

# ---------------------------------------------------------------------------
# Engine-level helpers (deterministic, no HTTP)
# ---------------------------------------------------------------------------


def _link(link_id: str, a: Node, b: Node, delay_us: int = 1000, bandwidth_bps: int = 1_000_000) -> Link:
    return Link(
        id=link_id,
        source=LinkEndpoint(node_id=a.id, interface_id=a.interfaces[0].id),
        target=LinkEndpoint(node_id=b.id, interface_id=b.interfaces[0].id),
        bandwidth_bps=bandwidth_bps,
        propagation_delay_us=delay_us,
        loss_probability=0.0,
        bit_error_rate=0.0,
        queue_capacity=50,
        status=LinkStatus.UP,
    )


def _host(node_id: str, label: str, ntype: NodeType = NodeType.HOST) -> Node:
    return Node.create(node_id, label, ntype, 100.0, 100.0)


def _engine(project: Project, seed: int = 42) -> SimulationEngine:
    engine = SimulationEngine(seed=seed)
    engine.update_topology(project.nodes, project.links)
    return engine


def _single_drop_hops(pkt) -> list:
    drops = [h for h in pkt.hop_history if h.state.is_terminal_drop()]
    return drops


def make_linear_project() -> Project:
    """A(host) -- R1(router) -- B(host): one two-hop path through an intermediate router."""
    a = _host("node-a", "Host A")
    r1 = _host("r1", "Router 1", NodeType.ROUTER)
    b = _host("node-b", "Host B")
    l1 = _link("l-a-r1", a, r1)
    l2 = _link("l-r1-b", r1, b)
    return Project.create("Linear", nodes=[a, r1, b], links=[l1, l2])


def make_diamond_project(fast_via_top: bool = True) -> Project:
    """Two candidate two-hop paths: A -- T -- B and A -- U -- B (T/U are routers).

    Both paths cost 2 hops; ``fast_via_top=True`` additionally gives the upper path
    (through ``rt-t``) a 10x lower propagation delay so the path choice is unambiguous
    under the propagation-delay metric.
    """
    a = _host("node-a", "Host A")
    t = _host("rt-t", "Router T", NodeType.ROUTER)
    u = _host("rt-u", "Router U", NodeType.ROUTER)
    b = _host("node-b", "Host B")
    top_delay = 100 if fast_via_top else 1000
    bottom_delay = 1000 if fast_via_top else 100
    l1 = _link("l-a-t", a, t, delay_us=top_delay)
    l2 = _link("l-t-b", t, b, delay_us=top_delay)
    l3 = _link("l-a-u", a, u, delay_us=bottom_delay)
    l4 = _link("l-u-b", u, b, delay_us=bottom_delay)
    return Project.create("Diamond", nodes=[a, t, u, b], links=[l1, l2, l3, l4])


def make_reroute_project() -> Project:
    """A -- T -- B with a detour T -- U -- B behind it.

    From A the shortest path is A-T-B (2 hops) over A-T-U-B (3 hops). When the T-B
    link fails mid-flight at T, the remaining path T-U-B is the only way forward and
    T (a router) can reach it — the packet must be re-routed, not dropped.
    """
    a = _host("node-a", "Host A")
    t = _host("rt-t", "Router T", NodeType.ROUTER)
    u = _host("rt-u", "Router U", NodeType.ROUTER)
    b = _host("node-b", "Host B")
    l1 = _link("l-a-t", a, t, delay_us=1000)
    l2 = _link("l-t-b", t, b, delay_us=1000)
    l3 = _link("l-t-u", t, u, delay_us=100)
    l4 = _link("l-u-b", u, b, delay_us=100)
    return Project.create("Reroute", nodes=[a, t, u, b], links=[l1, l2, l3, l4])


# ---------------------------------------------------------------------------
# 1. Direct route
# ---------------------------------------------------------------------------


def test_direct_route_delivers_with_matching_journey_and_planned_route():
    a = _host("node-a", "Host A")
    b = _host("node-b", "Host B")
    proj = Project.create("Direct", nodes=[a, b], links=[_link("l-ab", a, b)])
    engine = _engine(proj)

    pkt_id = engine.inject_packet("node-a", "node-b", 1000, "HTTP", "TCP")
    engine.run_all()
    pkt = engine.packets[pkt_id]

    assert pkt.state == PacketState.DELIVERED
    assert pkt.planned_route == ["node-a", "node-b"]
    assert pkt.journey_hops == ["node-a", "node-b"]
    assert engine.metrics.packets_delivered == 1


# ---------------------------------------------------------------------------
# 2. Route through an intermediate router
# ---------------------------------------------------------------------------


def test_route_through_intermediate_router_follows_the_routing_path():
    engine = _engine(make_linear_project())
    pkt_id = engine.inject_packet("node-a", "node-b", 1000, "HTTP", "TCP")
    engine.run_all()
    pkt = engine.packets[pkt_id]

    assert pkt.state == PacketState.DELIVERED
    assert pkt.planned_route == ["node-a", "r1", "node-b"]
    assert pkt.journey_hops == ["node-a", "r1", "node-b"]
    # Every transit arrival is a hop record; the journey matches the plan exactly.
    transit = [h for h in pkt.hop_history if h.node_id == "r1"]
    assert transit, "the packet must record its transit through r1"


def test_a_host_is_not_a_transit_forwarder():
    """A -- B(host) -- C: B is an endpoint, so no route exists and the packet is dropped."""
    a = _host("node-a", "Host A")
    b = _host("node-b", "Host B")
    c = _host("node-c", "Host C")
    proj = Project.create(
        "HostTransit",
        nodes=[a, b, c],
        links=[_link("l-ab", a, b), _link("l-bc", b, c)],
    )
    engine = _engine(proj)
    pkt_id = engine.inject_packet("node-a", "node-c", 500, "HTTP", "UDP")
    engine.run_all()
    pkt = engine.packets[pkt_id]

    assert pkt.state == PacketState.DROPPED_NO_ROUTE
    assert engine.metrics.packets_delivered == 0
    assert engine.metrics.packets_dropped_no_route == 1
    assert len(_single_drop_hops(pkt)) == 1


# ---------------------------------------------------------------------------
# 3. Multiple candidate paths
# ---------------------------------------------------------------------------


def test_multiple_candidate_paths_are_resolved_deterministically():
    """Two equal-cost two-hop candidates: the tie-break is deterministic and the
    journey matches the plan on every run."""
    engine = _engine(make_diamond_project(fast_via_top=True))
    pkt_id = engine.inject_packet("node-a", "node-b", 1000, "HTTP", "TCP")
    engine.run_all()
    pkt = engine.packets[pkt_id]

    assert pkt.state == PacketState.DELIVERED
    assert pkt.planned_route in (["node-a", "rt-t", "node-b"], ["node-a", "rt-u", "node-b"])
    assert pkt.journey_hops == pkt.planned_route

    # Deterministic execution: an identical configuration and seed repeats exactly.
    engine2 = _engine(make_diamond_project(fast_via_top=True))
    pkt2_id = engine2.inject_packet("node-a", "node-b", 1000, "HTTP", "TCP")
    engine2.run_all()
    pkt2 = engine2.packets[pkt2_id]
    assert pkt2.planned_route == pkt.planned_route
    assert [h.timestamp_us for h in pkt2.hop_history] == [h.timestamp_us for h in pkt.hop_history]


def test_propagation_delay_metric_prefers_the_lower_delay_path():
    """Under the propagation-delay metric the 2x100 us path must beat the 2x1000 us one."""
    engine = _engine(make_diamond_project(fast_via_top=True))
    engine.forwarding_metric = MetricType.PROPAGATION_DELAY
    pkt_id = engine.inject_packet("node-a", "node-b", 1000, "HTTP", "TCP")
    engine.run_all()
    pkt = engine.packets[pkt_id]
    assert pkt.state == PacketState.DELIVERED
    assert pkt.planned_route == ["node-a", "rt-t", "node-b"]

    # Reverse the delays: the other path must now win under the same metric.
    engine2 = _engine(make_diamond_project(fast_via_top=False))
    engine2.forwarding_metric = MetricType.PROPAGATION_DELAY
    pkt2_id = engine2.inject_packet("node-a", "node-b", 1000, "HTTP", "TCP")
    engine2.run_all()
    pkt2 = engine2.packets[pkt2_id]
    assert pkt2.state == PacketState.DELIVERED
    assert pkt2.planned_route == ["node-a", "rt-u", "node-b"]


# ---------------------------------------------------------------------------
# 4. Link failure that permits an alternate route
# ---------------------------------------------------------------------------


def test_link_failure_reroutes_traffic_over_the_alternate_path():
    """Fail the preferred upper path at injection time; the packet must take the lower path."""
    engine = _engine(make_diamond_project(fast_via_top=True))
    # Take the preferred path down before the packet is created.
    for link_id in ("l-a-t", "l-t-b"):
        engine.links_cache[link_id].status = LinkStatus.DOWN

    pkt_id = engine.inject_packet("node-a", "node-b", 1000, "HTTP", "TCP")
    engine.run_all()
    pkt = engine.packets[pkt_id]

    assert pkt.state == PacketState.DELIVERED
    assert pkt.planned_route == ["node-a", "rt-u", "node-b"]
    assert pkt.journey_hops == ["node-a", "rt-u", "node-b"]
    assert engine.metrics.packets_delivered == 1
    assert engine.metrics.total_dropped() == 0


def test_mid_flight_link_failure_reroutes_at_the_transit_node():
    """A packet already in flight is re-routed at the next transit decision.

    Timing (1000 B at 1 Mbps, 1000 us propagation): the packet leaves node-a at
    t=5 us and arrives at rt-t at 5 + 8000 + 1000 = 9005 us. The preferred second
    hop (l-t-b) is failed before forwarding is resolved at rt-t, so the packet must
    continue rt-t -> rt-u -> rt-b instead of being dropped.
    """
    engine = _engine(make_reroute_project())
    pkt_id = engine.inject_packet("node-a", "node-b", 1000, "HTTP", "TCP")
    # Fail the preferred second hop while the packet is still in flight (it lands at
    # rt-t at 9005 us; the transit forwarding decision runs at that instant).
    engine.run_until(SimTime.from_micros(9_000))
    assert engine.packets[pkt_id].state == PacketState.IN_FLIGHT
    engine.links_cache["l-t-b"].status = LinkStatus.DOWN
    engine.run_all()
    pkt = engine.packets[pkt_id]

    assert pkt.state == PacketState.DELIVERED
    # The journey reflects what actually happened; the plan was updated to match.
    assert pkt.journey_hops == ["node-a", "rt-t", "rt-u", "node-b"]
    assert pkt.planned_route == pkt.journey_hops


# ---------------------------------------------------------------------------
# 5. Failure that disconnects the destination
# ---------------------------------------------------------------------------


def test_a_disconnected_destination_is_dropped_never_delivered():
    engine = _engine(make_linear_project())
    # Both links down: the destination is unreachable even though the topology has a path.
    for link in engine.links_cache.values():
        link.status = LinkStatus.DOWN

    pkt_id = engine.inject_packet("node-a", "node-b", 500, "HTTP", "TCP")
    engine.run_all()
    pkt = engine.packets[pkt_id]

    assert pkt.state != PacketState.DELIVERED
    assert pkt.state == PacketState.DROPPED_LINK_DOWN
    assert engine.metrics.packets_delivered == 0
    assert engine.metrics.packets_dropped_link_down == 1
    assert len(_single_drop_hops(pkt)) == 1


def test_a_destination_with_no_topology_path_is_dropped_as_no_route():
    a = _host("node-a", "Host A")
    b = _host("node-b", "Host B")
    lonely = _host("node-lonely", "Lonely Host")
    proj = Project.create(
        "Unreachable",
        nodes=[a, b, lonely],
        links=[_link("l-ab", a, b)],
    )
    engine = _engine(proj)
    pkt_id = engine.inject_packet("node-a", "node-lonely", 500, "HTTP", "TCP")
    engine.run_all()
    pkt = engine.packets[pkt_id]

    assert pkt.state == PacketState.DROPPED_NO_ROUTE
    assert engine.metrics.packets_delivered == 0
    assert engine.metrics.packets_dropped_no_route == 1
    assert len(_single_drop_hops(pkt)) == 1


# ---------------------------------------------------------------------------
# 6. Hop limit (TTL) and loop protection
# ---------------------------------------------------------------------------


def test_ttl_expires_on_a_path_longer_than_the_hop_limit():
    """A -- R1 -- R2 -- B with TTL 2: the packet reaches R2 and is dropped there."""
    a = _host("node-a", "Host A")
    r1 = _host("r1", "Router 1", NodeType.ROUTER)
    r2 = _host("r2", "Router 2", NodeType.ROUTER)
    b = _host("node-b", "Host B")
    proj = Project.create(
        "ThreeHop",
        nodes=[a, r1, r2, b],
        links=[_link("l1", a, r1), _link("l2", r1, r2), _link("l3", r2, b)],
    )
    engine = _engine(proj)
    pkt_id = engine.inject_packet("node-a", "node-b", 500, "HTTP", "UDP", ttl=2)
    engine.run_all()
    pkt = engine.packets[pkt_id]

    assert pkt.state == PacketState.DROPPED_TTL_EXPIRED
    assert engine.metrics.packets_dropped_ttl == 1
    assert engine.metrics.packets_delivered == 0
    # One TTL consumption per transit: at r1 (ttl 2->1) and r2 (ttl 1->0, drop).
    assert pkt.headers.network.ttl == 0
    assert pkt.journey_hops == ["node-a", "r1", "r2"]
    assert len(_single_drop_hops(pkt)) == 1


def test_default_ttl_allows_a_normal_multi_hop_delivery():
    engine = _engine(make_linear_project())
    pkt_id = engine.inject_packet("node-a", "node-b", 500, "HTTP", "TCP")
    engine.run_all()
    pkt = engine.packets[pkt_id]
    assert pkt.state == PacketState.DELIVERED
    # One transit forwarding decision (at r1) consumed one TTL unit.
    assert pkt.headers.network.ttl == DEFAULT_PACKET_TTL - 1


def test_loop_guard_drops_a_packet_that_keeps_revisiting_the_same_node():
    """Loop protection: a packet that revisits a node too often is dropped.

    A consistent shortest-path computation cannot loop on a static topology; loops can
    only appear while the topology is changing mid-flight. The guard is therefore
    exercised here by simulating the loop's effect on the journey record and checking
    that the next real arrival at the repeated node terminates the packet exactly once.
    """
    engine = _engine(make_linear_project())
    pkt_id = engine.inject_packet("node-a", "node-b", 500, "HTTP", "TCP")
    pkt = engine.packets[pkt_id]
    # Simulate what a routing loop would have done: several extra visits to r1.
    pkt.journey_hops.extend(["r1"] * (MAX_NODE_VISITS + 1))
    engine.run_all()

    assert pkt.state == PacketState.DROPPED_TTL_EXPIRED
    assert engine.metrics.packets_dropped_ttl == 1
    assert engine.metrics.packets_delivered == 0
    assert len(_single_drop_hops(pkt)) == 1


def test_inject_rejects_an_out_of_range_ttl():
    engine = _engine(make_linear_project())
    with pytest.raises(ValueError):
        engine.inject_packet("node-a", "node-b", 500, "HTTP", "TCP", ttl=0)
    with pytest.raises(ValueError):
        engine.inject_packet("node-a", "node-b", 500, "HTTP", "TCP", ttl=256)


# ---------------------------------------------------------------------------
# 7. Faults and restoration
# ---------------------------------------------------------------------------


def test_restored_link_carries_traffic_again_and_routing_agrees():
    engine = _engine(make_linear_project())
    engine.schedule_fault("f-down", 5_000, {"type": "link_down", "link_id": "l-a-r1"})
    engine.schedule_fault("f-up", 20_000, {"type": "link_restore", "link_id": "l-a-r1"})

    engine.run_until(SimTime.from_micros(10_000))
    lost_id = engine.inject_packet("node-a", "node-b", 500, "HTTP", "TCP")
    engine.run_until(SimTime.from_micros(30_000))
    ok_id = engine.inject_packet("node-a", "node-b", 500, "HTTP", "TCP")
    engine.run_all()

    lost = engine.packets[lost_id]
    ok = engine.packets[ok_id]
    assert lost.state == PacketState.DROPPED_LINK_DOWN
    assert ok.state == PacketState.DELIVERED
    assert ok.journey_hops == ["node-a", "r1", "node-b"]
    assert engine.metrics.packets_delivered == 1
    assert engine.metrics.packets_dropped_link_down == 1
    assert engine.metrics.total_dropped() == 1


def test_reset_restores_link_state_and_allows_fresh_delivery():
    engine = _engine(make_linear_project())
    engine.links_cache["l-a-r1"].status = LinkStatus.DOWN
    lost_id = engine.inject_packet("node-a", "node-b", 500, "HTTP", "TCP")
    engine.run_all()
    assert engine.packets[lost_id].state == PacketState.DROPPED_LINK_DOWN

    engine.links_cache["l-a-r1"].status = LinkStatus.UP
    engine.reset(seed=42)
    ok_id = engine.inject_packet("node-a", "node-b", 500, "HTTP", "TCP")
    engine.run_all()
    assert engine.packets[ok_id].state == PacketState.DELIVERED
    assert engine.metrics.packets_dropped_link_down == 0  # counters reset


# ---------------------------------------------------------------------------
# 8. Malformed routing-related API requests (real HTTP service)
# ---------------------------------------------------------------------------


def test_malformed_routing_requests_are_rejected_with_structured_errors(api):
    msg = api.error("calculate_routing_table", {"nodeId": "ghost", "algorithm": "dijkstra"})
    assert "not found" in msg

    # Routing tables are only generated for L3 routers.
    msg = api.error("calculate_routing_table", {"nodeId": "node-1", "algorithm": "dijkstra"})
    assert "L3 routing device" in msg

    msg = api.error("set_forwarding_policy", {"algorithm": "ospf"})
    assert "Unsupported forwarding algorithm" in msg

    msg = api.error("set_forwarding_policy", {"algorithm": "dijkstra", "metricType": "banana"})
    assert "metric" in msg.lower()

    msg = api.error(
        "inject_packet",
        {"srcNodeId": "node-1", "dstNodeId": "node-3", "ttl": 0},
    )
    assert "TTL" in msg

    msg = api.error(
        "inject_packet",
        {"srcNodeId": "node-1", "dstNodeId": "node-3", "ttl": "many"},
    )
    assert "TTL" in msg


def test_forwarding_policy_round_trip_and_snapshot_reporting(api):
    policy = api.result("set_forwarding_policy", {"algorithm": "dijkstra", "metricType": "propagation_delay"})
    assert policy == {"algorithm": "dijkstra", "metric_type": "propagation_delay", "default_ttl": DEFAULT_PACKET_TTL}
    state = api.result("get_simulation_state")
    assert state["forwarding_policy"]["metric_type"] == "propagation_delay"
    # Restore the documented default so shared session state stays predictable.
    api.result("set_forwarding_policy", {"algorithm": "dijkstra", "metricType": "hop_count"})


# ---------------------------------------------------------------------------
# API-level end-to-end forwarding behaviour (default topology: PC -- Router -- Server)
# ---------------------------------------------------------------------------


def test_default_topology_delivery_journey_matches_the_planned_route(api):
    packet_id = api.result(
        "inject_packet",
        {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 1000},
    )
    api.result("run_simulation_until_empty")
    detail = api.result("get_packet_details", {"packetId": packet_id})
    assert detail["state"] == "delivered"
    assert detail["planned_route"] == ["node-1", "node-2", "node-3"]
    assert detail["journey_hops"] == ["node-1", "node-2", "node-3"]


def test_api_level_unreachable_destination_reports_an_explicit_drop(api):
    # node-3's link down and no alternate: the destination is disconnected.
    api.result("update_link", {"linkId": "link-2", "status": "down"})
    packet_id = api.result(
        "inject_packet",
        {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 500},
    )
    api.result("run_simulation_until_empty")
    detail = api.result("get_packet_details", {"packetId": packet_id})
    assert detail["state"] == "dropped_link_down"
    drops = [h for h in detail["hop_history"] if h["state"].startswith("dropped")]
    assert len(drops) == 1
    state = api.result("get_simulation_state")
    assert state["metrics"]["packets_delivered"] == 0
    assert state["metrics"]["packets_dropped_link_down"] == 1
    assert state["metrics"]["packets_dropped_ttl"] == 0
    assert state["metrics"]["packets_dropped_no_route"] == 0


def test_identical_seeded_runs_are_deterministic_through_the_api(api):
    def run_once() -> list[tuple]:
        api.result("reset_simulation")
        ids = [
            api.result(
                "inject_packet",
                {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 400},
            )
            for _ in range(3)
        ]
        api.result("run_simulation_until_empty")
        out = []
        for pid in ids:
            detail = api.result("get_packet_details", {"packetId": pid})
            out.append(
                (
                    detail["state"],
                    tuple(detail["journey_hops"]),
                    tuple(h["timestamp_us"] for h in detail["hop_history"]),
                )
            )
        return out

    first = run_once()
    second = run_once()
    assert first == second


# ---------------------------------------------------------------------------
# 9. Bellman-Ford as a supported live-forwarding algorithm
# ---------------------------------------------------------------------------


def _all_pairs_paths(project: Project, algorithm) -> dict[tuple[str, str], tuple | None]:
    graph = RoutingGraph.from_topology(project.nodes, project.links, MetricType.HOP_COUNT)
    result = {}
    for src in [n.id for n in project.nodes]:
        for dst in [n.id for n in project.nodes]:
            result[(src, dst)] = graph.find_path(src, dst, algorithm=algorithm)
    return result


@pytest.mark.parametrize("metric", [MetricType.HOP_COUNT, MetricType.PROPAGATION_DELAY, MetricType.INVERSE_BANDWIDTH])
def test_bellman_ford_and_dijkstra_agree_on_every_pair(metric):
    """Both algorithms minimise the metric with the same deterministic tie-break.

    On every topology pair and metric, the live path (nodes AND chosen edges) must be
    identical, so switching the forwarding policy can never change which path a packet
    takes — only the computation that finds it.
    """
    for project in (make_linear_project(), make_diamond_project(), make_reroute_project()):
        graph = RoutingGraph.from_topology(project.nodes, project.links, metric)
        for src in [n.id for n in project.nodes]:
            for dst in [n.id for n in project.nodes]:
                dij = graph.find_path(src, dst, algorithm=RoutingAlgorithm.DIJKSTRA)
                bmf = graph.find_path(src, dst, algorithm=RoutingAlgorithm.BELLMAN_FORD)
                if dij is None:
                    assert bmf is None, f"{src}->{dst} unreachable for Dijkstra but not Bellman-Ford"
                    continue
                assert bmf is not None, f"{src}->{dst} reachable for Dijkstra but not Bellman-Ford"
                assert dij[0] == bmf[0], f"node path differs on {src}->{dst}: {dij[0]} vs {bmf[0]}"
                assert [e.link_id for e in dij[1]] == [e.link_id for e in bmf[1]]


def test_bellman_ford_tie_break_matches_dijkstra_on_equal_cost_paths():
    """Equal-cost diamond: both algorithms must pick the same arm (smallest predecessor id)."""
    project = make_diamond_project(fast_via_top=False)  # both arms cost 2 hops, equal delay
    graph = RoutingGraph.from_topology(project.nodes, project.links, MetricType.HOP_COUNT)
    dij = graph.find_path("node-a", "node-b", algorithm=RoutingAlgorithm.DIJKSTRA)
    bmf = graph.find_path("node-a", "node-b", algorithm=RoutingAlgorithm.BELLMAN_FORD)
    assert dij is not None and bmf is not None
    assert dij[0] == bmf[0]
    # Deterministic documented tie-break: smallest predecessor node id ('rt-t' < 'rt-u').
    assert dij[0] == ["node-a", "rt-t", "node-b"]


def test_forwarding_policy_accepts_bellman_ford_and_reports_it(api):
    policy = api.result("set_forwarding_policy", {"algorithm": "bellman_ford", "metricType": "hop_count"})
    assert policy == {
        "algorithm": "bellman_ford",
        "metric_type": "hop_count",
        "default_ttl": DEFAULT_PACKET_TTL,
    }
    state = api.result("get_simulation_state")
    assert state["forwarding_policy"]["algorithm"] == "bellman_ford"
    # Hyphenated spelling is normalised like the engine does.
    policy2 = api.result("set_forwarding_policy", {"algorithm": "Bellman-Ford", "metricType": "hop_count"})
    assert policy2["algorithm"] == "bellman_ford"
    api.result("set_forwarding_policy", {"algorithm": "dijkstra", "metricType": "hop_count"})


def test_live_delivery_is_identical_under_both_forwarding_algorithms(api):
    """The same packet is delivered by the same path whichever algorithm governs forwarding."""
    outcomes = {}
    for algorithm in ("dijkstra", "bellman_ford"):
        api.result("create_project", {"name": f"algo-{algorithm}"})
        api.result("set_forwarding_policy", {"algorithm": algorithm, "metricType": "hop_count"})
        api.result("inject_packet", {"srcNodeId": "node-1", "dstNodeId": "node-3", "sizeBytes": 512})
        api.result("run_simulation_until_empty")
        state = api.result("get_simulation_state")
        metrics = state["metrics"]
        outcomes[algorithm] = {
            "delivered": metrics["packets_delivered"],
            "drops": sum(metrics[k] for k in metrics if k.startswith("packets_dropped")),
        }
        api.result("set_forwarding_policy", {"algorithm": "dijkstra", "metricType": "hop_count"})
    assert outcomes["dijkstra"]["delivered"] == 1
    assert outcomes["bellman_ford"] == outcomes["dijkstra"]
