"""Network Address Translation (NAT/NAPT) model and translation logic."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any


class NatProtocol(str, Enum):
    TCP = "TCP"
    UDP = "UDP"
    ICMP = "ICMP"


class NatMappingType(str, Enum):
    DYNAMIC_SNAT = "dynamic_snat"
    STATIC_DNAT = "static_dnat"


@dataclass
class NatEntry:
    id: str
    protocol: NatProtocol
    private_ip: str
    private_port: int
    public_ip: str
    public_port: int
    mapping_type: NatMappingType
    created_at_us: int
    last_used_at_us: int
    timeout_us: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "protocol": self.protocol.value,
            "private_ip": self.private_ip,
            "private_port": self.private_port,
            "public_ip": self.public_ip,
            "public_port": self.public_port,
            "mapping_type": self.mapping_type.value,
            "created_at_us": self.created_at_us,
            "last_used_at_us": self.last_used_at_us,
            "timeout_us": self.timeout_us,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> NatEntry:
        return cls(
            id=data["id"],
            protocol=NatProtocol(data["protocol"]),
            private_ip=data["private_ip"],
            private_port=int(data["private_port"]),
            public_ip=data["public_ip"],
            public_port=int(data["public_port"]),
            mapping_type=NatMappingType(data["mapping_type"]),
            created_at_us=int(data["created_at_us"]),
            last_used_at_us=int(data["last_used_at_us"]),
            timeout_us=int(data["timeout_us"]),
        )


@dataclass
class StaticDnatRule:
    id: str
    protocol: NatProtocol
    public_port: int
    private_ip: str
    private_port: int
    description: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "protocol": self.protocol.value,
            "public_port": self.public_port,
            "private_ip": self.private_ip,
            "private_port": self.private_port,
            "description": self.description,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> StaticDnatRule:
        return cls(
            id=data["id"],
            protocol=NatProtocol(data["protocol"]),
            public_port=int(data["public_port"]),
            private_ip=data["private_ip"],
            private_port=int(data["private_port"]),
            description=data.get("description", ""),
        )


@dataclass
class NatTranslationResult:
    original_src_ip: str
    original_src_port: int
    original_dst_ip: str
    original_dst_port: int
    translated_src_ip: str
    translated_src_port: int
    translated_dst_ip: str
    translated_dst_port: int
    entry: NatEntry
    created_new_mapping: bool
    direction: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "original_src_ip": self.original_src_ip,
            "original_src_port": self.original_src_port,
            "original_dst_ip": self.original_dst_ip,
            "original_dst_port": self.original_dst_port,
            "translated_src_ip": self.translated_src_ip,
            "translated_src_port": self.translated_src_port,
            "translated_dst_ip": self.translated_dst_ip,
            "translated_dst_port": self.translated_dst_port,
            "entry": self.entry.to_dict(),
            "created_new_mapping": self.created_new_mapping,
            "direction": self.direction,
        }


class NatTable:
    def __init__(self, router_node_id: str, public_ip: str):
        self.router_node_id = router_node_id
        self.public_ip = public_ip
        self.port_range_start = 49152
        self.port_range_end = 65535
        self.next_dynamic_port = 49152
        self.entries: list[NatEntry] = []
        self.static_rules: list[StaticDnatRule] = []
        self.next_entry_id = 1

    def add_static_dnat_rule(
        self,
        protocol: NatProtocol,
        public_port: int,
        private_ip: str,
        private_port: int,
        description: str,
    ) -> None:
        for r in self.static_rules:
            if r.protocol == protocol and r.public_port == public_port:
                raise ValueError(f"Static DNAT port collision: port {public_port} already mapped for {protocol.value}")

        rule_id = f"dnat-rule-{len(self.static_rules) + 1}"
        self.static_rules.append(
            StaticDnatRule(
                id=rule_id,
                protocol=protocol,
                public_port=public_port,
                private_ip=private_ip,
                private_port=private_port,
                description=description,
            )
        )

    def expire_entries(self, current_time_us: int) -> None:
        survivors = []
        for e in self.entries:
            if e.mapping_type == NatMappingType.STATIC_DNAT:
                survivors.append(e)
            else:
                elapsed = max(0, current_time_us - e.last_used_at_us)
                if elapsed <= e.timeout_us:
                    survivors.append(e)
        self.entries = survivors

    def allocate_dynamic_port(self, protocol: NatProtocol) -> int:
        total_ports = self.port_range_end - self.port_range_start + 1
        for _ in range(total_ports):
            port = self.next_dynamic_port
            if self.next_dynamic_port >= self.port_range_end:
                self.next_dynamic_port = self.port_range_start
            else:
                self.next_dynamic_port += 1

            if any(r.protocol == protocol and r.public_port == port for r in self.static_rules):
                continue
            if any(e.protocol == protocol and e.public_port == port for e in self.entries):
                continue

            return port

        raise ValueError("NAT dynamic port pool exhausted (no available ports)")

    def translate_outbound(
        self,
        src_ip: str,
        src_port: int,
        dst_ip: str,
        dst_port: int,
        protocol: NatProtocol,
        current_time_us: int,
    ) -> NatTranslationResult:
        self.expire_entries(current_time_us)

        for entry in self.entries:
            if entry.protocol == protocol and entry.private_ip == src_ip and entry.private_port == src_port:
                entry.last_used_at_us = current_time_us
                return NatTranslationResult(
                    original_src_ip=src_ip,
                    original_src_port=src_port,
                    original_dst_ip=dst_ip,
                    original_dst_port=dst_port,
                    translated_src_ip=entry.public_ip,
                    translated_src_port=entry.public_port,
                    translated_dst_ip=dst_ip,
                    translated_dst_port=dst_port,
                    entry=entry,
                    created_new_mapping=False,
                    direction="outbound (SNAT)",
                )

        public_port = self.allocate_dynamic_port(protocol)
        if protocol == NatProtocol.TCP:
            timeout_us = 7_200_000_000
        elif protocol == NatProtocol.UDP:
            timeout_us = 300_000_000
        else:
            timeout_us = 30_000_000

        entry_id = f"nat-{self.next_entry_id}"
        self.next_entry_id += 1

        entry = NatEntry(
            id=entry_id,
            protocol=protocol,
            private_ip=src_ip,
            private_port=src_port,
            public_ip=self.public_ip,
            public_port=public_port,
            mapping_type=NatMappingType.DYNAMIC_SNAT,
            created_at_us=current_time_us,
            last_used_at_us=current_time_us,
            timeout_us=timeout_us,
        )
        self.entries.append(entry)

        return NatTranslationResult(
            original_src_ip=src_ip,
            original_src_port=src_port,
            original_dst_ip=dst_ip,
            original_dst_port=dst_port,
            translated_src_ip=entry.public_ip,
            translated_src_port=entry.public_port,
            translated_dst_ip=dst_ip,
            translated_dst_port=dst_port,
            entry=entry,
            created_new_mapping=True,
            direction="outbound (SNAT)",
        )

    def translate_inbound(
        self,
        src_ip: str,
        src_port: int,
        dst_ip: str,
        dst_port: int,
        protocol: NatProtocol,
        current_time_us: int,
    ) -> NatTranslationResult:
        self.expire_entries(current_time_us)

        # 1. Check static DNAT rules
        for rule in self.static_rules:
            if rule.protocol == protocol and rule.public_port == dst_port:
                entry = NatEntry(
                    id=f"static-{rule.id}",
                    protocol=protocol,
                    private_ip=rule.private_ip,
                    private_port=rule.private_port,
                    public_ip=dst_ip,
                    public_port=dst_port,
                    mapping_type=NatMappingType.STATIC_DNAT,
                    created_at_us=0,
                    last_used_at_us=current_time_us,
                    timeout_us=2**64 - 1,
                )
                return NatTranslationResult(
                    original_src_ip=src_ip,
                    original_src_port=src_port,
                    original_dst_ip=dst_ip,
                    original_dst_port=dst_port,
                    translated_src_ip=src_ip,
                    translated_src_port=src_port,
                    translated_dst_ip=rule.private_ip,
                    translated_dst_port=rule.private_port,
                    entry=entry,
                    created_new_mapping=False,
                    direction="inbound (Static DNAT)",
                )

        # 2. Check dynamic SNAT table for reverse match
        for entry in self.entries:
            if (
                entry.protocol == protocol
                and entry.public_port == dst_port
                and (entry.public_ip == dst_ip or dst_ip == "0.0.0.0")
            ):
                entry.last_used_at_us = current_time_us
                return NatTranslationResult(
                    original_src_ip=src_ip,
                    original_src_port=src_port,
                    original_dst_ip=dst_ip,
                    original_dst_port=dst_port,
                    translated_src_ip=src_ip,
                    translated_src_port=src_port,
                    translated_dst_ip=entry.private_ip,
                    translated_dst_port=entry.private_port,
                    entry=entry,
                    created_new_mapping=False,
                    direction="inbound (Dynamic Reverse NAPT)",
                )

        raise ValueError(
            f"Inbound NAT translation rejected: no matching entry or static rule for {dst_ip}:{dst_port} ({protocol.value})"
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "router_node_id": self.router_node_id,
            "public_ip": self.public_ip,
            "port_range_start": self.port_range_start,
            "port_range_end": self.port_range_end,
            "next_dynamic_port": self.next_dynamic_port,
            "entries": [e.to_dict() for e in self.entries],
            "static_rules": [r.to_dict() for r in self.static_rules],
            "next_entry_id": self.next_entry_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> NatTable:
        table = cls(
            router_node_id=data["router_node_id"],
            public_ip=data["public_ip"],
        )
        table.port_range_start = int(data.get("port_range_start", 49152))
        table.port_range_end = int(data.get("port_range_end", 65535))
        table.next_dynamic_port = int(data.get("next_dynamic_port", 49152))
        table.next_entry_id = int(data.get("next_entry_id", 1))
        table.entries = [NatEntry.from_dict(e) for e in data.get("entries", [])]
        table.static_rules = [StaticDnatRule.from_dict(r) for r in data.get("static_rules", [])]
        return table
