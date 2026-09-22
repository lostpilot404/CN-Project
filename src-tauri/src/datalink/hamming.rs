use crate::error::{NetSimError, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParityMode {
    Even,
    Odd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParityBitDetail {
    pub parity_index: usize, // 1-indexed power of 2 (1, 2, 4, 8, ...)
    pub label: String,       // e.g. "p1", "p2", "p4"
    pub covered_indices: Vec<usize>,
    pub covered_bits: Vec<u8>,
    pub parity_value: u8,
    pub formula: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HammingBitInfo {
    pub position: usize, // 1-indexed position in codeword
    pub is_parity: bool,
    pub bit_value: u8,
    pub label: String, // "p1", "p2", "d1", "p4", "d2", etc.
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HammingEncodeResult {
    pub raw_data_bits: String,
    pub data_bit_count: usize,
    pub parity_bit_count: usize,
    pub total_bit_count: usize,
    pub parity_mode: ParityMode,
    pub encoded_bits: String,
    pub bit_positions: Vec<HammingBitInfo>,
    pub parity_details: Vec<ParityBitDetail>,
    /// Optional SECDED overall parity bit value
    pub overall_parity: u8,
    pub encoded_bits_secded: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HammingVerifyResult {
    pub received_bits: String,
    pub parity_mode: ParityMode,
    pub syndrome_bits: String,
    pub syndrome_value: usize, // 0 = no error, >0 = 1-indexed error position
    pub has_error: bool,
    pub is_correctable: bool,
    pub error_type: String, // "none", "single_bit", "multiple_bit_unrecoverable"
    pub error_position: Option<usize>,
    pub corrected_bits: Option<String>,
    pub extracted_data_bits: Option<String>,
    pub syndrome_details: Vec<ParityBitDetail>,
    pub status_message: String,
}

/// Computes the required number of parity bits $r$ for $m$ data bits:
/// $2^r \ge m + r + 1$.
pub fn calculate_required_parity_bits(data_bits_len: usize) -> usize {
    let mut r = 1;
    while (1 << r) < (data_bits_len + r + 1) {
        r += 1;
    }
    r
}

/// Checks whether an index (1-indexed) is a power of two.
#[inline]
pub fn is_power_of_two(n: usize) -> bool {
    n > 0 && (n & (n - 1)) == 0
}

/// Encodes raw binary data bits into a Hamming codeword with educational step-by-step traces.
#[allow(clippy::needless_range_loop)]
pub fn encode_hamming(data_bits: &str, parity_mode: ParityMode) -> Result<HammingEncodeResult> {
    let clean_data: String = data_bits.chars().filter(|c| !c.is_whitespace()).collect();

    if clean_data.is_empty() {
        return Err(NetSimError::InvalidConfiguration(
            "Hamming encode error: data bits cannot be empty".to_string(),
        ));
    }

    for (idx, ch) in clean_data.char_indices() {
        if ch != '0' && ch != '1' {
            return Err(NetSimError::InvalidConfiguration(format!(
                "Hamming encode error: invalid character '{}' at index {}. Must be '0' or '1'.",
                ch, idx
            )));
        }
    }

    let m = clean_data.len();
    let r = calculate_required_parity_bits(m);
    let total_len = m + r;

    // 1-indexed array of bits (index 0 is unused, indices 1..=total_len used)
    let mut codeword = vec![0u8; total_len + 1];
    let mut data_chars = clean_data.chars();
    let mut bit_positions = Vec::with_capacity(total_len);

    // Place data bits at non-power-of-two positions
    let mut data_idx = 1;
    for pos in 1..=total_len {
        if is_power_of_two(pos) {
            let p_num = pos.trailing_zeros() + 1;
            bit_positions.push(HammingBitInfo {
                position: pos,
                is_parity: true,
                bit_value: 0,
                label: format!("p{}", 1 << (p_num - 1)),
            });
        } else {
            let bit_val = data_chars.next().unwrap().to_digit(2).unwrap() as u8;
            codeword[pos] = bit_val;
            bit_positions.push(HammingBitInfo {
                position: pos,
                is_parity: false,
                bit_value: bit_val,
                label: format!("d{}", data_idx),
            });
            data_idx += 1;
        }
    }

    // Calculate parity bits
    let mut parity_details = Vec::with_capacity(r);
    for k in 0..r {
        let p_pos = 1 << k;
        let mut covered_indices = Vec::new();
        let mut covered_bits = Vec::new();
        let mut sum = 0u8;

        for pos in 1..=total_len {
            if (pos & p_pos) != 0 && pos != p_pos {
                covered_indices.push(pos);
                covered_bits.push(codeword[pos]);
                sum ^= codeword[pos];
            }
        }

        let parity_value = match parity_mode {
            ParityMode::Even => sum,      // Even parity: XOR sum of covered data bits
            ParityMode::Odd => sum ^ 1u8, // Odd parity: inverted XOR sum
        };

        codeword[p_pos] = parity_value;

        // Update bit_positions list
        if let Some(info) = bit_positions.iter_mut().find(|b| b.position == p_pos) {
            info.bit_value = parity_value;
        }

        let formula = format!(
            "p{} = {} over positions {:?}",
            p_pos,
            if parity_mode == ParityMode::Even {
                "EvenParity"
            } else {
                "OddParity"
            },
            covered_indices
        );

        parity_details.push(ParityBitDetail {
            parity_index: p_pos,
            label: format!("p{}", p_pos),
            covered_indices,
            covered_bits,
            parity_value,
            formula,
        });
    }

    // Convert codeword (indices 1..=total_len) to bitstring
    let encoded_bits: String = (1..=total_len)
        .map(|i| if codeword[i] == 1 { '1' } else { '0' })
        .collect();

    // Calculate SECDED overall parity bit over all encoded bits
    let overall_sum: u8 = codeword[1..=total_len].iter().fold(0u8, |acc, &b| acc ^ b);
    let overall_parity = match parity_mode {
        ParityMode::Even => overall_sum,
        ParityMode::Odd => overall_sum ^ 1u8,
    };
    let encoded_bits_secded = format!("{}{}", overall_parity, encoded_bits);

    Ok(HammingEncodeResult {
        raw_data_bits: clean_data,
        data_bit_count: m,
        parity_bit_count: r,
        total_bit_count: total_len,
        parity_mode,
        encoded_bits,
        bit_positions,
        parity_details,
        overall_parity,
        encoded_bits_secded,
    })
}

/// Verifies and corrects an arbitrary Hamming codeword.
#[allow(clippy::needless_range_loop)]
pub fn verify_and_correct_hamming(
    codeword_str: &str,
    parity_mode: ParityMode,
) -> Result<HammingVerifyResult> {
    let clean_code: String = codeword_str
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();

    if clean_code.is_empty() {
        return Err(NetSimError::InvalidConfiguration(
            "Hamming verify error: codeword cannot be empty".to_string(),
        ));
    }

    for (idx, ch) in clean_code.char_indices() {
        if ch != '0' && ch != '1' {
            return Err(NetSimError::InvalidConfiguration(format!(
                "Hamming verify error: invalid character '{}' at index {}. Must be '0' or '1'.",
                ch, idx
            )));
        }
    }

    let n = clean_code.len();
    if n < 3 {
        return Err(NetSimError::InvalidConfiguration(
            "Hamming codeword must have at least 3 bits (e.g. Hamming(3,1))".to_string(),
        ));
    }

    // 1-indexed codeword
    let mut bits = vec![0u8; n + 1];
    for (i, ch) in clean_code.chars().enumerate() {
        bits[i + 1] = ch.to_digit(2).unwrap() as u8;
    }

    // Determine how many parity bits fit in length n
    let mut r = 0;
    while (1 << r) <= n {
        r += 1;
    }

    let mut syndrome_details = Vec::with_capacity(r);
    let mut syndrome_bits_vec = Vec::with_capacity(r);
    let mut syndrome_value = 0usize;

    for k in 0..r {
        let p_pos = 1 << k;
        let mut covered_indices = Vec::new();
        let mut covered_bits = Vec::new();
        let mut check_sum = 0u8;

        for pos in 1..=n {
            if (pos & p_pos) != 0 {
                covered_indices.push(pos);
                covered_bits.push(bits[pos]);
                check_sum ^= bits[pos];
            }
        }

        // For Even parity, check_sum should be 0 if valid. If 1, syndrome bit is 1.
        // For Odd parity, check_sum should be 1 if valid. If 0, syndrome bit is 1.
        let syn_bit = match parity_mode {
            ParityMode::Even => check_sum,
            ParityMode::Odd => check_sum ^ 1u8,
        };

        syndrome_bits_vec.push(syn_bit);
        if syn_bit == 1 {
            syndrome_value += p_pos;
        }

        let formula = format!("s{} = XOR({:?}) -> {}", p_pos, covered_indices, syn_bit);

        syndrome_details.push(ParityBitDetail {
            parity_index: p_pos,
            label: format!("s{}", p_pos),
            covered_indices,
            covered_bits,
            parity_value: syn_bit,
            formula,
        });
    }

    let syndrome_bits: String = syndrome_bits_vec
        .iter()
        .rev()
        .map(|b| if *b == 1 { '1' } else { '0' })
        .collect();

    let has_error = syndrome_value != 0;

    if !has_error {
        // Extract data bits (non-power-of-two positions)
        let extracted_data: String = (1..=n)
            .filter(|&pos| !is_power_of_two(pos))
            .map(|pos| if bits[pos] == 1 { '1' } else { '0' })
            .collect();

        return Ok(HammingVerifyResult {
            received_bits: clean_code.clone(),
            parity_mode,
            syndrome_bits,
            syndrome_value: 0,
            has_error: false,
            is_correctable: true,
            error_type: "none".to_string(),
            error_position: None,
            corrected_bits: Some(clean_code),
            extracted_data_bits: Some(extracted_data),
            syndrome_details,
            status_message: "Codeword is valid. No bit errors detected.".to_string(),
        });
    }

    // Error detected
    if syndrome_value <= n {
        // Single-bit correctable error at position syndrome_value
        let mut corrected_bits_vec = bits.clone();
        corrected_bits_vec[syndrome_value] ^= 1u8; // Flip errored bit

        let corrected_bits_str: String = (1..=n)
            .map(|i| if corrected_bits_vec[i] == 1 { '1' } else { '0' })
            .collect();

        let extracted_data: String = (1..=n)
            .filter(|&pos| !is_power_of_two(pos))
            .map(|pos| {
                if corrected_bits_vec[pos] == 1 {
                    '1'
                } else {
                    '0'
                }
            })
            .collect();

        Ok(HammingVerifyResult {
            received_bits: clean_code,
            parity_mode,
            syndrome_bits,
            syndrome_value,
            has_error: true,
            is_correctable: true,
            error_type: "single_bit".to_string(),
            error_position: Some(syndrome_value),
            corrected_bits: Some(corrected_bits_str),
            extracted_data_bits: Some(extracted_data),
            syndrome_details,
            status_message: format!(
                "Single-bit error detected and corrected at position {} (1-indexed).",
                syndrome_value
            ),
        })
    } else {
        // Syndrome points out of range: multiple-bit unrecoverable error
        Ok(HammingVerifyResult {
            received_bits: clean_code,
            parity_mode,
            syndrome_bits,
            syndrome_value,
            has_error: true,
            is_correctable: false,
            error_type: "multiple_bit_unrecoverable".to_string(),
            error_position: Some(syndrome_value),
            corrected_bits: None,
            extracted_data_bits: None,
            syndrome_details,
            status_message: format!(
                "Unrecoverable multiple-bit error: calculated syndrome {} exceeds codeword length {}.",
                syndrome_value, n
            ),
        })
    }
}
