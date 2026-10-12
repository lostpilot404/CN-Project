"""IPv6 RFC 5952 canonical formatting, expanded representation, and scope classification."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from typing import Any


@dataclass
class Ipv6Info:
    input: str
    canonical_address: str
    expanded_address: str
    prefix_length: int
    scope: str
    is_valid: bool
    network_prefix: str
    interface_identifier: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "input": self.input,
            "canonical_address": self.canonical_address,
            "expanded_address": self.expanded_address,
            "prefix_length": self.prefix_length,
            "scope": self.scope,
            "is_valid": self.is_valid,
            "network_prefix": self.network_prefix,
            "interface_identifier": self.interface_identifier,
        }


def format_rfc5952_canonical(segs: list[int]) -> str:
    if all(s == 0 for s in segs):
        return "::"

    best_start = None
    best_len = 0
    curr_start = None
    curr_len = 0

    for i, s in enumerate(segs):
        if s == 0:
            if curr_start is None:
                curr_start = i
                curr_len = 1
            else:
                curr_len += 1
        else:
            if curr_start is not None:
                if curr_len > best_len:
                    best_start = curr_start
                    best_len = curr_len
                curr_start = None
                curr_len = 0

    if curr_start is not None:
        if curr_len > best_len:
            best_start = curr_start
            best_len = curr_len

    if best_start is not None and best_len >= 2:
        start = best_start
        end = start + best_len
        left = ":".join(f"{s:x}" for s in segs[:start])
        right = ":".join(f"{s:x}" for s in segs[end:])

        if start == 0 and end == 8:
            return "::"
        elif start == 0:
            return f"::{right}"
        elif end == 8:
            return f"{left}::"
        else:
            return f"{left}::{right}"
    else:
        return ":".join(f"{s:x}" for s in segs)


def format_expanded(segs: list[int]) -> str:
    return ":".join(f"{s:04x}" for s in segs)


def classify_ipv6_scope(segs: list[int]) -> str:
    if all(s == 0 for s in segs):
        return "Unspecified (::/128)"
    if all(s == 0 for s in segs[:7]) and segs[7] == 1:
        return "Loopback (::1/128)"

    if (segs[0] & 0xFF00) == 0xFF00:
        scope_id = segs[0] & 0x0F
        scope_name = {
            1: "Interface-Local",
            2: "Link-Local",
            4: "Admin-Local",
            5: "Site-Local",
            8: "Organization-Local",
            14: "Global",
        }.get(scope_id, f"Scope {scope_id}")
        return f"Multicast (ff00::/8 - {scope_name})"

    if (segs[0] & 0xFFC0) == 0xFE80:
        return "Link-Local Unicast (fe80::/10)"

    if (segs[0] & 0xFE00) == 0xFC00:
        return "Unique Local Address (fc00::/7 - RFC 4193)"

    if segs[0] == 0x2001 and segs[1] == 0x0DB8:
        return "Documentation Prefix (2001:db8::/32 - RFC 3849)"

    if (segs[0] & 0xE000) == 0x2000:
        return "Global Unicast (2000::/3 - Public Internet)"

    return "Reserved / Special Purpose"


def parse_ipv6_details(input_str: str) -> Ipv6Info:
    s = input_str.strip()
    prefix_length = 64
    if "/" in s:
        ip_str, prefix_str = s.split("/", 1)
        prefix_length = int(prefix_str.strip())
    else:
        ip_str = s

    addr = ipaddress.IPv6Address(ip_str.strip())
    # 8 16-bit segments
    packed = addr.packed
    segs = [(packed[i * 2] << 8) | packed[i * 2 + 1] for i in range(8)]

    canonical = format_rfc5952_canonical(segs)
    expanded = format_expanded(segs)
    scope = classify_ipv6_scope(segs)

    network_prefix = ":".join(f"{segs[i]:04x}" for i in range(4)) + "::/64"
    interface_id = ":".join(f"{segs[i]:04x}" for i in range(4, 8))

    return Ipv6Info(
        input=input_str,
        canonical_address=canonical,
        expanded_address=expanded,
        prefix_length=prefix_length,
        scope=scope,
        is_valid=True,
        network_prefix=network_prefix,
        interface_identifier=interface_id,
    )


analyze_ipv6_address = parse_ipv6_details
