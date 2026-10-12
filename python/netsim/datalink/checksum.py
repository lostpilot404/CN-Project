"""Internet Checksum (RFC 1071) 16-bit one's-complement calculation and verification."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class ChecksumAdditionStep:
    step_index: int
    word_hex: str
    word_value: int
    sum_before_addition: int
    sum_after_addition: int
    carry_detected: int
    sum_after_carry_fold: int
    explanation: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_index": self.step_index,
            "word_hex": self.word_hex,
            "word_value": self.word_value,
            "sum_before_addition": self.sum_before_addition,
            "sum_after_addition": self.sum_after_addition,
            "carry_detected": self.carry_detected,
            "sum_after_carry_fold": self.sum_after_carry_fold,
            "explanation": self.explanation,
        }


@dataclass
class ChecksumCalculationResult:
    input_hex: str
    words: list[int]
    word_hex_list: list[str]
    total_words: int
    addition_steps: list[ChecksumAdditionStep]
    uncomplemented_sum: int
    checksum: int
    checksum_hex: str
    checksum_binary: str

    @property
    def checksum_value(self) -> int:
        return self.checksum

    @property
    def hex_str(self) -> str:
        return self.checksum_hex

    def to_dict(self) -> dict[str, Any]:
        return {
            "input_hex": self.input_hex,
            "words": self.words,
            "word_hex_list": self.word_hex_list,
            "total_words": self.total_words,
            "addition_steps": [s.to_dict() for s in self.addition_steps],
            "uncomplemented_sum": self.uncomplemented_sum,
            "checksum": self.checksum,
            "checksum_value": self.checksum,
            "checksum_hex": self.checksum_hex,
            "hex_str": self.checksum_hex,
            "checksum_binary": self.checksum_binary,
        }


@dataclass
class ChecksumVerifyResult:
    payload_words: list[int]
    checksum_tested: int
    words_with_checksum: list[int]
    total_accumulated_sum: int
    inverted_result: int
    is_valid: bool
    error_detected: bool
    verification_steps: list[ChecksumAdditionStep]
    status_message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "payload_words": self.payload_words,
            "checksum_tested": self.checksum_tested,
            "words_with_checksum": self.words_with_checksum,
            "total_accumulated_sum": self.total_accumulated_sum,
            "inverted_result": self.inverted_result,
            "is_valid": self.is_valid,
            "error_detected": self.error_detected,
            "verification_steps": [s.to_dict() for s in self.verification_steps],
            "status_message": self.status_message,
        }


def parse_hex_to_16bit_words(hex_str: str) -> list[int]:
    trimmed = hex_str.strip()
    if not trimmed:
        raise ValueError("Checksum input cannot be empty")

    has_delimiters = any(c.isspace() or c in ",;: " for c in trimmed)
    words: list[int] = []

    if has_delimiters:
        tokens = [t.strip() for t in trimmed.replace(",", " ").replace(";", " ").replace(":", " ").split() if t.strip()]
        for t in tokens:
            stripped = t[2:] if t.startswith(("0x", "0X")) else t
            if not stripped:
                continue
            for c in stripped:
                if c not in "0123456789abcdefABCDEF":
                    raise ValueError(f"Invalid hexadecimal character '{c}' in token '{t}'")
            if len(stripped) <= 4:
                val = int(stripped, 16)
                words.append(val)
            else:
                for i in range(0, len(stripped), 4):
                    chunk = stripped[i : i + 4]
                    words.append(int(chunk, 16))
    else:
        clean = trimmed[2:] if trimmed.startswith(("0x", "0X")) else trimmed
        for i, c in enumerate(clean):
            if c not in "0123456789abcdefABCDEF":
                raise ValueError(f"Invalid hexadecimal character '{c}' at index {i}")

        i = 0
        while i < len(clean):
            remaining = len(clean) - i
            if remaining >= 4:
                chunk = clean[i : i + 4]
                words.append(int(chunk, 16))
                i += 4
            elif remaining == 2:
                chunk = clean[i : i + 2]
                byte_val = int(chunk, 16)
                words.append(byte_val << 8)
                i += 2
            else:
                padded = clean[i:].ljust(4, "0")
                words.append(int(padded, 16))
                break

    if not words:
        raise ValueError("No valid hexadecimal words parsed")
    return words


def parse_bytes_to_16bit_words(b: bytes) -> list[int]:
    words = []
    i = 0
    while i < len(b):
        if i + 1 < len(b):
            word = (b[i] << 8) | b[i + 1]
            words.append(word)
            i += 2
        else:
            word = b[i] << 8
            words.append(word)
            i += 1
    return words


def calculate_internet_checksum(words: list[int]) -> ChecksumCalculationResult:
    if not words:
        raise ValueError("Cannot calculate checksum of empty word list")

    accumulator = 0
    addition_steps: list[ChecksumAdditionStep] = []

    for idx, word in enumerate(words):
        before = accumulator
        accumulator += word
        after = accumulator

        carry = (accumulator >> 16) & 0xFFFF
        folded = ((accumulator & 0xFFFF) + carry) & 0xFFFF

        explanation = (
            f"Added 0x{word:04X}: sum = 0x{after:08X}, carry 0x{carry:04X} detected -> folded to 0x{folded:04X}"
            if carry > 0
            else f"Added 0x{word:04X}: sum = 0x{after & 0xFFFF:04X}"
        )

        addition_steps.append(
            ChecksumAdditionStep(
                step_index=idx + 1,
                word_hex=f"{word:04X}",
                word_value=word,
                sum_before_addition=before,
                sum_after_addition=after,
                carry_detected=carry,
                sum_after_carry_fold=folded,
                explanation=explanation,
            )
        )

    while (accumulator >> 16) > 0:
        accumulator = (accumulator & 0xFFFF) + (accumulator >> 16)

    uncomplemented_sum = accumulator & 0xFFFF
    checksum = (~uncomplemented_sum) & 0xFFFF

    input_hex = " ".join(f"{w:04X}" for w in words)
    word_hex_list = [f"{w:04X}" for w in words]

    return ChecksumCalculationResult(
        input_hex=input_hex,
        words=list(words),
        word_hex_list=word_hex_list,
        total_words=len(words),
        addition_steps=addition_steps,
        uncomplemented_sum=uncomplemented_sum,
        checksum=checksum,
        checksum_hex=f"{checksum:04X}",
        checksum_binary=f"{checksum:016b}",
    )


def verify_internet_checksum(payload_words: list[int], checksum: int) -> ChecksumVerifyResult:
    if not payload_words:
        raise ValueError("Cannot verify checksum of empty payload")

    all_words = list(payload_words) + [checksum]
    accumulator = 0
    verification_steps: list[ChecksumAdditionStep] = []

    for idx, word in enumerate(all_words):
        before = accumulator
        accumulator += word
        after = accumulator
        carry = (accumulator >> 16) & 0xFFFF
        folded = ((accumulator & 0xFFFF) + carry) & 0xFFFF

        is_checksum = idx == len(all_words) - 1
        explanation = (
            f"Added checksum 0x{word:04X}: total sum = 0x{folded:04X} (Expected 0xFFFF)"
            if is_checksum
            else f"Added word 0x{word:04X}: sum = 0x{folded:04X}"
        )

        verification_steps.append(
            ChecksumAdditionStep(
                step_index=idx + 1,
                word_hex=f"{word:04X}",
                word_value=word,
                sum_before_addition=before,
                sum_after_addition=after,
                carry_detected=carry,
                sum_after_carry_fold=folded,
                explanation=explanation,
            )
        )

    while (accumulator >> 16) > 0:
        accumulator = (accumulator & 0xFFFF) + (accumulator >> 16)

    total_sum = accumulator & 0xFFFF
    inverted = (~total_sum) & 0xFFFF
    is_valid = total_sum == 0xFFFF or inverted == 0

    status_message = (
        "Checksum verified successfully. One's-complement sum is 0xFFFF (no corruption detected)."
        if is_valid
        else f"Checksum error detected! One's-complement sum is 0x{total_sum:04X} (expected 0xFFFF). Data is corrupted."
    )

    return ChecksumVerifyResult(
        payload_words=list(payload_words),
        checksum_tested=checksum,
        words_with_checksum=all_words,
        total_accumulated_sum=total_sum,
        inverted_result=inverted,
        is_valid=is_valid,
        error_detected=not is_valid,
        verification_steps=verification_steps,
        status_message=status_message,
    )


@dataclass
class ChecksumResultWrapper:
    checksum_value: int
    hex_str: str


def internet_checksum(data: bytes | list[int] | str) -> ChecksumCalculationResult:
    if isinstance(data, (bytes, bytearray)):
        words = parse_bytes_to_16bit_words(bytes(data))
    elif isinstance(data, str):
        words = parse_hex_to_16bit_words(data)
    else:
        words = list(data)
    return calculate_internet_checksum(words)


def parse_checksum_word(checksum: int | str) -> int:
    """Normalise a checksum supplied as an int or a hexadecimal string (with or without 0x)."""
    if isinstance(checksum, bool):  # guard: bool is an int subclass
        raise ValueError("Checksum must be an integer or hexadecimal string")
    if isinstance(checksum, int):
        if not (0 <= checksum <= 0xFFFF):
            raise ValueError("Checksum must fit in 16 bits (0x0000 - 0xFFFF)")
        return checksum
    if isinstance(checksum, str):
        clean = checksum.strip().lower()
        if clean.startswith("0x"):
            clean = clean[2:]
        if not clean:
            raise ValueError("Checksum cannot be empty")
        if any(c not in "0123456789abcdef" for c in clean):
            raise ValueError(f"Invalid hexadecimal checksum '{checksum}'")
        value = int(clean, 16)
        if value > 0xFFFF:
            raise ValueError("Checksum must fit in 16 bits (0x0000 - 0xFFFF)")
        return value
    raise ValueError("Checksum must be an integer or hexadecimal string")


def verify_checksum(data: bytes | list[int] | str, checksum: int | str) -> ChecksumVerifyResult:
    if isinstance(data, (bytes, bytearray)):
        words = parse_bytes_to_16bit_words(bytes(data))
    elif isinstance(data, str):
        words = parse_hex_to_16bit_words(data)
    else:
        words = list(data)
    return verify_internet_checksum(words, parse_checksum_word(checksum))
