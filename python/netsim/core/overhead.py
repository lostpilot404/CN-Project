"""Protocol-overhead accounting for the throughput / goodput definitions.

NetSim reports two distinct rates:

* **Throughput** — the gross bit rate at a model's documented measurement boundary:
  every wire bit (protocol headers *and* payload) that crosses the boundary, including
  retransmitted copies where the model produces them.
* **Goodput** — the net useful bit rate: unique, successfully delivered application
  payload bits, excluding protocol headers and retransmitted or duplicate payload.

This module holds the single source of truth for the header sizes the overhead
accounting uses. The model is deliberately minimal and educational:

====================  ==========================  =========================
Header                Size                        Where it is applied
====================  ==========================  =========================
IPv4                  20 bytes                    every packet / segment
TCP                   20 bytes                    TCP segments
UDP                   8 bytes                     UDP datagrams
====================  ==========================  =========================

Documented simplifications:

* No IPv4 options, no TCP options (timestamps, SACK, window scaling): a fixed
  20-byte header for each.
* The packet engine counts one network + transport header per packet on delivery.
  The transport models count one network + transport header per data segment
  *transmission attempt* (initial sends and retransmissions).
* Pure ACK segments are modelled in the TCP timeline (their propagation cost is
  simulated) but are **not** counted in the wire-byte totals; acknowledging this
  simplification keeps the arithmetic auditable.
* Data-link framing (preamble, MAC header, FCS) is below the measurement boundary
  and is not counted; the boundary is the network/transport layer.

The numbers here only affect QoS accounting; they never change simulated timing.
"""

from __future__ import annotations

IPV4_HEADER_BYTES = 20
TCP_HEADER_BYTES = 20
UDP_HEADER_BYTES = 8

_KNOWN_TRANSPORT_HEADERS = {
    "TCP": TCP_HEADER_BYTES,
    "UDP": UDP_HEADER_BYTES,
}


def transport_header_bytes(transport_protocol: str) -> int:
    """Header bytes for the transport protocol; unknown protocols count as TCP-sized."""
    return _KNOWN_TRANSPORT_HEADERS.get(transport_protocol.upper(), TCP_HEADER_BYTES)


def packet_overhead_bytes(transport_protocol: str) -> int:
    """Network + transport header bytes carried by one packet of ``transport_protocol``."""
    return IPV4_HEADER_BYTES + transport_header_bytes(transport_protocol)


def payload_bytes_for(size_bytes: int, transport_protocol: str) -> int:
    """Useful payload bytes inside a total on-the-wire packet of ``size_bytes``.

    Never negative: a packet smaller than its headers is all overhead.
    """
    return max(0, int(size_bytes) - packet_overhead_bytes(transport_protocol))
