export type ParityMode = 'Even' | 'Odd';

export interface ParityBitDetail {
  parity_index: number;
  label: string;
  covered_indices: number[];
  covered_bits: number[];
  parity_value: number;
  formula: string;
}

export interface HammingBitInfo {
  position: number;
  is_parity: boolean;
  bit_value: number;
  label: string;
}

export interface HammingEncodeResult {
  raw_data_bits: string;
  data_bit_count: number;
  parity_bit_count: number;
  total_bit_count: number;
  parity_mode: ParityMode;
  encoded_bits: string;
  bit_positions: HammingBitInfo[];
  parity_details: ParityBitDetail[];
  overall_parity: number;
  encoded_bits_secded: string;
}

export interface HammingVerifyResult {
  received_bits: string;
  parity_mode: ParityMode;
  syndrome_bits: string;
  syndrome_value: number;
  has_error: boolean;
  is_correctable: boolean;
  error_type: 'none' | 'single_bit' | 'multiple_bit_unrecoverable' | string;
  error_position: number | null;
  corrected_bits: string | null;
  extracted_data_bits: string | null;
  syndrome_details: ParityBitDetail[];
  status_message: string;
}

export interface CrcStep {
  step_index: number;
  bit_position: number;
  current_window: string;
  divisor_applied: string;
  xor_result: string;
  next_bit_brought_down: string | null;
  explanation: string;
}

export interface CrcCalculationResult {
  input_bits: string;
  generator_polynomial: string;
  polynomial_name: string;
  degree: number;
  augmented_bits: string;
  remainder: string;
  transmitted_codeword: string;
  division_steps: CrcStep[];
}

export interface CrcVerifyResult {
  received_bits: string;
  generator_polynomial: string;
  polynomial_name: string;
  remainder: string;
  is_valid: boolean;
  error_detected: boolean;
  division_steps: CrcStep[];
  status_message: string;
}

export interface ChecksumAdditionStep {
  step_index: number;
  word_hex: string;
  word_value: number;
  sum_before_addition: number;
  sum_after_addition: number;
  carry_detected: number;
  sum_after_carry_fold: number;
  explanation: string;
}

export interface ChecksumCalculationResult {
  input_hex: string;
  words: number[];
  word_hex_list: string[];
  total_words: number;
  addition_steps: ChecksumAdditionStep[];
  uncomplemented_sum: number;
  checksum: number;
  checksum_hex: string;
  checksum_binary: string;
}

export interface ChecksumVerifyResult {
  payload_words: number[];
  checksum_tested: number;
  words_with_checksum: number[];
  total_accumulated_sum: number;
  inverted_result: number;
  is_valid: boolean;
  error_detected: boolean;
  verification_steps: ChecksumAdditionStep[];
  status_message: string;
}
