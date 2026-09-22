pub mod checksum;
pub mod crc;
pub mod hamming;

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
pub use hamming::{
    calculate_required_parity_bits, encode_hamming, is_power_of_two, verify_and_correct_hamming,
    HammingBitInfo, HammingEncodeResult, HammingVerifyResult, ParityBitDetail, ParityMode,
};
