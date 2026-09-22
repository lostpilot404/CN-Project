import { describe, it, expect } from 'vitest';
import { api } from './lib/tauri';

describe('Phase 4B: Data Link Error Detection & Correction Integration Tests', () => {
  // ==========================================
  // HAMMING CODE TESTS
  // ==========================================
  describe('Hamming Code Engine', () => {
    it('encodes data into Hamming codeword with even parity and SECDED', async () => {
      const res = await api.calculateHammingEncode('1011', 'Even');
      expect(res).toBeDefined();
      expect(res.raw_data_bits).toBe('1011');
      expect(res.data_bit_count).toBe(4);
      expect(res.parity_bit_count).toBe(3);
      expect(res.total_bit_count).toBe(7);
      expect(res.encoded_bits).toBe('0110011');
      expect(res.bit_positions.length).toBe(7);
      expect(res.parity_details.length).toBe(3);
      expect(res.overall_parity).toBe(0);
      expect(res.encoded_bits_secded).toBe('00110011');
    });

    it('encodes data into Hamming codeword with odd parity', async () => {
      const res = await api.calculateHammingEncode('1011', 'Odd');
      expect(res).toBeDefined();
      expect(res.encoded_bits).toBe('1011011');
      expect(res.parity_mode).toBe('Odd');
    });

    it('verifies clean Hamming codeword without errors', async () => {
      const res = await api.verifyAndCorrectHamming('0110011', 'Even');
      expect(res).toBeDefined();
      expect(res.has_error).toBe(false);
      expect(res.syndrome_value).toBe(0);
      expect(res.error_position).toBeNull();
      expect(res.is_correctable).toBe(true);
      expect(res.extracted_data_bits).toBe('1011');
    });

    it('detects and corrects a single-bit error', async () => {
      // Flip bit 1 of '0110011' -> '1110011'
      const res = await api.verifyAndCorrectHamming('1110011', 'Even');
      expect(res).toBeDefined();
      expect(res.has_error).toBe(true);
      expect(res.syndrome_value).toBe(1);
      expect(res.error_position).toBe(1);
      expect(res.is_correctable).toBe(true);
      expect(res.corrected_bits).toBe('0110011');
      expect(res.extracted_data_bits).toBe('1011');
    });
  });

  // ==========================================
  // CRC TESTS
  // ==========================================
  describe('CRC Polynomial Engine', () => {
    it('calculates CRC remainder and constructs transmitted frame', async () => {
      const res = await api.calculateCrc('11010011101100', '1011', 'Custom');
      expect(res).toBeDefined();
      expect(res.input_bits).toBe('11010011101100');
      expect(res.generator_polynomial).toBe('1011');
      expect(res.degree).toBe(3);
      expect(res.remainder).toBe('100');
      expect(res.transmitted_codeword).toBe('11010011101100100');
      expect(res.division_steps.length).toBeGreaterThan(0);
    });

    it('verifies valid transmitted CRC frame successfully', async () => {
      const res = await api.verifyCrc('11010011101100100', '1011', 'Custom');
      expect(res).toBeDefined();
      expect(res.is_valid).toBe(true);
      expect(res.remainder).toBe('000');
      expect(res.error_detected).toBe(false);
    });

    it('detects corruption in a tampered CRC frame', async () => {
      // Corrupt last bit of frame
      const res = await api.verifyCrc('11010011101100101', '1011', 'Custom');
      expect(res).toBeDefined();
      expect(res.is_valid).toBe(false);
      expect(res.error_detected).toBe(true);
      expect(res.remainder).not.toBe('000');
    });
  });

  // ==========================================
  // INTERNET CHECKSUM TESTS
  // ==========================================
  describe('Internet Checksum Engine (RFC 1071)', () => {
    it('calculates 16-bit Internet Checksum with one-complement folding', async () => {
      const res = await api.calculateInternetChecksum('0001 F203 F4F5 F6F7');
      expect(res).toBeDefined();
      expect(res.total_words).toBe(4);
      expect(res.uncomplemented_sum).toBe(0xddf2);
      expect(res.checksum).toBe(0x220d);
      expect(res.checksum_hex).toBe('220D');
      expect(res.addition_steps.length).toBeGreaterThan(0);
    });

    it('verifies uncorrupted payload with checksum successfully', async () => {
      const res = await api.verifyInternetChecksum('0001 F203 F4F5 F6F7', '220D');
      expect(res).toBeDefined();
      expect(res.is_valid).toBe(true);
      expect(res.total_accumulated_sum).toBe(0xffff);
      expect(res.inverted_result).toBe(0x0000);
    });

    it('detects corrupted payload or tampered checksum', async () => {
      // Tampered checksum word
      const res = await api.verifyInternetChecksum('0001 F203 F4F5 F6F7', '220E');
      expect(res).toBeDefined();
      expect(res.is_valid).toBe(false);
      expect(res.error_detected).toBe(true);
      expect(res.inverted_result).not.toBe(0x0000);
    });
  });
});
