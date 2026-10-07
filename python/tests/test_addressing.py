from netsim.addressing.ipv4 import calculate_ipv4_subnet, split_ipv4_subnet
from netsim.addressing.ipv6 import analyze_ipv6_address
from netsim.addressing.nat import NatMappingType, NatTable
from netsim.addressing.vlsm import SubnetRequirement, vlsm_allocate


def test_ipv4_subnet_calculation():
    info = calculate_ipv4_subnet("192.168.1.10/24")
    assert info.network_address == "192.168.1.0"
    assert info.broadcast_address == "192.168.1.255"
    assert info.first_usable_ip == "192.168.1.1"
    assert info.last_usable_ip == "192.168.1.254"
    assert info.usable_hosts == 254
    assert info.ip_class == "Class C"
    assert "Private" in info.scope


def test_ipv4_subnet_splitting():
    split_res = split_ipv4_subnet("192.168.1.0/24", 26)
    assert split_res.subnets_count == 4
    assert len(split_res.subnets) == 4
    assert split_res.subnets[0].network_address == "192.168.1.0"
    assert split_res.subnets[1].network_address == "192.168.1.64"


def test_ipv6_address_analysis():
    info = analyze_ipv6_address("2001:0db8:0000:0000:0000:0000:0000:0001/64")
    assert info.canonical_address == "2001:db8::1"
    assert info.is_valid is True
    assert "Documentation" in info.scope


def test_vlsm():
    reqs = [
        SubnetRequirement("Dept A", 50),
        SubnetRequirement("Dept B", 20),
        SubnetRequirement("WAN", 2),
    ]
    allocs = vlsm_allocate("192.168.0.0/24", reqs)
    assert len(allocs.subnets) == 3
    assert allocs.subnets[0].allocated_prefix <= 26
    assert allocs.subnets[1].allocated_prefix <= 27
    assert allocs.subnets[2].allocated_prefix == 30


def test_nat_table():
    from netsim.addressing.nat import NatProtocol

    nat = NatTable("nat-r1", "203.0.113.1")
    res = nat.translate_outbound("192.168.1.10", 12345, "93.184.216.34", 80, NatProtocol.TCP, 0)
    assert res.translated_src_ip == "203.0.113.1"
    assert res.entry.mapping_type == NatMappingType.DYNAMIC_SNAT
    inbound = nat.translate_inbound("93.184.216.34", 80, "203.0.113.1", res.translated_src_port, NatProtocol.TCP, 1000)
    assert inbound is not None
    assert inbound.translated_dst_ip == "192.168.1.10"
    assert inbound.translated_dst_port == 12345
