use crate::error::{NetSimError, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecksumAdditionStep {
    pub step_index: usize,
    pub word_hex: String,
    pub word_value: u16,
    pub sum_before_addition: u32,
    pub sum_after_addition: u32,
    pub carry_detected: u16,
    pub sum_after_carry_fold: u16,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecksumCalculationResult {
    pub input_hex: String,
    pub words: Vec<u16>,
    pub word_hex_list: Vec<String>,
    pub total_words: usize,
    pub addition_steps: Vec<ChecksumAdditionStep>,
    pub uncomplemented_sum: u16,
    pub checksum: u16,
    pub checksum_hex: String,
    pub checksum_binary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecksumVerifyResult {
    pub payload_words: Vec<u16>,
    pub checksum_tested: u16,
    pub words_with_checksum: Vec<u16>,
    pub total_accumulated_sum: u16,
    pub inverted_result: u16,
    pub is_valid: bool,
    pub error_detected: bool,
    pub verification_steps: Vec<ChecksumAdditionStep>,
    pub status_message: String,
}

/// Parses a whitespace-separated or continuous hexadecimal string into a vector of 16-bit words.
///
/// If the byte length is odd, the final byte is padded on the right with a zero byte (`byte << 8`)
/// according to the RFC 1071 specification.
pub fn parse_hex_to_16bit_words(hex_str: &str) -> Result<Vec<u16>> {
    let trimmed = hex_str.trim();
    if trimmed.is_empty() {
        return Err(NetSimError::InvalidConfiguration(
            "Checksum input cannot be empty".to_string(),
        ));
    }

    // Check if the input contains delimiters (whitespace, commas, semicolons, colons)
    let has_delimiters = trimmed
        .chars()
        .any(|c| c.is_whitespace() || c == ',' || c == ';' || c == ':');

    let mut words = Vec::new();

    if has_delimiters {
        let tokens = trimmed.split(|c: char| c.is_whitespace() || c == ',' || c == ';' || c == ':');
        for raw_token in tokens {
            let t = raw_token.trim();
            if t.is_empty() {
                continue;
            }
            let stripped = if t.starts_with("0x") || t.starts_with("0X") {
                &t[2..]
            } else {
                t
            };
            if stripped.is_empty() {
                continue;
            }
            for c in stripped.chars() {
                if !c.is_ascii_hexdigit() {
                    return Err(NetSimError::InvalidConfiguration(format!(
                        "Invalid hexadecimal character '{}' in token '{}'",
                        c, t
                    )));
                }
            }
            if stripped.len() <= 4 {
                let val = u16::from_str_radix(stripped, 16)
                    .map_err(|e| NetSimError::InvalidConfiguration(e.to_string()))?;
                words.push(val);
            } else {
                // Multi-word continuous token
                let chars: Vec<char> = stripped.chars().collect();
                let mut i = 0;
                while i < chars.len() {
                    let chunk: String =
                        chars[i..std::cmp::min(i + 4, chars.len())].iter().collect();
                    let val = u16::from_str_radix(&chunk, 16)
                        .map_err(|e| NetSimError::InvalidConfiguration(e.to_string()))?;
                    words.push(val);
                    i += 4;
                }
            }
        }
    } else {
        let clean = if trimmed.starts_with("0x") || trimmed.starts_with("0X") {
            &trimmed[2..]
        } else {
            trimmed
        };
        for (i, c) in clean.char_indices() {
            if !c.is_ascii_hexdigit() {
                return Err(NetSimError::InvalidConfiguration(format!(
                    "Invalid hexadecimal character '{}' at index {}",
                    c, i
                )));
            }
        }
        let chars: Vec<char> = clean.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            let remaining = chars.len() - i;
            if remaining >= 4 {
                let chunk: String = chars[i..i + 4].iter().collect();
                let val = u16::from_str_radix(&chunk, 16)
                    .map_err(|e| NetSimError::InvalidConfiguration(e.to_string()))?;
                words.push(val);
                i += 4;
            } else if remaining == 2 {
                let chunk: String = chars[i..i + 2].iter().collect();
                let byte_val = u8::from_str_radix(&chunk, 16)
                    .map_err(|e| NetSimError::InvalidConfiguration(e.to_string()))?;
                let val = (byte_val as u16) << 8;
                words.push(val);
                i += 2;
            } else {
                let mut padded = clean[i..].to_string();
                while padded.len() < 4 {
                    padded.push('0');
                }
                let val = u16::from_str_radix(&padded, 16)
                    .map_err(|e| NetSimError::InvalidConfiguration(e.to_string()))?;
                words.push(val);
                break;
            }
        }
    }

    if words.is_empty() {
        return Err(NetSimError::InvalidConfiguration(
            "No valid hexadecimal words parsed".to_string(),
        ));
    }

    Ok(words)
}

/// Converts raw ASCII or UTF-8 text into 16-bit words (network byte order),
/// padding with 0 byte if length is odd as per RFC 1071.
pub fn parse_bytes_to_16bit_words(bytes: &[u8]) -> Vec<u16> {
    let mut words = Vec::with_capacity(bytes.len().div_ceil(2));
    let mut i = 0;
    while i < bytes.len() {
        if i + 1 < bytes.len() {
            let word = ((bytes[i] as u16) << 8) | (bytes[i + 1] as u16);
            words.push(word);
            i += 2;
        } else {
            // Odd length: pad on right with zero byte
            let word = (bytes[i] as u16) << 8;
            words.push(word);
            i += 1;
        }
    }
    words
}

/// Computes the 16-bit Internet Checksum (RFC 1071) with detailed step-by-step
/// partial sum and end-around carry folding trace.
pub fn calculate_internet_checksum(words: &[u16]) -> Result<ChecksumCalculationResult> {
    if words.is_empty() {
        return Err(NetSimError::InvalidConfiguration(
            "Cannot calculate checksum of empty word list".to_string(),
        ));
    }

    let mut accumulator: u32 = 0;
    let mut addition_steps = Vec::with_capacity(words.len());

    for (idx, &word) in words.iter().enumerate() {
        let before = accumulator;
        accumulator += word as u32;
        let after = accumulator;

        // End-around carry folding for intermediate display
        let carry = (accumulator >> 16) as u16;
        let folded = ((accumulator & 0xFFFF) + (carry as u32)) as u16;

        let explanation = if carry > 0 {
            format!(
                "Added 0x{:04X}: sum = 0x{:08X}, carry 0x{:04X} detected -> folded to 0x{:04X}",
                word, after, carry, folded
            )
        } else {
            format!("Added 0x{:04X}: sum = 0x{:04X}", word, after as u16)
        };

        addition_steps.push(ChecksumAdditionStep {
            step_index: idx + 1,
            word_hex: format!("{:04X}", word),
            word_value: word,
            sum_before_addition: before,
            sum_after_addition: after,
            carry_detected: carry,
            sum_after_carry_fold: folded,
            explanation,
        });
    }

    // Final full carry folding until no carries remain
    while (accumulator >> 16) > 0 {
        accumulator = (accumulator & 0xFFFF) + (accumulator >> 16);
    }

    let uncomplemented_sum = accumulator as u16;
    let checksum = !uncomplemented_sum;

    let input_hex = words
        .iter()
        .map(|w| format!("{:04X}", w))
        .collect::<Vec<_>>()
        .join(" ");

    let word_hex_list = words.iter().map(|w| format!("{:04X}", w)).collect();

    Ok(ChecksumCalculationResult {
        input_hex,
        words: words.to_vec(),
        word_hex_list,
        total_words: words.len(),
        addition_steps,
        uncomplemented_sum,
        checksum,
        checksum_hex: format!("{:04X}", checksum),
        checksum_binary: format!("{:016b}", checksum),
    })
}

/// Verifies a payload of 16-bit words against a checksum word (or verifies a slice of words
/// that already includes the checksum word at the end or designated position).
///
/// In RFC 1071:
/// Summing the payload words PLUS the checksum word yields a folded sum of `0xFFFF`,
/// which inverted is `0x0000` (valid).
pub fn verify_internet_checksum(
    payload_words: &[u16],
    checksum: u16,
) -> Result<ChecksumVerifyResult> {
    if payload_words.is_empty() {
        return Err(NetSimError::InvalidConfiguration(
            "Cannot verify checksum of empty payload".to_string(),
        ));
    }

    let mut all_words = payload_words.to_vec();
    all_words.push(checksum);

    let mut accumulator: u32 = 0;
    let mut verification_steps = Vec::with_capacity(all_words.len());

    for (idx, &word) in all_words.iter().enumerate() {
        let before = accumulator;
        accumulator += word as u32;
        let after = accumulator;
        let carry = (accumulator >> 16) as u16;
        let folded = ((accumulator & 0xFFFF) + (carry as u32)) as u16;

        let is_checksum_word = idx == all_words.len() - 1;
        let explanation = if is_checksum_word {
            format!(
                "Added checksum 0x{:04X}: total sum = 0x{:04X} (Expected 0xFFFF)",
                word, folded
            )
        } else {
            format!("Added word 0x{:04X}: sum = 0x{:04X}", word, folded)
        };

        verification_steps.push(ChecksumAdditionStep {
            step_index: idx + 1,
            word_hex: format!("{:04X}", word),
            word_value: word,
            sum_before_addition: before,
            sum_after_addition: after,
            carry_detected: carry,
            sum_after_carry_fold: folded,
            explanation,
        });
    }

    while (accumulator >> 16) > 0 {
        accumulator = (accumulator & 0xFFFF) + (accumulator >> 16);
    }

    let total_sum = accumulator as u16;
    let inverted = !total_sum;
    let is_valid = total_sum == 0xFFFF || inverted == 0;
    let error_detected = !is_valid;

    let status_message = if is_valid {
        "Checksum verified successfully. One's-complement sum is 0xFFFF (no corruption detected)."
            .to_string()
    } else {
        format!(
            "Checksum error detected! One's-complement sum is 0x{:04X} (expected 0xFFFF). Data is corrupted.",
            total_sum
        )
    };

    Ok(ChecksumVerifyResult {
        payload_words: payload_words.to_vec(),
        checksum_tested: checksum,
        words_with_checksum: all_words,
        total_accumulated_sum: total_sum,
        inverted_result: inverted,
        is_valid,
        error_detected,
        verification_steps,
        status_message,
    })
}
