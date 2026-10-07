"""Topology undo/redo history manager."""

from dataclasses import dataclass
from typing import Any

from .project import Project


@dataclass
class HistoryStatus:
    can_undo: bool
    can_redo: bool
    undo_count: int
    redo_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "can_undo": self.can_undo,
            "can_redo": self.can_redo,
            "undo_count": self.undo_count,
            "redo_count": self.redo_count,
        }


class TopologyHistory:
    def __init__(self, max_depth: int = 50):
        self.undo_stack: list[dict[str, Any]] = []
        self.redo_stack: list[dict[str, Any]] = []
        self.max_depth = max(1, max_depth)

    def push_undo(self, current: Project) -> None:
        self.undo_stack.append(current.to_dict())
        if len(self.undo_stack) > self.max_depth:
            self.undo_stack.pop(0)
        self.redo_stack.clear()

    def undo(self, current: Project) -> Project | None:
        if not self.undo_stack:
            return None
        prev_data = self.undo_stack.pop()
        self.redo_stack.append(current.to_dict())
        return Project.from_dict(prev_data)

    def redo(self, current: Project) -> Project | None:
        if not self.redo_stack:
            return None
        next_data = self.redo_stack.pop()
        self.undo_stack.append(current.to_dict())
        return Project.from_dict(next_data)

    def can_undo(self) -> bool:
        return len(self.undo_stack) > 0

    def can_redo(self) -> bool:
        return len(self.redo_stack) > 0

    def get_status(self) -> HistoryStatus:
        return HistoryStatus(
            can_undo=self.can_undo(),
            can_redo=self.can_redo(),
            undo_count=len(self.undo_stack),
            redo_count=len(self.redo_stack),
        )

    def clear(self) -> None:
        self.undo_stack.clear()
        self.redo_stack.clear()
