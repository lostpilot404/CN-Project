"""Cyclic Redundancy Check (CRC) modulo-2 polynomial division and verification."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

CRC8_DEFAULT_POLY = "100000111"  # x^8 + x^2 + x + 1
CRC16_IBM_POLY = "11000000000000101"  # x^16 + x^15 + x^2 + 1
CRC16_CCITT_POLY = "10001000000100001"  # x^16 + x^12 + x^5 + 1
CRC32_IEEE_POLY = "100000100110000010001110110110111"  # IEEE 802.3


@dataclass
class CrcStep:
    step_index: int
    bit_position: int
    current_window: str
    divisor_applied: str
    xor_result: str
    next_bit_brought_down: str | None
    explanation: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_index": self.step_index,
            "bit_position": self.bit_position,
            "current_window": self.current_window,
            "divisor_applied": self.divisor_applied,
            "xor_result": self.xor_result,
            "next_bit_brought_down": self.next_bit_brought_down,
            "explanation": self.explanation,
        }


@dataclass
class CrcCalculationResult:
    input_bits: str
    generator_polynomial: str
    polynomial_name: str
    degree: int
    augmented_bits: str
    remainder: str
    transmitted_codeword: str
    division_steps: list[CrcStep]

    def to_dict(self) -> dict[str, Any]:
        return {
            "input_bits": self.input_bits,
            "generator_polynomial": self.generator_polynomial,
            "polynomial_name": self.polynomial_name,
            "degree": self.degree,
            "augmented_bits": self.augmented_bits,
            "remainder": self.remainder,
            "transmitted_codeword": self.transmitted_codeword,
            "division_steps": [s.to_dict() for s in self.division_steps],
        }


@dataclass
class CrcVerifyResult:
    received_bits: str
    generator_polynomial: str
    polynomial_name: str
    remainder: str
    is_valid: bool
    error_detected: bool
    division_steps: list[CrcStep]
    status_message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "received_bits": self.received_bits,
            "generator_polynomial": self.generator_polynomial,
            "polynomial_name": self.polynomial_name,
            "remainder": self.remainder,
            "is_valid": self.is_valid,
            "error_detected": self.error_detected,
            "division_steps": [s.to_dict() for s in self.division_steps],
            "status_message": self.status_message,
        }


def validate_binary_string(input_str: str, field_name: str) -> str:
    clean = "".join(c for c in input_str if not c.isspace())
    if not clean:
        raise ValueError(f"{field_name} cannot be empty")
    for i, c in enumerate(clean):
        if c not in ("0", "1"):
            raise ValueError(f"{field_name} has invalid character '{c}' at index {i}. Must be binary ('0' or '1').")
    return clean


def validate_generator_polynomial(poly: str) -> str:
    clean = validate_binary_string(poly, "Generator polynomial")
    if len(clean) < 2:
        raise ValueError("Generator polynomial length must be at least 2 (degree >= 1)")
    if not clean.startswith("1"):
        raise ValueError("Generator polynomial must start with a leading '1' (MSB must be set)")
    return clean


def perform_modulo2_division(dividend_bits: str, generator_bits: str) -> tuple[str, list[CrcStep]]:
    gen_len = len(generator_bits)
    zero_divisor = "0" * gen_len
    div_chars = list(dividend_bits)

    steps: list[CrcStep] = []

    if len(div_chars) < gen_len:
        degree = gen_len - 1
        rem = dividend_bits.rjust(degree, "0")
        return (rem, steps)

    current_window = div_chars[:gen_len]

    for step_idx, next_idx in enumerate(range(gen_len, len(div_chars) + 1), start=1):
        is_one = current_window[0] == "1"
        divisor = generator_bits if is_one else zero_divisor

        xor_result = ["0" if w == d else "1" for w, d in zip(current_window, divisor)]

        next_bit = div_chars[next_idx] if next_idx < len(div_chars) else None
        explanation = (
            f"MSB is '1': XOR with generator polynomial {generator_bits}" if is_one else "MSB is '0': XOR with zeros"
        )

        steps.append(
            CrcStep(
                step_index=step_idx,
                bit_position=next_idx - 1,
                current_window="".join(current_window),
                divisor_applied=divisor,
                xor_result="".join(xor_result),
                next_bit_brought_down=next_bit,
                explanation=explanation,
            )
        )

        if next_bit is not None:
            current_window = xor_result[1:] + [next_bit]
        else:
            remainder = "".join(xor_result[1:])
            return (remainder, steps)

    return ("0" * (gen_len - 1), steps)


def calculate_crc(data_bits: str, polynomial: str, poly_name: str | None = None) -> CrcCalculationResult:
    clean_data = validate_binary_string(data_bits, "Data bits")
    clean_poly = validate_generator_polynomial(polynomial)

    degree = len(clean_poly) - 1
    augmented_bits = clean_data + ("0" * degree)

    remainder, division_steps = perform_modulo2_division(augmented_bits, clean_poly)
    transmitted_codeword = clean_data + remainder

    if not poly_name:
        if clean_poly == CRC8_DEFAULT_POLY:
            name = "CRC-8 (Default)"
        elif clean_poly == CRC16_IBM_POLY:
            name = "CRC-16 (IBM / ANSI)"
        elif clean_poly == CRC16_CCITT_POLY:
            name = "CRC-16 (CCITT)"
        elif clean_poly == CRC32_IEEE_POLY:
            name = "CRC-32 (IEEE 802.3)"
        else:
            name = "Custom Polynomial"
    else:
        name = poly_name

    return CrcCalculationResult(
        input_bits=clean_data,
        generator_polynomial=clean_poly,
        polynomial_name=name,
        degree=degree,
        augmented_bits=augmented_bits,
        remainder=remainder,
        transmitted_codeword=transmitted_codeword,
        division_steps=division_steps,
    )


def verify_crc(received_codeword: str, polynomial: str, poly_name: str | None = None) -> CrcVerifyResult:
    clean_received = validate_binary_string(received_codeword, "Received codeword")
    clean_poly = validate_generator_polynomial(polynomial)

    degree = len(clean_poly) - 1
    if len(clean_received) <= degree:
        raise ValueError(
            f"Received codeword length ({len(clean_received)}) must be greater than polynomial degree ({degree})"
        )

    remainder, division_steps = perform_modulo2_division(clean_received, clean_poly)
    is_valid = all(c == "0" for c in remainder)
    error_detected = not is_valid

    if not poly_name:
        if clean_poly == CRC8_DEFAULT_POLY:
            name = "CRC-8 (Default)"
        elif clean_poly == CRC16_IBM_POLY:
            name = "CRC-16 (IBM / ANSI)"
        elif clean_poly == CRC16_CCITT_POLY:
            name = "CRC-16 (CCITT)"
        elif clean_poly == CRC32_IEEE_POLY:
            name = "CRC-32 (IEEE 802.3)"
        else:
            name = "Custom Polynomial"
    else:
        name = poly_name

    status_message = (
        "CRC verification passed: Remainder is 0, no transmission errors detected."
        if is_valid
        else f"CRC verification failed: Remainder is '{remainder}', bit errors detected in received frame."
    )

    return CrcVerifyResult(
        received_bits=clean_received,
        generator_polynomial=clean_poly,
        polynomial_name=name,
        remainder=remainder,
        is_valid=is_valid,
        error_detected=error_detected,
        division_steps=division_steps,
        status_message=status_message,
    )


class CrcPreset(str, Enum):
    CRC8 = "crc8"
    CRC16_IBM = "crc16_ibm"
    CRC16_CCITT = "crc16_ccitt"
    CRC32 = "crc32"


def _preset_to_poly(preset: CrcPreset | str) -> tuple[str, str]:
    p = str(preset).lower()
    if "crc8" in p or p.endswith("crc8") or "8" in p:
        return CRC8_DEFAULT_POLY, "CRC-8"
    elif "ccitt" in p:
        return CRC16_CCITT_POLY, "CRC-16 (CCITT)"
    elif "crc16" in p or "16" in p:
        return CRC16_IBM_POLY, "CRC-16 (IBM / ANSI)"
    elif "crc32" in p or "32" in p:
        return CRC32_IEEE_POLY, "CRC-32 (IEEE 802.3)"
    return CRC8_DEFAULT_POLY, "CRC-8"


@dataclass
class CrcComputeResult:
    checksum_bits: str
    transmitted_frame: str


def crc_compute(data_bits: str, preset: CrcPreset | str) -> CrcComputeResult:
    poly, name = _preset_to_poly(preset)
    res = calculate_crc(data_bits, poly, name)
    return CrcComputeResult(checksum_bits=res.remainder, transmitted_frame=res.transmitted_codeword)


def crc_verify(frame_bits: str, preset: CrcPreset | str) -> CrcVerifyResult:
    poly, name = _preset_to_poly(preset)
    return verify_crc(frame_bits, poly, name)
