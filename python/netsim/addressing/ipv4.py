"""IPv4 subnetting, CIDR parsing, address classification and duplicate detection."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from typing import Any

from ..models.project import Project


@dataclass
class Ipv4SubnetInfo:
    input: str
    ip_address: str
    prefix_length: int
    subnet_mask: str
    wildcard_mask: str
    network_address: str
    broadcast_address: str
    first_usable_ip: str
    last_usable_ip: str
    total_hosts: int
    usable_hosts: int
    ip_binary: str
    mask_binary: str
    ip_class: str
    scope: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "input": self.input,
            "ip_address": self.ip_address,
            "prefix_length": self.prefix_length,
            "subnet_mask": self.subnet_mask,
            "wildcard_mask": self.wildcard_mask,
            "network_address": self.network_address,
            "broadcast_address": self.broadcast_address,
            "first_usable_ip": self.first_usable_ip,
            "last_usable_ip": self.last_usable_ip,
            "total_hosts": self.total_hosts,
            "usable_hosts": self.usable_hosts,
            "ip_binary": self.ip_binary,
            "mask_binary": self.mask_binary,
            "ip_class": self.ip_class,
            "scope": self.scope,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Ipv4SubnetInfo:
        return cls(
            input=data.get("input", ""),
            ip_address=data["ip_address"],
            prefix_length=int(data["prefix_length"]),
            subnet_mask=data["subnet_mask"],
            wildcard_mask=data["wildcard_mask"],
            network_address=data["network_address"],
            broadcast_address=data["broadcast_address"],
            first_usable_ip=data["first_usable_ip"],
            last_usable_ip=data["last_usable_ip"],
            total_hosts=int(data["total_hosts"]),
            usable_hosts=int(data["usable_hosts"]),
            ip_binary=data["ip_binary"],
            mask_binary=data["mask_binary"],
            ip_class=data["ip_class"],
            scope=data["scope"],
        )


@dataclass
class SubnetSplitResult:
    base_cidr: str
    original_prefix: int
    new_prefix: int
    subnets_count: int
    subnets: list[Ipv4SubnetInfo]

    def to_dict(self) -> dict[str, Any]:
        return {
            "base_cidr": self.base_cidr,
            "original_prefix": self.original_prefix,
            "new_prefix": self.new_prefix,
            "subnets_count": self.subnets_count,
            "subnets": [s.to_dict() for s in self.subnets],
        }


@dataclass
class DuplicateIpOccurrence:
    node_id: str
    node_label: str
    interface_id: str
    interface_name: str

    def to_dict(self) -> dict[str, str]:
        return {
            "node_id": self.node_id,
            "node_label": self.node_label,
            "interface_id": self.interface_id,
            "interface_name": self.interface_name,
        }


@dataclass
class DuplicateIpConflict:
    ip: str
    occurrences: list[DuplicateIpOccurrence]

    def to_dict(self) -> dict[str, Any]:
        return {
            "ip": self.ip,
            "occurrences": [o.to_dict() for o in self.occurrences],
        }


def u32_to_ipv4_string(val: int) -> str:
    return f"{(val >> 24) & 0xFF}.{(val >> 16) & 0xFF}.{(val >> 8) & 0xFF}.{val & 0xFF}"


def u32_to_binary_dotted(val: int) -> str:
    return f"{(val >> 24) & 0xFF:08b}.{(val >> 16) & 0xFF:08b}.{(val >> 8) & 0xFF:08b}.{val & 0xFF:08b}"


def prefix_to_mask(prefix: int) -> int:
    if prefix <= 0:
        return 0
    if prefix >= 32:
        return 0xFFFFFFFF
    return (0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF


def mask_to_prefix(mask: int) -> int | None:
    p = 0
    seen_zero = False
    for i in range(31, -1, -1):
        bit = (mask >> i) & 1
        if bit == 1:
            if seen_zero:
                return None  # Non-contiguous mask
            p += 1
        else:
            seen_zero = True
    return p


def parse_ipv4(s: str) -> int:
    try:
        addr = ipaddress.IPv4Address(s.strip())
        return int(addr)
    except ValueError:
        raise ValueError(f"Invalid IPv4 address: '{s}'")


def parse_cidr_or_ip_mask(s: str) -> tuple[int, int]:
    s = s.strip()
    if "/" in s:
        ip_part, prefix_part = s.split("/", 1)
        ip = parse_ipv4(ip_part)
        try:
            prefix = int(prefix_part.strip())
        except ValueError:
            raise ValueError(f"Invalid prefix length: '{prefix_part}'")
        if not (0 <= prefix <= 32):
            raise ValueError(f"Prefix length {prefix} must be between 0 and 32")
        return (ip, prefix)
    elif " " in s:
        ip_part, mask_part = s.split(" ", 1)
        ip = parse_ipv4(ip_part)
        mask = parse_ipv4(mask_part)
        prefix = mask_to_prefix(mask)
        if prefix is None:
            raise ValueError(f"Non-contiguous subnet mask: '{mask_part}'")
        return (ip, prefix)
    else:
        ip = parse_ipv4(s)
        return (ip, 32)


def classify_ip(ip_u32: int) -> tuple[str, str]:
    first_octet = (ip_u32 >> 24) & 0xFF
    if first_octet < 128:
        ip_class = "Class A"
    elif first_octet < 192:
        ip_class = "Class B"
    elif first_octet < 224:
        ip_class = "Class C"
    elif first_octet < 240:
        ip_class = "Class D (Multicast)"
    else:
        ip_class = "Class E (Experimental)"

    octet1 = first_octet
    octet2 = (ip_u32 >> 16) & 0xFF

    if octet1 == 127:
        scope = "Loopback (127.0.0.0/8)"
    elif octet1 == 10:
        scope = "Private (RFC 1918 10.0.0.0/8)"
    elif octet1 == 172 and (16 <= octet2 <= 31):
        scope = "Private (RFC 1918 172.16.0.0/12)"
    elif octet1 == 192 and octet2 == 168:
        scope = "Private (RFC 1918 192.168.0.0/16)"
    elif octet1 == 169 and octet2 == 254:
        scope = "Link-Local (169.254.0.0/16)"
    elif 224 <= octet1 <= 239:
        scope = "Multicast (224.0.0.0/4)"
    elif ip_u32 == 0xFFFFFFFF:
        scope = "Limited Broadcast (255.255.255.255)"
    elif ip_u32 == 0:
        scope = "Current Network / Default Route (0.0.0.0)"
    else:
        scope = "Public Internet"

    return (ip_class, scope)


def calculate_subnet(input_str: str) -> Ipv4SubnetInfo:
    ip_u32, prefix = parse_cidr_or_ip_mask(input_str)
    mask = prefix_to_mask(prefix)
    wildcard = (~mask) & 0xFFFFFFFF
    network = ip_u32 & mask
    broadcast = ip_u32 | wildcard

    total_hosts = 4_294_967_296 if prefix == 0 else (1 << (32 - prefix))

    if prefix == 32:
        usable_hosts = 1
        first_usable = network
        last_usable = network
    elif prefix == 31:
        usable_hosts = 2
        first_usable = network
        last_usable = broadcast
    elif prefix == 0:
        usable_hosts = max(0, total_hosts - 2)
        first_usable = network + 1
        last_usable = broadcast - 1
    else:
        usable_hosts = max(0, total_hosts - 2)
        first_usable = network + 1
        last_usable = broadcast - 1

    ip_class, scope = classify_ip(ip_u32)

    return Ipv4SubnetInfo(
        input=input_str,
        ip_address=u32_to_ipv4_string(ip_u32),
        prefix_length=prefix,
        subnet_mask=u32_to_ipv4_string(mask),
        wildcard_mask=u32_to_ipv4_string(wildcard),
        network_address=u32_to_ipv4_string(network),
        broadcast_address=u32_to_ipv4_string(broadcast),
        first_usable_ip=u32_to_ipv4_string(first_usable),
        last_usable_ip=u32_to_ipv4_string(last_usable),
        total_hosts=total_hosts,
        usable_hosts=usable_hosts,
        ip_binary=u32_to_binary_dotted(ip_u32),
        mask_binary=u32_to_binary_dotted(mask),
        ip_class=ip_class,
        scope=scope,
    )


def split_equal_subnets(base_cidr: str, new_prefix: int) -> SubnetSplitResult:
    base_ip, orig_prefix = parse_cidr_or_ip_mask(base_cidr)
    if new_prefix <= orig_prefix:
        raise ValueError(f"New prefix /{new_prefix} must be greater than original prefix /{orig_prefix}")
    if new_prefix > 32:
        raise ValueError("Prefix cannot exceed 32")

    orig_mask = prefix_to_mask(orig_prefix)
    base_network = base_ip & orig_mask

    delta_bits = new_prefix - orig_prefix
    num_subnets = 1 << delta_bits
    subnet_size = 1 << (32 - new_prefix)

    subnets = []
    for i in range(num_subnets):
        sub_net_u32 = base_network + (i * subnet_size)
        cidr_str = f"{u32_to_ipv4_string(sub_net_u32)}/{new_prefix}"
        info = calculate_subnet(cidr_str)
        subnets.append(info)

    return SubnetSplitResult(
        base_cidr=base_cidr,
        original_prefix=orig_prefix,
        new_prefix=new_prefix,
        subnets_count=num_subnets,
        subnets=subnets,
    )


def detect_duplicate_ips(project: Project) -> list[DuplicateIpConflict]:
    ip_map: dict[str, list[DuplicateIpOccurrence]] = {}

    for node in project.nodes:
        for iface in node.interfaces:
            if iface.ipv4:
                trimmed = iface.ipv4.strip()
                if trimmed and trimmed != "0.0.0.0":
                    clean_ip = trimmed.split("/")[0]
                    ip_map.setdefault(clean_ip, []).append(
                        DuplicateIpOccurrence(
                            node_id=node.id,
                            node_label=node.label,
                            interface_id=iface.id,
                            interface_name=iface.name,
                        )
                    )

    conflicts = [DuplicateIpConflict(ip=ip, occurrences=occs) for ip, occs in ip_map.items() if len(occs) > 1]
    conflicts.sort(key=lambda c: c.ip)
    return conflicts


calculate_ipv4_subnet = calculate_subnet
split_ipv4_subnet = split_equal_subnets
