use crate::error::{NetSimError, Result};
use serde::{Deserialize, Serialize};

pub const CRC8_DEFAULT_POLY: &str = "100000111"; // x^8 + x^2 + x + 1
pub const CRC16_IBM_POLY: &str = "11000000000000101"; // x^16 + x^15 + x^2 + 1
pub const CRC16_CCITT_POLY: &str = "10001000000100001"; // x^16 + x^12 + x^5 + 1
pub const CRC32_IEEE_POLY: &str = "100000100110000010001110110110111"; // IEEE 802.3

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrcStep {
    pub step_index: usize,
    pub bit_position: usize,
    pub current_window: String,
    pub divisor_applied: String, // Generator or all 0s
    pub xor_result: String,
    pub next_bit_brought_down: Option<char>,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrcCalculationResult {
    pub input_bits: String,
    pub generator_polynomial: String,
    pub polynomial_name: String,
    pub degree: usize,
    pub augmented_bits: String,
    pub remainder: String,
    pub transmitted_codeword: String,
    pub division_steps: Vec<CrcStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrcVerifyResult {
    pub received_bits: String,
    pub generator_polynomial: String,
    pub polynomial_name: String,
    pub remainder: String,
    pub is_valid: bool,
    pub error_detected: bool,
    pub division_steps: Vec<CrcStep>,
    pub status_message: String,
}

/// Validates that a string is a valid binary bitstring.
pub fn validate_binary_string(input: &str, field_name: &str) -> Result<String> {
    let clean: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    if clean.is_empty() {
        return Err(NetSimError::InvalidConfiguration(format!(
            "{} cannot be empty",
            field_name
        )));
    }
    for (i, c) in clean.char_indices() {
        if c != '0' && c != '1' {
            return Err(NetSimError::InvalidConfiguration(format!(
                "{} has invalid character '{}' at index {}. Must be binary ('0' or '1').",
                field_name, c, i
            )));
        }
    }
    Ok(clean)
}

/// Validates that a generator polynomial bitstring is valid for modulo-2 division.
///
/// Rules:
/// - Must contain only '0' and '1'.
/// - Leading bit must be '1'.
/// - Length must be >= 2 (degree >= 1).
pub fn validate_generator_polynomial(poly: &str) -> Result<String> {
    let clean = validate_binary_string(poly, "Generator polynomial")?;
    if clean.len() < 2 {
        return Err(NetSimError::InvalidConfiguration(
            "Generator polynomial length must be at least 2 (degree >= 1)".to_string(),
        ));
    }
    if !clean.starts_with('1') {
        return Err(NetSimError::InvalidConfiguration(
            "Generator polynomial must start with a leading '1' (MSB must be set)".to_string(),
        ));
    }
    Ok(clean)
}

/// Performs bitwise modulo-2 polynomial division (XOR division) and produces
/// an authoritative, deterministic step-by-step trace.
pub fn perform_modulo2_division(
    dividend_bits: &str,
    generator_bits: &str,
) -> (String, Vec<CrcStep>) {
    let gen_len = generator_bits.len();
    let zero_divisor: String = "0".repeat(gen_len);
    let div_chars: Vec<char> = dividend_bits.chars().collect();

    let mut steps = Vec::new();

    if div_chars.len() < gen_len {
        // If dividend is shorter than generator, remainder is dividend padded with leading 0s to degree
        let degree = gen_len - 1;
        let mut rem = dividend_bits.to_string();
        while rem.len() < degree {
            rem.insert(0, '0');
        }
        return (rem, steps);
    }

    // Initialize the working window with the first gen_len bits
    let mut current_window: Vec<char> = div_chars[0..gen_len].to_vec();

    for (step_idx, next_idx) in (1..).zip(gen_len..=div_chars.len()) {
        let is_one = current_window[0] == '1';
        let divisor = if is_one {
            generator_bits
        } else {
            &zero_divisor
        };

        // XOR current_window with divisor
        let xor_result: Vec<char> = current_window
            .iter()
            .zip(divisor.chars())
            .map(|(&w, d)| if w == d { '0' } else { '1' })
            .collect();

        let next_bit = if next_idx < div_chars.len() {
            Some(div_chars[next_idx])
        } else {
            None
        };

        let explanation = if is_one {
            format!(
                "MSB is '1': XOR with generator polynomial {}",
                generator_bits
            )
        } else {
            "MSB is '0': XOR with zeros".to_string()
        };

        steps.push(CrcStep {
            step_index: step_idx,
            bit_position: next_idx - 1,
            current_window: current_window.iter().collect(),
            divisor_applied: divisor.to_string(),
            xor_result: xor_result.iter().collect(),
            next_bit_brought_down: next_bit,
            explanation,
        });

        if let Some(nb) = next_bit {
            // Shift left by 1 (drop leading bit of xor_result) and append next_bit
            current_window = xor_result[1..].to_vec();
            current_window.push(nb);
        } else {
            // Final remainder is the last (gen_len - 1) bits of the last XOR result
            let remainder: String = xor_result[1..].iter().collect();
            return (remainder, steps);
        }
    }

    ("0".repeat(gen_len - 1), steps)
}

/// Calculates CRC remainder and generates the transmitted codeword:
/// Transmitted Codeword = Data Bits + CRC Remainder.
pub fn calculate_crc(
    data_bits: &str,
    polynomial: &str,
    poly_name: Option<&str>,
) -> Result<CrcCalculationResult> {
    let clean_data = validate_binary_string(data_bits, "Data bits")?;
    let clean_poly = validate_generator_polynomial(polynomial)?;

    let degree = clean_poly.len() - 1;
    let augmented_bits = format!("{}{}", clean_data, "0".repeat(degree));

    let (remainder, division_steps) = perform_modulo2_division(&augmented_bits, &clean_poly);
    let transmitted_codeword = format!("{}{}", clean_data, remainder);

    let name = poly_name.unwrap_or(match clean_poly.as_str() {
        CRC8_DEFAULT_POLY => "CRC-8 (Default)",
        CRC16_IBM_POLY => "CRC-16 (IBM / ANSI)",
        CRC16_CCITT_POLY => "CRC-16 (CCITT)",
        CRC32_IEEE_POLY => "CRC-32 (IEEE 802.3)",
        _ => "Custom Polynomial",
    });

    Ok(CrcCalculationResult {
        input_bits: clean_data,
        generator_polynomial: clean_poly,
        polynomial_name: name.to_string(),
        degree,
        augmented_bits,
        remainder,
        transmitted_codeword,
        division_steps,
    })
}

/// Verifies a received frame codeword against a generator polynomial.
///
/// Modulo-2 division of the received codeword by the generator polynomial
/// yields a remainder of all zeros if and only if no error is detected.
pub fn verify_crc(
    received_codeword: &str,
    polynomial: &str,
    poly_name: Option<&str>,
) -> Result<CrcVerifyResult> {
    let clean_codeword = validate_binary_string(received_codeword, "Received codeword")?;
    let clean_poly = validate_generator_polynomial(polynomial)?;

    let (remainder, division_steps) = perform_modulo2_division(&clean_codeword, &clean_poly);
    let is_valid = remainder.chars().all(|c| c == '0');
    let error_detected = !is_valid;

    let name = poly_name.unwrap_or(match clean_poly.as_str() {
        CRC8_DEFAULT_POLY => "CRC-8 (Default)",
        CRC16_IBM_POLY => "CRC-16 (IBM / ANSI)",
        CRC16_CCITT_POLY => "CRC-16 (CCITT)",
        CRC32_IEEE_POLY => "CRC-32 (IEEE 802.3)",
        _ => "Custom Polynomial",
    });

    let status_message = if is_valid {
        "Frame verified successfully. Remainder is 0 (no error detected).".to_string()
    } else {
        format!(
            "CRC error detected! Non-zero remainder: 0b{} (frame corrupted).",
            remainder
        )
    };

    Ok(CrcVerifyResult {
        received_bits: clean_codeword,
        generator_polynomial: clean_poly,
        polynomial_name: name.to_string(),
        remainder,
        is_valid,
        error_detected,
        division_steps,
        status_message,
    })
}

/// Injects deterministic bit errors into a bitstring at the specified 0-indexed positions.
pub fn inject_bit_errors(bits: &str, error_indices: &[usize]) -> Result<String> {
    let mut chars: Vec<char> = bits.chars().filter(|c| !c.is_whitespace()).collect();
    for &idx in error_indices {
        if idx >= chars.len() {
            return Err(NetSimError::InvalidConfiguration(format!(
                "Error injection index {} exceeds bitstring length {}",
                idx,
                chars.len()
            )));
        }
        chars[idx] = if chars[idx] == '0' { '1' } else { '0' };
    }
    Ok(chars.into_iter().collect())
}
