pub mod checksum;
pub mod crc;
pub mod flow_control;
pub mod hamming;
pub mod mac;

pub use checksum::{
    calculate_internet_checksum, parse_bytes_to_16bit_words, parse_hex_to_16bit_words,
    verify_internet_checksum, ChecksumAdditionStep, ChecksumCalculationResult,
    ChecksumVerifyResult,
};
pub use crc::{
    calculate_crc, inject_bit_errors, perform_modulo2_division, validate_binary_string,
    validate_generator_polynomial, verify_crc, CrcCalculationResult, CrcStep, CrcVerifyResult,
    CRC16_CCITT_POLY, CRC16_IBM_POLY, CRC32_IEEE_POLY, CRC8_DEFAULT_POLY,
};
pub use flow_control::{
    circular_distance, get_window_sequences, is_in_circular_window, simulate_flow_control,
    simulate_go_back_n, simulate_selective_repeat, simulate_sliding_window,
    validate_flow_control_config, FlowControlConfig, FlowControlEvent, FlowControlMetrics,
    FlowControlProtocol, FlowControlSimResult, FlowEventType, FrameStatus, ReceiverWindowState,
    SenderWindowState, SlidingFrame,
};
pub use hamming::{
    calculate_required_parity_bits, encode_hamming, is_power_of_two, verify_and_correct_hamming,
    HammingBitInfo, HammingEncodeResult, HammingVerifyResult, ParityBitDetail, ParityMode,
};
pub use mac::{
    simulate_csma, simulate_csma_cd, simulate_pure_aloha, simulate_slotted_aloha, ChannelState,
    CsmaPersistence, MacConfig, MacEvent, MacEventType, MacMetrics, MacProtocol, MacSimResult,
    SlotRecord,
};
