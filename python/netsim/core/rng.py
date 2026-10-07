"""Deterministic Pseudo-Random Number Generator for simulation repeatability."""

import random


class DeterministicRng:
    def __init__(self, seed: int):
        self._seed = seed
        self._rng = random.Random(seed)

    @property
    def seed(self) -> int:
        return self._seed

    def reseed(self, seed: int) -> None:
        self._seed = seed
        self._rng = random.Random(seed)

    def gen_range_f64(self, min_val: float, max_val: float) -> float:
        return self._rng.uniform(min_val, max_val)

    def gen_bool(self, p: float) -> bool:
        clamped = max(0.0, min(1.0, float(p)))
        if clamped <= 0.0:
            return False
        if clamped >= 1.0:
            return True
        return self._rng.random() < clamped

    def gen_range_u32(self, min_val: int, max_val: int) -> int:
        return self._rng.randint(min_val, max_val)

    def gen_float(self) -> float:
        return self._rng.random()
