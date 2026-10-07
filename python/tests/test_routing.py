from netsim.models.link import Link, LinkEndpoint
from netsim.models.node import Node, NodeType
from netsim.models.project import Project
from netsim.routing.bellman_ford import compute_bellman_ford_shortest_paths
from netsim.routing.dijkstra import compute_dijkstra_shortest_paths
from netsim.routing.graph import MetricType, RoutingGraph


def test_dijkstra_and_bellman_ford_parity():
    n1 = Node.create("n1", "Node 1", NodeType.ROUTER, 0.0, 0.0)
    n2 = Node.create("n2", "Node 2", NodeType.ROUTER, 100.0, 0.0)
    n3 = Node.create("n3", "Node 3", NodeType.ROUTER, 200.0, 0.0)

    l12 = Link(
        "l12", LinkEndpoint("n1", n1.interfaces[0].id), LinkEndpoint("n2", n2.interfaces[0].id), 10_000_000, 5_000
    )
    l23 = Link(
        "l23", LinkEndpoint("n2", n2.interfaces[1].id), LinkEndpoint("n3", n3.interfaces[0].id), 10_000_000, 5_000
    )
    l13 = Link(
        "l13", LinkEndpoint("n1", n1.interfaces[1].id), LinkEndpoint("n3", n3.interfaces[1].id), 10_000_000, 20_000
    )

    proj = Project.create("Topo", [n1, n2, n3], [l12, l23, l13])
    graph = RoutingGraph.from_project(proj, MetricType.PROPAGATION_DELAY)

    dijkstra_table = compute_dijkstra_shortest_paths(graph, "n1")
    bf_table = compute_bellman_ford_shortest_paths(graph, "n1")

    # Route to n3: path via n2 has delay 10ms (5+5), direct path has 20ms
    d_route = dijkstra_table.find_route("n3")
    bf_route = bf_table.find_route("n3")
    assert d_route is not None
    assert bf_route is not None
    assert d_route.cost == 10_000
    assert bf_route.cost == 10_000
    assert d_route.next_hop_node_id == "n2"
    assert bf_route.next_hop_node_id == "n2"
