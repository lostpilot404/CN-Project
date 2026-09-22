use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum NetSimError {
    #[error("Invalid topology: {0}")]
    InvalidTopology(String),

    #[error("Node not found: {0}")]
    NodeNotFound(String),

    #[error("Link not found: {0}")]
    LinkNotFound(String),

    #[error("Duplicate ID: {0}")]
    DuplicateId(String),

    #[error("Invalid connection: {0}")]
    InvalidConnection(String),

    #[error("Invalid property: {0}")]
    InvalidProperty(String),

    #[error("Simulation error: {0}")]
    SimulationError(String),

    #[error("Addressing error: {0}")]
    AddressingError(String),

    #[error("Algorithm error: {0}")]
    AlgorithmError(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfiguration(String),

    #[error("Route unreachable: {0}")]
    RouteUnreachable(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Project persistence error: {0}")]
    PersistenceError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("JSON serialization error: {0}")]
    JsonError(#[from] serde_json::Error),
}

impl Serialize for NetSimError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, NetSimError>;
