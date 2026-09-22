use serde::{Deserialize, Serialize};
use std::fmt;

/// Simulation virtual time in microseconds (µs).
/// Independent from wall-clock time.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Hash, Serialize, Deserialize,
)]
pub struct SimTime(pub u64);

impl SimTime {
    pub const ZERO: Self = Self(0);

    pub fn as_micros(&self) -> u64 {
        self.0
    }

    pub fn as_millis(&self) -> f64 {
        self.0 as f64 / 1_000.0
    }

    pub fn as_secs(&self) -> f64 {
        self.0 as f64 / 1_000_000.0
    }

    pub fn from_millis(ms: u64) -> Self {
        Self(ms * 1_000)
    }

    pub fn from_micros(us: u64) -> Self {
        Self(us)
    }

    pub fn add_micros(&self, us: u64) -> Self {
        Self(self.0 + us)
    }
}

impl std::ops::Add<u64> for SimTime {
    type Output = Self;
    fn add(self, rhs: u64) -> Self::Output {
        Self(self.0 + rhs)
    }
}

impl fmt::Display for SimTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:.3} ms", self.as_millis())
    }
}
