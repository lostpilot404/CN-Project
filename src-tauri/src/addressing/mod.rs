pub mod ipv4;
pub mod ipv6;
pub mod nat;
pub mod vlsm;

pub use ipv4::{
    calculate_subnet, classify_ip, detect_duplicate_ips, parse_cidr_or_ip_mask, parse_ipv4,
    split_equal_subnets, DuplicateIpConflict, DuplicateIpOccurrence, Ipv4SubnetInfo,
    SubnetSplitResult,
};
pub use ipv6::{parse_and_validate_ipv6, Ipv6Info};
pub use nat::{
    NatEntry, NatMappingType, NatProtocol, NatTable, NatTranslationResult, StaticDnatRule,
};
pub use vlsm::{allocate_vlsm, VlsmAllocatedSubnet, VlsmAllocationResult, VlsmSubnetRequirement};
