"""Independent algorithm validation.

Every expected value in this module was derived by hand (or from an independent implementation
written from the algorithm definition in the textbook/RFC) *before* running the code under test.
The tests therefore validate the implementation rather than restating it.
"""

from __future__ import annotations

import ipaddress

import pytest
from netsim.addressing.ipv4 import calculate_subnet, split_equal_subnets
from netsim.addressing.vlsm import VlsmSubnetRequirement, allocate_vlsm
from netsim.models.link import Link, LinkEndpoint, LinkStatus
from netsim.models.node import Node, NodeType
from netsim.models.project import Project
from netsim.routing.bellman_ford import compute_bellman_ford_shortest_paths
from netsim.routing.dijkstra import compute_dijkstra_shortest_paths
from netsim.routing.graph import MetricType, RoutingGraph


def _project(node_ids: list[str], links: list[tuple[str, str, int, int]]) -> Project:
    nodes = [Node.create(nid, nid, NodeType.ROUTER) for nid in node_ids]
    for node in nodes:
        for iface in node.interfaces:
            iface.link_id = None
    built: list[Link] = []
    for index, (a, b, delay, bandwidth) in enumerate(links, start=1):
        link_id = f"link-{index}"
        node_a = next(n for n in nodes if n.id == a)
        node_b = next(n for n in nodes if n.id == b)
        iface_a = next(i for i in node_a.interfaces if i.link_id is None)
        iface_b = next(i for i in node_b.interfaces if i.link_id is None)
        iface_a.link_id = link_id
        iface_b.link_id = link_id
        built.append(
            Link(
                id=link_id,
                source=LinkEndpoint(node_id=a, interface_id=iface_a.id),
                target=LinkEndpoint(node_id=b, interface_id=iface_b.id),
                bandwidth_bps=bandwidth,
                propagation_delay_us=delay,
                status=LinkStatus.UP,
            )
        )
    return Project(nodes=nodes, links=built)


# A--D direct: 100 us / 1 Mbps.  A-B, B-C, C-D: 10 us each / 1 Mbps.
TOPOLOGY = _project(
    ["A", "B", "C", "D"],
    [
        ("A", "B", 10, 1_000_000),
        ("B", "C", 10, 1_000_000),
        ("C", "D", 10, 1_000_000),
        ("A", "D", 100, 1_000_000),
    ],
)


@pytest.mark.parametrize("algorithm", [compute_dijkstra_shortest_paths, compute_bellman_ford_shortest_paths])
def test_hop_count_metric_prefers_the_direct_link(algorithm):
    """Hand calc: A->D is 1 hop directly, 3 hops via B and C."""
    table = algorithm(RoutingGraph.from_project(TOPOLOGY, MetricType.HOP_COUNT), "A")
    routes = {entry.destination: (entry.next_hop, entry.metric) for entry in table.entries}
    assert routes["D"] == ("D", 1)
    assert routes["B"] == ("B", 1)
    assert routes["C"] == ("B", 2)


@pytest.mark.parametrize("algorithm", [compute_dijkstra_shortest_paths, compute_bellman_ford_shortest_paths])
def test_propagation_delay_metric_avoids_the_slow_direct_link(algorithm):
    """Hand calc: A->D costs 100 us directly but 10+10+10 = 30 us via B and C."""
    table = algorithm(RoutingGraph.from_project(TOPOLOGY, MetricType.PROPAGATION_DELAY), "A")
    routes = {entry.destination: (entry.next_hop, entry.metric) for entry in table.entries}
    assert routes["D"] == ("B", 30)
    assert routes["C"] == ("B", 20)
    entry_d = next(e for e in table.entries if e.destination == "D")
    assert entry_d.path == ["A", "B", "C", "D"]


def test_inverse_bandwidth_metric_matches_the_formula():
    """Hand calc: 1 Mbps link costs ceil(1e9 / 1e6) = 1000 units."""
    table = compute_dijkstra_shortest_paths(RoutingGraph.from_project(TOPOLOGY, MetricType.INVERSE_BANDWIDTH), "A")
    routes = {entry.destination: (entry.next_hop, entry.metric) for entry in table.entries}
    assert routes["D"] == ("D", 1000)


def test_dijkstra_prefers_two_fast_hops_over_one_slow_hop():
    """Hand calc: 100 kbps direct costs 10000; two 10 Mbps hops cost 100 + 100 = 200."""
    project = _project(
        ["A", "B", "D"],
        [("A", "D", 10, 100_000), ("A", "B", 10, 10_000_000), ("B", "D", 10, 10_000_000)],
    )
    slow = compute_dijkstra_shortest_paths(RoutingGraph.from_project(project, MetricType.INVERSE_BANDWIDTH), "A")
    fast = compute_dijkstra_shortest_paths(RoutingGraph.from_project(project, MetricType.HOP_COUNT), "A")
    assert {e.destination: (e.next_hop, e.metric) for e in slow.entries}["D"] == ("B", 200)
    assert {e.destination: (e.next_hop, e.metric) for e in fast.entries}["D"] == ("D", 1)


def test_dijkstra_and_bellman_ford_agree_on_every_destination():
    """Two independent algorithms must produce identical costs on the same graph."""
    dijkstra = compute_dijkstra_shortest_paths(RoutingGraph.from_project(TOPOLOGY, MetricType.PROPAGATION_DELAY), "A")
    bellman = compute_bellman_ford_shortest_paths(
        RoutingGraph.from_project(TOPOLOGY, MetricType.PROPAGATION_DELAY), "A"
    )
    assert {e.destination: e.metric for e in dijkstra.entries} == {e.destination: e.metric for e in bellman.entries}


@pytest.mark.parametrize(
    ("cidr", "network", "broadcast", "total", "usable", "first", "last"),
    [
        ("192.168.1.130/26", "192.168.1.128", "192.168.1.191", 64, 62, "192.168.1.129", "192.168.1.190"),
        ("10.0.0.5/30", "10.0.0.4", "10.0.0.7", 4, 2, "10.0.0.5", "10.0.0.6"),
        ("172.16.5.9/24", "172.16.5.0", "172.16.5.255", 256, 254, "172.16.5.1", "172.16.5.254"),
    ],
)
def test_ipv4_subnet_math_matches_hand_calculations(cidr, network, broadcast, total, usable, first, last):
    info = calculate_subnet(cidr).to_dict()
    assert info["network_address"] == network
    assert info["broadcast_address"] == broadcast
    assert info["total_hosts"] == total
    assert info["usable_hosts"] == usable
    assert info["first_usable_ip"] == first
    assert info["last_usable_ip"] == last


def test_ipv4_edge_prefix_lengths():
    """/31 keeps both addresses usable (RFC 3021); /32 is a host route."""
    assert calculate_subnet("10.0.0.0/31").to_dict()["usable_hosts"] == 2
    assert calculate_subnet("10.0.0.7/32").to_dict()["usable_hosts"] == 1
    assert calculate_subnet("0.0.0.0/0").to_dict()["total_hosts"] == 2**32


def test_equal_subnet_split_produces_contiguous_blocks():
    """Hand calc: /24 -> /26 is 2^(26-24) = 4 blocks of 64 addresses (62 usable)."""
    result = split_equal_subnets("192.168.10.0/24", 26).to_dict()
    assert result["subnets_count"] == 4
    assert [s["network_address"] for s in result["subnets"]] == [
        "192.168.10.0",
        "192.168.10.64",
        "192.168.10.128",
        "192.168.10.192",
    ]
    assert {s["usable_hosts"] for s in result["subnets"]} == {62}


def test_vlsm_allocates_largest_first_without_overlap():
    """Hand calc: /24 holds one /25 (126 usable), one /26 (62) and one /30 (2)."""
    result = allocate_vlsm(
        "192.168.20.0/24",
        [
            VlsmSubnetRequirement(name="WAN", needed_hosts=2),
            VlsmSubnetRequirement(name="Sales", needed_hosts=100),
            VlsmSubnetRequirement(name="Eng", needed_hosts=50),
        ],
    ).to_dict()
    allocated = {a["name"]: a for a in result["subnets"]}
    assert allocated["Sales"]["allocated_prefix"] == 25
    assert allocated["Sales"]["subnet_info"]["network_address"] == "192.168.20.0"
    assert allocated["Eng"]["allocated_prefix"] == 26
    assert allocated["Eng"]["subnet_info"]["network_address"] == "192.168.20.128"
    assert allocated["WAN"]["allocated_prefix"] == 30
    assert allocated["WAN"]["subnet_info"]["network_address"] == "192.168.20.192"

    base = ipaddress.ip_network("192.168.20.0/24")
    blocks = [
        ipaddress.ip_network(f"{a['subnet_info']['network_address']}/{a['allocated_prefix']}")
        for a in result["subnets"]
    ]
    assert all(block.subnet_of(base) for block in blocks)
    for index, block in enumerate(blocks):
        for other in blocks[index + 1 :]:
            assert not block.overlaps(other)
