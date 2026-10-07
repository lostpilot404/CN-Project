"""Project container model representing topology, configuration and metadata."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .link import Link
from .node import Node


@dataclass
class ProjectMetadata:
    name: str
    description: str = "NetSim Network Simulation Project"
    created_at: str = ""
    updated_at: str = ""
    author: str = "NetSim User"

    def __post_init__(self) -> None:
        now_str = datetime.now(UTC).isoformat()
        if not self.created_at:
            self.created_at = now_str
        if not self.updated_at:
            self.updated_at = now_str

    def to_dict(self) -> dict[str, str]:
        return {
            "name": self.name,
            "description": self.description,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "author": self.author,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ProjectMetadata:
        return cls(
            name=data.get("name", "Default NetSim Topology"),
            description=data.get("description", "NetSim Network Simulation Project"),
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
            author=data.get("author", "NetSim User"),
        )


@dataclass
class SimulationConfig:
    seed: int = 42891
    max_simulation_time_us: int = 10_000_000
    default_bandwidth_bps: int = 10_000_000
    default_propagation_delay_us: int = 10_000

    def to_dict(self) -> dict[str, int]:
        return {
            "seed": self.seed,
            "max_simulation_time_us": self.max_simulation_time_us,
            "default_bandwidth_bps": self.default_bandwidth_bps,
            "default_propagation_delay_us": self.default_propagation_delay_us,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SimulationConfig:
        return cls(
            seed=int(data.get("seed", 42891)),
            max_simulation_time_us=int(data.get("max_simulation_time_us", 10_000_000)),
            default_bandwidth_bps=int(data.get("default_bandwidth_bps", 10_000_000)),
            default_propagation_delay_us=int(data.get("default_propagation_delay_us", 10_000)),
        )


@dataclass
class Project:
    schema_version: int = 1
    metadata: ProjectMetadata = field(default_factory=lambda: ProjectMetadata(name="Default NetSim Topology"))
    nodes: list[Node] = field(default_factory=list)
    links: list[Link] = field(default_factory=list)
    simulation_config: SimulationConfig = field(default_factory=SimulationConfig)

    @classmethod
    def new(cls, name: str = "Default NetSim Topology") -> Project:
        return cls(
            schema_version=1,
            metadata=ProjectMetadata(name=name),
            nodes=[],
            links=[],
            simulation_config=SimulationConfig(),
        )

    @classmethod
    def create(
        cls,
        name: str = "Default NetSim Topology",
        nodes: list[Node] | None = None,
        links: list[Link] | None = None,
        simulation_config: SimulationConfig | None = None,
    ) -> Project:
        return cls(
            schema_version=1,
            metadata=ProjectMetadata(name=name),
            nodes=nodes or [],
            links=links or [],
            simulation_config=simulation_config or SimulationConfig(),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "metadata": self.metadata.to_dict(),
            "nodes": [n.to_dict() for n in self.nodes],
            "links": [lnk.to_dict() for lnk in self.links],
            "simulation_config": self.simulation_config.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Project:
        schema_v = int(data.get("schemaVersion", data.get("schema_version", 1)))
        meta = ProjectMetadata.from_dict(data.get("metadata", {}))
        nodes = [Node.from_dict(n) for n in data.get("nodes", [])]
        links = [Link.from_dict(lnk) for lnk in data.get("links", [])]
        sim_cfg = SimulationConfig.from_dict(data.get("simulation_config", {}))
        return cls(
            schema_version=schema_v,
            metadata=meta,
            nodes=nodes,
            links=links,
            simulation_config=sim_cfg,
        )
