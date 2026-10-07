"""Variable Length Subnet Mask (VLSM) hierarchical allocation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .ipv4 import (
    Ipv4SubnetInfo,
    calculate_subnet,
    parse_cidr_or_ip_mask,
    prefix_to_mask,
    u32_to_ipv4_string,
)


@dataclass
class VlsmSubnetRequirement:
    name: str
    needed_hosts: int

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "needed_hosts": self.needed_hosts}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> VlsmSubnetRequirement:
        return cls(name=data["name"], needed_hosts=int(data["needed_hosts"]))


@dataclass
class VlsmAllocatedSubnet:
    name: str
    needed_hosts: int
    allocated_prefix: int
    subnet_info: Ipv4SubnetInfo
    wasted_hosts: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "needed_hosts": self.needed_hosts,
            "allocated_prefix": self.allocated_prefix,
            "subnet_info": self.subnet_info.to_dict(),
            "wasted_hosts": self.wasted_hosts,
        }


@dataclass
class VlsmAllocationResult:
    base_cidr: str
    base_network: str
    base_prefix: int
    total_base_hosts: int
    total_needed_hosts: int
    total_allocated_hosts: int
    total_wasted_hosts: int
    utilization_percent: float
    subnets: list[VlsmAllocatedSubnet]
    free_address_space: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "base_cidr": self.base_cidr,
            "base_network": self.base_network,
            "base_prefix": self.base_prefix,
            "total_base_hosts": self.total_base_hosts,
            "total_needed_hosts": self.total_needed_hosts,
            "total_allocated_hosts": self.total_allocated_hosts,
            "total_wasted_hosts": self.total_wasted_hosts,
            "utilization_percent": self.utilization_percent,
            "subnets": [s.to_dict() for s in self.subnets],
            "free_address_space": self.free_address_space,
        }


def allocate_vlsm(base_cidr: str, requirements: list[VlsmSubnetRequirement]) -> VlsmAllocationResult:
    if not requirements:
        raise ValueError("At least one subnet requirement is required for VLSM allocation")

    base_ip, base_prefix = parse_cidr_or_ip_mask(base_cidr)
    base_mask = prefix_to_mask(base_prefix)
    base_network_u32 = base_ip & base_mask
    total_base_capacity = 4_294_967_296 if base_prefix == 0 else (1 << (32 - base_prefix))
    base_broadcast_u32 = base_network_u32 + (total_base_capacity - 1)

    # Sort descending by needed hosts
    sorted_reqs = sorted(requirements, key=lambda r: r.needed_hosts, reverse=True)

    allocated_subnets = []
    current_ptr = base_network_u32
    total_needed = 0
    total_allocated = 0
    total_wasted = 0

    for req in sorted_reqs:
        total_needed += req.needed_hosts

        h = 2
        while h < 32:
            usable = (1 << h) - 2
            if usable >= req.needed_hosts:
                break
            h += 1

        if h > (32 - base_prefix):
            raise ValueError(
                f"Requirement '{req.name}' requires {req.needed_hosts} hosts (prefix /{32 - h}), "
                f"which exceeds base prefix /{base_prefix}"
            )

        prefix = 32 - h
        block_size = 1 << h

        # Align current_ptr
        remainder = current_ptr % block_size
        if remainder != 0:
            current_ptr += block_size - remainder

        subnet_network_u32 = current_ptr
        subnet_end = current_ptr + block_size - 1

        if subnet_end > base_broadcast_u32:
            raise ValueError(
                f"Address space exhausted! Cannot allocate {req.needed_hosts} hosts for '{req.name}' within {base_cidr}"
            )

        cidr_str = f"{u32_to_ipv4_string(subnet_network_u32)}/{prefix}"
        info = calculate_subnet(cidr_str)
        wasted = max(0, info.usable_hosts - req.needed_hosts)

        total_allocated += info.usable_hosts
        total_wasted += wasted

        allocated_subnets.append(
            VlsmAllocatedSubnet(
                name=req.name,
                needed_hosts=req.needed_hosts,
                allocated_prefix=prefix,
                subnet_info=info,
                wasted_hosts=wasted,
            )
        )

        current_ptr += block_size

    free_ranges = []
    if current_ptr <= base_broadcast_u32:
        free_start = current_ptr
        free_end = base_broadcast_u32
        free_ranges.append(
            f"{u32_to_ipv4_string(free_start)} - {u32_to_ipv4_string(free_end)} "
            f"({free_end - free_start + 1} addresses available)"
        )

    utilization = (float(total_allocated) / float(total_base_capacity)) * 100.0 if total_base_capacity > 0 else 0.0

    return VlsmAllocationResult(
        base_cidr=base_cidr,
        base_network=u32_to_ipv4_string(base_network_u32),
        base_prefix=base_prefix,
        total_base_hosts=total_base_capacity,
        total_needed_hosts=total_needed,
        total_allocated_hosts=total_allocated,
        total_wasted_hosts=total_wasted,
        utilization_percent=round(utilization, 2),
        subnets=allocated_subnets,
        free_address_space=free_ranges,
    )


SubnetRequirement = VlsmSubnetRequirement
vlsm_allocate = allocate_vlsm
