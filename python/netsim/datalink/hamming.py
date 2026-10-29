"""Hamming Code (m, r) forward error correction and detection with SECDED."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any


class ParityMode(str, Enum):
    EVEN = "even"
    ODD = "odd"


@dataclass
class ParityBitDetail:
    parity_index: int  # 1-indexed power of 2
    label: str  # "p1", "p2", "p4"
    covered_indices: list[int]
    covered_bits: list[int]
    parity_value: int
    formula: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "parity_index": self.parity_index,
            "label": self.label,
            "covered_indices": self.covered_indices,
            "covered_bits": self.covered_bits,
            "parity_value": self.parity_value,
            "formula": self.formula,
        }


@dataclass
class HammingBitInfo:
    position: int
    is_parity: bool
    bit_value: int
    label: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "position": self.position,
            "is_parity": self.is_parity,
            "bit_value": self.bit_value,
            "label": self.label,
        }


@dataclass
class HammingEncodeResult:
    raw_data_bits: str
    data_bit_count: int
    parity_bit_count: int
    total_bit_count: int
    parity_mode: ParityMode
    encoded_bits: str
    bit_positions: list[HammingBitInfo]
    parity_details: list[ParityBitDetail]
    overall_parity: int
    encoded_bits_secded: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "raw_data_bits": self.raw_data_bits,
            "data_bit_count": self.data_bit_count,
            "parity_bit_count": self.parity_bit_count,
            "total_bit_count": self.total_bit_count,
            "parity_mode": self.parity_mode.value,
            "encoded_bits": self.encoded_bits,
            "bit_positions": [b.to_dict() for b in self.bit_positions],
            "parity_details": [p.to_dict() for p in self.parity_details],
            "overall_parity": self.overall_parity,
            "encoded_bits_secded": self.encoded_bits_secded,
        }


@dataclass
class HammingVerifyResult:
    received_bits: str
    parity_mode: ParityMode
    syndrome_bits: str
    syndrome_value: int
    has_error: bool
    is_correctable: bool
    error_type: str
    error_position: int | None
    corrected_bits: str | None
    extracted_data_bits: str | None
    syndrome_details: list[ParityBitDetail]
    status_message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "received_bits": self.received_bits,
            "parity_mode": self.parity_mode.value,
            "syndrome_bits": self.syndrome_bits,
            "syndrome_value": self.syndrome_value,
            "has_error": self.has_error,
            "is_correctable": self.is_correctable,
            "error_type": self.error_type,
            "error_position": self.error_position,
            "corrected_bits": self.corrected_bits,
            "extracted_data_bits": self.extracted_data_bits,
            "syndrome_details": [s.to_dict() for s in self.syndrome_details],
            "status_message": self.status_message,
        }


def calculate_required_parity_bits(data_bits_len: int) -> int:
    r = 1
    while (1 << r) < (data_bits_len + r + 1):
        r += 1
    return r


def is_power_of_two(n: int) -> bool:
    return n > 0 and (n & (n - 1)) == 0


def encode_hamming(data_bits: str, parity_mode: ParityMode) -> HammingEncodeResult:
    clean_data = "".join(c for c in data_bits if not c.isspace())
    if not clean_data:
        raise ValueError("Hamming encode error: data bits cannot be empty")
    for i, ch in enumerate(clean_data):
        if ch not in ("0", "1"):
            raise ValueError(f"Hamming encode error: invalid character '{ch}' at index {i}. Must be '0' or '1'.")

    m = len(clean_data)
    r = calculate_required_parity_bits(m)
    total_len = m + r

    codeword = [0] * (total_len + 1)
    data_chars = iter(clean_data)
    bit_positions = []

    data_idx = 1
    for pos in range(1, total_len + 1):
        if is_power_of_two(pos):
            bit_positions.append(
                HammingBitInfo(
                    position=pos,
                    is_parity=True,
                    bit_value=0,
                    label=f"p{pos}",
                )
            )
        else:
            bit_val = int(next(data_chars))
            codeword[pos] = bit_val
            bit_positions.append(
                HammingBitInfo(
                    position=pos,
                    is_parity=False,
                    bit_value=bit_val,
                    label=f"d{data_idx}",
                )
            )
            data_idx += 1

    parity_details = []
    for k in range(r):
        p_pos = 1 << k
        covered_indices = []
        covered_bits = []
        s = 0

        for pos in range(1, total_len + 1):
            if (pos & p_pos) != 0 and pos != p_pos:
                covered_indices.append(pos)
                covered_bits.append(codeword[pos])
                s ^= codeword[pos]

        parity_value = s if parity_mode == ParityMode.EVEN else (s ^ 1)
        codeword[p_pos] = parity_value

        for b in bit_positions:
            if b.position == p_pos:
                b.bit_value = parity_value
                break

        formula = (
            f"p{p_pos} = {'EvenParity' if parity_mode == ParityMode.EVEN else 'OddParity'} "
            f"over positions {covered_indices}"
        )

        parity_details.append(
            ParityBitDetail(
                parity_index=p_pos,
                label=f"p{p_pos}",
                covered_indices=covered_indices,
                covered_bits=covered_bits,
                parity_value=parity_value,
                formula=formula,
            )
        )

    encoded_bits = "".join(str(codeword[i]) for i in range(1, total_len + 1))
    overall_sum = 0
    for i in range(1, total_len + 1):
        overall_sum ^= codeword[i]
    overall_parity = overall_sum if parity_mode == ParityMode.EVEN else (overall_sum ^ 1)
    encoded_bits_secded = f"{overall_parity}{encoded_bits}"

    return HammingEncodeResult(
        raw_data_bits=clean_data,
        data_bit_count=m,
        parity_bit_count=r,
        total_bit_count=total_len,
        parity_mode=parity_mode,
        encoded_bits=encoded_bits,
        bit_positions=bit_positions,
        parity_details=parity_details,
        overall_parity=overall_parity,
        encoded_bits_secded=encoded_bits_secded,
    )


def verify_and_correct_hamming(
    codeword_str: str,
    parity_mode: ParityMode,
    secded: bool = False,
) -> HammingVerifyResult:
    """Syndrome-decode a Hamming codeword, optionally using the SECDED overall-parity bit.

    ``secded=False`` (the default, and the historical behaviour) decodes a plain Hamming
    codeword. That is a genuine single-error-correcting code, but it is *not* able to tell a
    double-bit error apart from a single-bit one: two flips simply produce a different nonzero
    syndrome, which plain decoding then "corrects" into a third, wrong codeword.

    ``secded=True`` expects the extended word produced by :func:`encode_hamming` --
    ``encoded_bits_secded``, i.e. the overall parity bit P0 followed by the Hamming codeword.
    Combining the syndrome with the overall-parity check is what actually delivers SECDED:

    ==========================  =========================================
    syndrome / overall parity   diagnosis
    ==========================  =========================================
    S == 0, parity ok           no error
    S == 0, parity bad          single error in P0 itself (correctable)
    S != 0, parity bad          single error at position S (correctable)
    S != 0, parity ok           DOUBLE-bit error: detected, NOT correctable
    ==========================  =========================================
    """
    clean_code = "".join(c for c in codeword_str if not c.isspace())
    if not clean_code:
        raise ValueError("Hamming verify error: codeword cannot be empty")
    for i, ch in enumerate(clean_code):
        if ch not in ("0", "1"):
            raise ValueError(f"Hamming verify error: invalid character '{ch}' at index {i}. Must be '0' or '1'.")

    if secded:
        if len(clean_code) < 4:
            raise ValueError("SECDED codeword must have at least 4 bits (overall parity P0 plus Hamming(3,1))")
        payload_str = clean_code[1:]
        overall_bit = int(clean_code[0])
    else:
        payload_str = clean_code
        overall_bit = None

    n = len(payload_str)
    if n < 3:
        raise ValueError("Hamming codeword must have at least 3 bits (e.g. Hamming(3,1))")

    bits = [0] + [int(ch) for ch in payload_str]

    r = 0
    while (1 << r) <= n:
        r += 1

    syndrome_details = []
    syndrome_bits_vec = []
    syndrome_value = 0

    for k in range(r):
        p_pos = 1 << k
        covered_indices = []
        covered_bits = []
        chk = 0

        for pos in range(1, n + 1):
            if (pos & p_pos) != 0:
                covered_indices.append(pos)
                covered_bits.append(bits[pos])
                chk ^= bits[pos]

        syn_bit = chk if parity_mode == ParityMode.EVEN else (chk ^ 1)
        syndrome_bits_vec.append(syn_bit)
        if syn_bit == 1:
            syndrome_value += p_pos

        formula = f"s{p_pos} = XOR({covered_indices}) -> {syn_bit}"
        syndrome_details.append(
            ParityBitDetail(
                parity_index=p_pos,
                label=f"s{p_pos}",
                covered_indices=covered_indices,
                covered_bits=covered_bits,
                parity_value=syn_bit,
                formula=formula,
            )
        )

    syndrome_bits = "".join(str(b) for b in reversed(syndrome_bits_vec))

    # SECDED: fold in the overall-parity bit so an even number of flips is distinguishable from
    # an odd one. For a valid extended word the XOR of *all* n+1 bits is 0 under even parity and
    # 1 under odd parity (that is exactly how encode_hamming builds P0), so `overall_check` is the
    # parity of the number of flipped bits.
    if secded and overall_bit is not None:
        expected_overall = 0 if parity_mode == ParityMode.EVEN else 1
        actual_overall = overall_bit
        for pos in range(1, n + 1):
            actual_overall ^= bits[pos]
        overall_check = actual_overall ^ expected_overall

        if syndrome_value != 0 and overall_check == 0:
            return HammingVerifyResult(
                received_bits=clean_code,
                parity_mode=parity_mode,
                syndrome_bits=syndrome_bits,
                syndrome_value=syndrome_value,
                has_error=True,
                is_correctable=False,
                error_type="double_bit_detected",
                error_position=None,
                corrected_bits=None,
                extracted_data_bits=None,
                syndrome_details=syndrome_details,
                status_message=(
                    "Double-bit error detected by SECDED and NOT corrected: the Hamming syndrome is "
                    f"nonzero ({syndrome_value}) while the overall parity check is clean, which means an "
                    "even number of bits flipped. Correcting anyway would silently produce wrong data, "
                    "so no corrected codeword is reported."
                ),
            )

        if syndrome_value == 0 and overall_check == 1:
            corrected_payload = "".join(str(bits[i]) for i in range(1, n + 1))
            extracted = "".join(str(bits[pos]) for pos in range(1, n + 1) if not is_power_of_two(pos))
            return HammingVerifyResult(
                received_bits=clean_code,
                parity_mode=parity_mode,
                syndrome_bits=syndrome_bits,
                syndrome_value=0,
                has_error=True,
                is_correctable=True,
                error_type="single_bit_overall_parity",
                error_position=0,
                corrected_bits=f"{1 - overall_bit}{corrected_payload}",
                extracted_data_bits=extracted,
                syndrome_details=syndrome_details,
                status_message=(
                    "Single-bit error detected in the SECDED overall parity bit (P0) and corrected: the "
                    "Hamming syndrome is zero but the overall parity check failed."
                ),
            )

        # Single-bit error inside the payload: fall through to the standard correction below, but
        # return the corrected *extended* word so it can be compared with what was received.
        if syndrome_value != 0:
            corrected_vec = list(bits)
            corrected_vec[syndrome_value] ^= 1
            corrected_payload = "".join(str(corrected_vec[i]) for i in range(1, n + 1))
            extracted = "".join(str(corrected_vec[pos]) for pos in range(1, n + 1) if not is_power_of_two(pos))
            expected_p0 = 0 if parity_mode == ParityMode.EVEN else 1
            for pos in range(1, n + 1):
                expected_p0 ^= corrected_vec[pos]
            return HammingVerifyResult(
                received_bits=clean_code,
                parity_mode=parity_mode,
                syndrome_bits=syndrome_bits,
                syndrome_value=syndrome_value,
                has_error=True,
                is_correctable=True,
                error_type="single_bit",
                error_position=syndrome_value + 1,
                corrected_bits=f"{expected_p0}{corrected_payload}",
                extracted_data_bits=extracted,
                syndrome_details=syndrome_details,
                status_message=(
                    f"Single-bit error detected by SECDED and corrected at payload position "
                    f"{syndrome_value} (1-indexed within the Hamming codeword; bit "
                    f"{syndrome_value + 1} of the extended word)."
                ),
            )

    has_error = syndrome_value != 0

    if not has_error:
        extracted = "".join(str(bits[pos]) for pos in range(1, n + 1) if not is_power_of_two(pos))
        return HammingVerifyResult(
            received_bits=clean_code,
            parity_mode=parity_mode,
            syndrome_bits=syndrome_bits,
            syndrome_value=0,
            has_error=False,
            is_correctable=True,
            error_type="none",
            error_position=None,
            corrected_bits=clean_code,
            extracted_data_bits=extracted,
            syndrome_details=syndrome_details,
            status_message="Codeword is valid. No bit errors detected.",
        )

    if syndrome_value <= n:
        corrected_vec = list(bits)
        corrected_vec[syndrome_value] ^= 1

        corrected_str = "".join(str(corrected_vec[i]) for i in range(1, n + 1))
        extracted = "".join(str(corrected_vec[pos]) for pos in range(1, n + 1) if not is_power_of_two(pos))

        return HammingVerifyResult(
            received_bits=clean_code,
            parity_mode=parity_mode,
            syndrome_bits=syndrome_bits,
            syndrome_value=syndrome_value,
            has_error=True,
            is_correctable=True,
            error_type="single_bit",
            error_position=syndrome_value,
            corrected_bits=corrected_str,
            extracted_data_bits=extracted,
            syndrome_details=syndrome_details,
            status_message=f"Single-bit error detected and corrected at position {syndrome_value} (1-indexed).",
        )
    else:
        return HammingVerifyResult(
            received_bits=clean_code,
            parity_mode=parity_mode,
            syndrome_bits=syndrome_bits,
            syndrome_value=syndrome_value,
            has_error=True,
            is_correctable=False,
            error_type="multiple_bit_unrecoverable",
            error_position=syndrome_value,
            corrected_bits=None,
            extracted_data_bits=None,
            syndrome_details=syndrome_details,
            status_message=(
                f"Unrecoverable multiple-bit error: calculated syndrome {syndrome_value} exceeds codeword length {n}."
            ),
        )


@dataclass
class HammingDecodeResult:
    has_error: bool
    corrected_bit_position: int | None
    decoded_data_bits: str


def _coerce_parity_mode(even_parity: bool | ParityMode) -> ParityMode:
    """Accept either a bool or an explicit ParityMode.

    The parameter is documented as a bool, so passing ``ParityMode.ODD`` used to be silently
    treated as *even* parity (a non-empty string enum is truthy) and produced a codeword that did
    not match the caller's stated mode with no error at all. Accept the enum explicitly instead.
    """
    if isinstance(even_parity, ParityMode):
        return even_parity
    return ParityMode.EVEN if even_parity else ParityMode.ODD


def hamming_encode(data_bits: str, even_parity: bool | ParityMode = True) -> HammingEncodeResult:
    return encode_hamming(data_bits, _coerce_parity_mode(even_parity))


def hamming_decode(
    codeword_str: str,
    even_parity: bool | ParityMode = True,
    secded: bool = False,
) -> HammingDecodeResult:
    res = verify_and_correct_hamming(codeword_str, _coerce_parity_mode(even_parity), secded=secded)
    return HammingDecodeResult(
        # `verify_and_correct_hamming` reports the clean case as error_type == "none"; this used to
        # compare against "no_error", which is never produced, so hamming_decode claimed an error
        # for every codeword including valid ones.
        has_error=res.has_error,
        corrected_bit_position=res.error_position,
        decoded_data_bits=res.extracted_data_bits or "",
    )
