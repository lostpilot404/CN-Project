import React, { useState } from 'react';
import {
  Binary,
  ShieldCheck,
  ShieldAlert,
  Hash,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { api } from '../../lib/api';
import {
  ParityMode,
  HammingEncodeResult,
  HammingVerifyResult,
  CrcCalculationResult,
  CrcVerifyResult,
  ChecksumCalculationResult,
  ChecksumVerifyResult,
} from '../../types/datalink';
import { FlowControlStudio } from './FlowControlStudio';
import { MacStudio } from './MacStudio';

type CategoryTab = 'error_control' | 'flow_control' | 'multiple_access';
type SubTab = 'hamming' | 'crc' | 'checksum';

export const DataLinkWorkspace: React.FC = () => {
  const [categoryTab, setCategoryTab] = useState<CategoryTab>('error_control');
  const [activeTab, setActiveTab] = useState<SubTab>('hamming');


  // ==========================================
  // HAMMING STATE
  // ==========================================
  const [hammingData, setHammingData] = useState<string>('1011');
  const [hammingParityMode, setHammingParityMode] = useState<ParityMode>('Even');
  const [hammingEncodeRes, setHammingEncodeRes] = useState<HammingEncodeResult | null>(null);
  const [hammingTestCodeword, setHammingTestCodeword] = useState<string>('');
  const [hammingVerifyRes, setHammingVerifyRes] = useState<HammingVerifyResult | null>(null);
  const [hammingLoading, setHammingLoading] = useState<boolean>(false);
  const [hammingError, setHammingError] = useState<string | null>(null);

  // ==========================================
  // CRC STATE
  // ==========================================
  const [crcData, setCrcData] = useState<string>('11010011101100');
  const [crcPreset, setCrcPreset] = useState<string>('Custom');
  const [crcPoly, setCrcPoly] = useState<string>('1011');
  const [crcCalcRes, setCrcCalcRes] = useState<CrcCalculationResult | null>(null);
  const [crcTestFrame, setCrcTestFrame] = useState<string>('');
  const [crcVerifyRes, setCrcVerifyRes] = useState<CrcVerifyResult | null>(null);
  const [crcLoading, setCrcLoading] = useState<boolean>(false);
  const [crcError, setCrcError] = useState<string | null>(null);

  // ==========================================
  // CHECKSUM STATE
  // ==========================================
  const [checksumHexInput, setChecksumHexInput] = useState<string>('0001 F203 F4F5 F6F7');
  const [checksumCalcRes, setChecksumCalcRes] = useState<ChecksumCalculationResult | null>(null);
  const [checksumTestHex, setChecksumTestHex] = useState<string>('');
  const [checksumTestWord, setChecksumTestWord] = useState<string>('');
  const [checksumVerifyRes, setChecksumVerifyRes] = useState<ChecksumVerifyResult | null>(null);
  const [checksumLoading, setChecksumLoading] = useState<boolean>(false);
  const [checksumError, setChecksumError] = useState<string | null>(null);

  // ==========================================
  // HAMMING ACTIONS
  // ==========================================
  const handleHammingEncode = async () => {
    setHammingLoading(true);
    setHammingError(null);
    try {
      const res = await api.calculateHammingEncode(hammingData, hammingParityMode);
      setHammingEncodeRes(res);
      // Drive the error-injection tester with the extended SECDED word (P0 + Hamming codeword).
      // Using the plain codeword here meant the verifier had no overall-parity bit to consult,
      // so a double-bit flip was reported as a corrected single-bit error with wrong data.
      setHammingTestCodeword(res.encoded_bits_secded);
      setHammingVerifyRes(null);
    } catch (err: unknown) {
      setHammingEncodeRes(null);
      setHammingError(err instanceof Error ? err.message : String(err));
    } finally {
      setHammingLoading(false);
    }
  };

  const handleHammingVerify = async (codeToVerify?: string) => {
    const code = codeToVerify ?? hammingTestCodeword;
    if (!code) return;
    setHammingLoading(true);
    setHammingError(null);
    try {
      const res = await api.verifyAndCorrectHamming(code, hammingParityMode, true);
      setHammingVerifyRes(res);
    } catch (err: unknown) {
      setHammingVerifyRes(null);
      setHammingError(err instanceof Error ? err.message : String(err));
    } finally {
      setHammingLoading(false);
    }
  };

  const handleToggleCodewordBit = (bitIndexZeroBased: number) => {
    if (!hammingTestCodeword) return;
    const chars = hammingTestCodeword.split('');
    chars[bitIndexZeroBased] = chars[bitIndexZeroBased] === '0' ? '1' : '0';
    const updated = chars.join('');
    setHammingTestCodeword(updated);
    handleHammingVerify(updated);
  };

  // ==========================================
  // CRC ACTIONS
  // ==========================================
  const handleCrcPresetChange = (preset: string) => {
    setCrcPreset(preset);
    if (preset === 'CRC-8') {
      setCrcPoly('100000111');
    } else if (preset === 'CRC-16-IBM') {
      setCrcPoly('11000000000000101');
    } else if (preset === 'CRC-16-CCITT') {
      setCrcPoly('10001000000100001');
    } else if (preset === 'CRC-32-IEEE') {
      setCrcPoly('100000100110000010001110110110111');
    } else {
      setCrcPoly('1011');
    }
  };

  const handleCrcCalculate = async () => {
    setCrcLoading(true);
    setCrcError(null);
    try {
      const res = await api.calculateCrc(crcData, crcPoly, crcPreset);
      setCrcCalcRes(res);
      setCrcTestFrame(res.transmitted_codeword);
      setCrcVerifyRes(null);
    } catch (err: unknown) {
      setCrcCalcRes(null);
      setCrcError(err instanceof Error ? err.message : String(err));
    } finally {
      setCrcLoading(false);
    }
  };

  const handleCrcVerify = async (frameToVerify?: string) => {
    const frame = frameToVerify ?? crcTestFrame;
    if (!frame) return;
    setCrcLoading(true);
    setCrcError(null);
    try {
      const res = await api.verifyCrc(frame, crcPoly, crcPreset);
      setCrcVerifyRes(res);
    } catch (err: unknown) {
      setCrcVerifyRes(null);
      setCrcError(err instanceof Error ? err.message : String(err));
    } finally {
      setCrcLoading(false);
    }
  };

  const handleToggleCrcBit = (bitIndex: number) => {
    if (!crcTestFrame) return;
    const chars = crcTestFrame.split('');
    chars[bitIndex] = chars[bitIndex] === '0' ? '1' : '0';
    const updated = chars.join('');
    setCrcTestFrame(updated);
    handleCrcVerify(updated);
  };

  // ==========================================
  // CHECKSUM ACTIONS
  // ==========================================
  const handleChecksumCalculate = async () => {
    setChecksumLoading(true);
    setChecksumError(null);
    try {
      const res = await api.calculateInternetChecksum(checksumHexInput);
      setChecksumCalcRes(res);
      setChecksumTestHex(checksumHexInput);
      setChecksumTestWord(res.checksum_hex);
      setChecksumVerifyRes(null);
    } catch (err: unknown) {
      setChecksumCalcRes(null);
      setChecksumError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecksumLoading(false);
    }
  };

  const handleChecksumVerify = async (corrupt: boolean = false) => {
    if (!checksumCalcRes) return;
    setChecksumLoading(true);
    setChecksumError(null);
    try {
      let payload = checksumTestHex;
      let csum = checksumTestWord;
      if (corrupt) {
        // Toggle bit in checksum word
        const val = parseInt(csum.replace(/^0x/i, ''), 16) ^ 0x0001;
        csum = val.toString(16).toUpperCase().padStart(4, '0');
        setChecksumTestWord(csum);
      }
      const res = await api.verifyInternetChecksum(payload, csum);
      setChecksumVerifyRes(res);
    } catch (err: unknown) {
      setChecksumVerifyRes(null);
      setChecksumError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecksumLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Workspace Header */}
      <div className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-4 sm:px-6 py-3">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
            <Binary className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-200">
              Algorithm Studio
            </h1>
            <p className="text-[11px] text-slate-400">
              Deterministic Python implementations of error control, flow control and multiple access
            </p>
          </div>
        </div>
      </div>

      {/* Category and algorithm switchers */}
      <div className="border-b border-slate-800/80 px-4 sm:px-6 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
            <button
              onClick={() => setCategoryTab('error_control')}
              className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center space-x-1.5 ${
                categoryTab === 'error_control'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Error Control</span>
            </button>
            <button
              onClick={() => setCategoryTab('flow_control')}
              className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center space-x-1.5 ${
                categoryTab === 'flow_control'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Flow Control</span>
            </button>
            <button
              onClick={() => setCategoryTab('multiple_access')}
              className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center space-x-1.5 ${
                categoryTab === 'multiple_access'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Multiple Access</span>
            </button>
          </div>

          {/* Algorithm Subtabs for Error Control */}
          {categoryTab === 'error_control' && (
            <div className="flex flex-wrap items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700/60 text-xs max-w-full">
              <button
                onClick={() => setActiveTab('hamming')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  activeTab === 'hamming'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Hamming Code
              </button>
              <button
                onClick={() => setActiveTab('crc')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  activeTab === 'crc'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                CRC Polynomial
              </button>
              <button
                onClick={() => setActiveTab('checksum')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  activeTab === 'checksum'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Internet Checksum
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Workspace Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-7xl w-full mx-auto">
        {categoryTab === 'flow_control' && <FlowControlStudio />}
        {categoryTab === 'multiple_access' && <MacStudio />}
        {categoryTab === 'error_control' && (
          <>
            {/* ========================================================================= */}
            {/* HAMMING CODE STUDIO */}
            {/* ========================================================================= */}

        {activeTab === 'hamming' && (
          <div className="space-y-6">
            {/* Top Parameters Card */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-5 h-5 text-brand-400" />
                  <span className="text-sm font-semibold text-slate-200">
                    Hamming Code Configuration
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-400">Quick Data Presets:</span>
                  {['1011', '1100101', '1111', '010101'].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setHammingData(preset)}
                      className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium text-slate-300">
                    Input Data Bits (Raw Binary)
                  </label>
                  <input aria-label="Input Data Bits (Raw Binary)"
                    type="text"
                    value={hammingData}
                    onChange={(e) => setHammingData(e.target.value.replace(/[^01]/g, ''))}
                    placeholder="Enter binary bits, e.g. 1011"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-sm font-mono text-brand-300 tracking-wider focus:outline-none focus:border-brand-500 transition"
                  />
                  <p className="text-[11px] text-slate-400">
                    Configurable data bit width: Parity bits are placed dynamically at powers of two (positions 1, 2, 4, 8, ...).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Parity Mode</label>
                  <div className="flex space-x-2">
                    {(['Even', 'Odd'] as ParityMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setHammingParityMode(mode)}
                        className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition ${
                          hammingParityMode === mode
                            ? 'bg-brand-600/20 border-brand-500 text-brand-300 shadow-sm'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                        }`}
                      >
                        {mode} Parity
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleHammingEncode}
                  disabled={hammingLoading || !hammingData}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:text-slate-300 text-white shadow-lg shadow-brand-600/20 transition flex items-center space-x-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Encode into Hamming Codeword</span>
                </button>
              </div>

              {hammingError && (
                <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{hammingError}</span>
                </div>
              )}
            </div>

            {/* Authoritative Encoding Results */}
            {hammingEncodeRes && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Codeword & Bit Layout */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <span className="text-xs font-semibold text-slate-200">
                      Codeword output
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-brand-950 text-brand-300 border border-brand-800">
                      Hamming({hammingEncodeRes.total_bit_count},{hammingEncodeRes.data_bit_count}) + SECDED
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div className="text-xs text-slate-400">
                      Position Breakdown (1-indexed, powers-of-two reserved for parity):
                    </div>
                    {/* Visual Bit Boxes */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {hammingEncodeRes.bit_positions.map((b) => (
                        <div
                          key={b.position}
                          className={`flex flex-col items-center justify-center p-2 rounded-xl border min-w-[50px] transition ${
                            b.is_parity
                              ? 'bg-amber-950/40 border-amber-600/50 text-amber-300'
                              : 'bg-brand-950/40 border-brand-600/50 text-brand-200'
                          }`}
                        >
                          <span className="text-[10px] font-mono text-slate-400">
                            {b.label} (pos {b.position})
                          </span>
                          <span className="text-base font-bold font-mono mt-0.5">
                            {b.bit_value}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Standard Codeword:</span>
                        <span className="font-mono text-sm text-emerald-400 font-semibold tracking-widest">
                          {hammingEncodeRes.encoded_bits}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">SECDED Overall Parity (P0):</span>
                        <span className="font-mono text-sm text-amber-400 font-semibold">
                          {hammingEncodeRes.overall_parity}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Codeword with SECDED:</span>
                        <span className="font-mono text-sm text-brand-300 font-semibold tracking-widest">
                          {hammingEncodeRes.encoded_bits_secded}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Parity Calculation Step Trace */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <span className="text-xs font-semibold text-slate-200">
                      Step-by-Step Parity Bit Traces
                    </span>
                    <span className="text-[11px] text-slate-400">Computed by the Python engine</span>
                  </div>

                  <div className="space-y-2.5 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="pb-2 font-medium">Parity Bit</th>
                          <th className="pb-2 font-medium">Covered Indices</th>
                          <th className="pb-2 font-medium">Covered Bits</th>
                          <th className="pb-2 font-medium text-right">Computed Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                        {hammingEncodeRes.parity_details.map((p) => (
                          <tr key={p.parity_index} className="hover:bg-slate-800/30">
                            <td className="py-2 font-bold text-amber-400">{p.label} (pos {p.parity_index})</td>
                            <td className="py-2 text-slate-300">[{p.covered_indices.join(', ')}]</td>
                            <td className="py-2 text-brand-300">[{p.covered_bits.join(', ')}]</td>
                            <td className="py-2 text-right font-bold text-emerald-400">
                              {p.parity_value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Error Injection & Correction Section */}
            {hammingEncodeRes && (
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center space-x-2">
                    <ShieldAlert className="w-5 h-5 text-amber-400" />
                    <span className="text-sm font-semibold text-slate-200">
                      Interactive Error-Bit Injection & Syndrome Correction
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    Click any bit below to flip it and test single/double bit error detection
                  </span>
                </div>

                {/* Clickable Bit Flipping UI */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-300">
                    Received Codeword (Click a bit to flip):
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {hammingTestCodeword.split('').map((bit, idx) => {
                      const pos = idx + 1;
                      const isCleanBit = bit === hammingEncodeRes.encoded_bits_secded[idx];
                      return (
                        <button
                          key={pos}
                          onClick={() => handleToggleCodewordBit(idx)}
                          className={`flex flex-col items-center justify-center px-3 py-2 rounded-xl border text-sm font-mono transition-all transform active:scale-95 ${
                            !isCleanBit
                              ? 'bg-rose-950 border-rose-500 text-rose-200 shadow-lg shadow-rose-950/50'
                              : 'bg-slate-950 border-slate-700 text-slate-200 hover:border-brand-400'
                          }`}
                        >
                          <span className="text-[10px] text-slate-400">
                            {idx === 0 ? 'P0 (SECDED)' : `pos ${pos - 1}`}
                          </span>
                          <span className="text-base font-bold">{bit}</span>
                          {!isCleanBit && (
                            <span className="text-[9px] text-rose-400 font-sans font-bold">
                              FLIPPED
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => handleHammingVerify()}
                    disabled={hammingLoading || !hammingTestCodeword}
                    className="px-5 py-2 rounded-xl text-xs font-semibold bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:text-slate-300 text-white shadow-lg shadow-brand-600/20 transition flex items-center space-x-2"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Run Syndrome Calculation & Correction</span>
                  </button>
                </div>

                {/* Syndrome & Correction Result Banner */}
                {hammingVerifyRes && (
                  <div
                    className={`mt-4 p-4 rounded-xl border ${
                      !hammingVerifyRes.has_error
                        ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-200'
                        : hammingVerifyRes.is_correctable
                        ? 'bg-amber-950/40 border-amber-700/60 text-amber-200'
                        : 'bg-rose-950/40 border-rose-700/60 text-rose-200'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2">
                        {!hammingVerifyRes.has_error ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                        ) : hammingVerifyRes.is_correctable ? (
                          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
                        )}
                        <div>
                          <span className="font-semibold text-xs tracking-wider block">
                            {!hammingVerifyRes.has_error
                              ? 'PASS — NO ERROR DETECTED'
                              : hammingVerifyRes.is_correctable
                              ? 'ERROR DETECTED & CORRECTED'
                              : 'UNRECOVERABLE MULTIPLE-BIT ERROR'}
                          </span>
                          <p className="text-xs mt-0.5 opacity-90">{hammingVerifyRes.status_message}</p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 font-mono text-xs">
                        <span className="px-2 py-1 rounded bg-black/40 border border-white/10">
                          Syndrome: {hammingVerifyRes.syndrome_bits} ({hammingVerifyRes.syndrome_value})
                        </span>
                        {hammingVerifyRes.error_position && (
                          <span className="px-2 py-1 rounded bg-black/40 border border-white/10 font-bold">
                            Errored Position: {hammingVerifyRes.error_position}
                          </span>
                        )}
                      </div>
                    </div>

                    {hammingVerifyRes.corrected_bits && (
                      <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                        <div className="p-2 rounded bg-black/30">
                          <span className="text-slate-400 block text-[10px]">CORRECTED CODEWORD:</span>
                          <span className="text-emerald-400 font-bold tracking-wider">
                            {hammingVerifyRes.corrected_bits}
                          </span>
                        </div>
                        <div className="p-2 rounded bg-black/30">
                          <span className="text-slate-400 block text-[10px]">EXTRACTED DATA:</span>
                          <span className="text-brand-300 font-bold tracking-wider">
                            {hammingVerifyRes.extracted_data_bits}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* CRC POLYNOMIAL STUDIO */}
        {/* ========================================================================= */}
        {activeTab === 'crc' && (
          <div className="space-y-6">
            {/* Top CRC Parameters Card */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center space-x-2">
                  <Hash className="w-5 h-5 text-brand-400" />
                  <span className="text-sm font-semibold text-slate-200">
                    Cyclic Redundancy Check (CRC) Modulo-2 Division
                  </span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-xs text-slate-400">Presets:</span>
                  {['CRC-8', 'CRC-16-IBM', 'CRC-16-CCITT', 'CRC-32-IEEE', 'Custom'].map((p) => (
                    <button
                      key={p}
                      onClick={() => handleCrcPresetChange(p)}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono transition border ${
                        crcPreset === p
                          ? 'bg-brand-600 text-white border-brand-500'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Data Bitstring</label>
                  <input aria-label="Data Bitstring"
                    type="text"
                    value={crcData}
                    onChange={(e) => setCrcData(e.target.value.replace(/[^01]/g, ''))}
                    placeholder="Enter binary frame payload, e.g. 11010011101100"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-sm font-mono text-brand-300 tracking-wider focus:outline-none focus:border-brand-500 transition"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">
                    Generator polynomial G(x) (binary bitstring)
                  </label>
                  <input aria-label="Generator polynomial G(x) (binary bitstring)"
                    type="text"
                    value={crcPoly}
                    onChange={(e) => {
                      setCrcPoly(e.target.value.replace(/[^01]/g, ''));
                      setCrcPreset('Custom');
                    }}
                    placeholder="Generator poly, e.g. 1011 (x^3 + x + 1)"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-sm font-mono text-amber-300 tracking-wider focus:outline-none focus:border-amber-500 transition"
                  />
                  <p className="text-[11px] text-slate-400">
                    Polynomial degree r = {Math.max(0, crcPoly.length - 1)}. Must begin with '1' and have degree at least 1.
                  </p>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleCrcCalculate}
                  disabled={crcLoading || !crcData || !crcPoly}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:text-slate-300 text-white shadow-lg shadow-brand-600/20 transition flex items-center space-x-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Execute Modulo-2 Polynomial Division</span>
                </button>
              </div>

              {crcError && (
                <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{crcError}</span>
                </div>
              )}
            </div>

            {/* Authoritative CRC Output */}
            {crcCalcRes && (
              <div className="space-y-6">
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <span className="text-xs font-semibold text-slate-200">
                      CRC remainder and transmitted frame
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-brand-950 text-brand-300 border border-brand-800">
                      Degree r = {crcCalcRes.degree}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">AUGMENTED DATA (+ r zero bits):</span>
                      <span className="text-slate-300 font-semibold break-all">
                        {crcCalcRes.augmented_bits}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">CRC REMAINDER:</span>
                      <span className="text-amber-400 font-bold text-sm tracking-wider">
                        {crcCalcRes.remainder}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">TRANSMITTED CODEWORD:</span>
                      <span className="text-emerald-400 font-bold text-sm tracking-wider break-all">
                        {crcCalcRes.transmitted_codeword}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Modulo-2 Division Step-by-Step Visualization Table */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <span className="text-xs font-semibold text-slate-200">
                      Step-by-Step Modulo-2 Division Trace
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Showing each bit shift, divisor choice, and XOR result
                    </span>
                  </div>

                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-900 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-2 px-3 font-medium">Step #</th>
                          <th className="py-2 px-3 font-medium">Current Window</th>
                          <th className="py-2 px-3 font-medium">Divisor Applied</th>
                          <th className="py-2 px-3 font-medium">XOR Result</th>
                          <th className="py-2 px-3 font-medium">Brought Down</th>
                          <th className="py-2 px-3 font-medium">Explanation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                        {crcCalcRes.division_steps.map((st) => (
                          <tr key={st.step_index} className="hover:bg-slate-800/30">
                            <td className="py-2 px-3 text-slate-400">{st.step_index}</td>
                            <td className="py-2 px-3 text-slate-200 font-semibold">{st.current_window}</td>
                            <td className="py-2 px-3 text-amber-400">{st.divisor_applied}</td>
                            <td className="py-2 px-3 text-emerald-400 font-semibold">{st.xor_result}</td>
                            <td className="py-2 px-3 text-brand-300">
                              {st.next_bit_brought_down !== null ? st.next_bit_brought_down : '—'}
                            </td>
                            <td className="py-2 px-3 text-slate-400 font-sans text-xs">
                              {st.explanation}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Receiver Frame Corruption & Verification */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center space-x-2">
                      <ShieldAlert className="w-5 h-5 text-amber-400" />
                      <span className="text-sm font-semibold text-slate-200">
                        Receiver Frame Verification & Bit Corruption
                      </span>
                    </div>
                    <span className="text-xs text-slate-400">Click a bit to corrupt transmitted frame</span>
                  </div>

                  {/* Clickable Bit Flipping UI for Frame */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-300">
                      Transmitted Codeword Frame:
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {crcTestFrame.split('').map((bit, idx) => {
                        const isClean = bit === crcCalcRes.transmitted_codeword[idx];
                        const isRemainderBit = idx >= crcCalcRes.input_bits.length;
                        return (
                          <button
                            key={idx}
                            onClick={() => handleToggleCrcBit(idx)}
                            className={`px-2.5 py-1.5 rounded-lg border font-mono text-xs transition transform active:scale-95 ${
                              !isClean
                                ? 'bg-rose-950 border-rose-500 text-rose-200 font-bold'
                                : isRemainderBit
                                ? 'bg-amber-950/40 border-amber-700/50 text-amber-300'
                                : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-brand-400'
                            }`}
                          >
                            <span className="block text-[9px] text-slate-500">
                              {isRemainderBit ? 'CRC' : `b${idx}`}
                            </span>
                            <span>{bit}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={() => handleCrcVerify()}
                      disabled={crcLoading || !crcTestFrame}
                      className="px-5 py-2 rounded-xl text-xs font-semibold bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:text-slate-300 text-white shadow-lg shadow-brand-600/20 transition flex items-center space-x-2"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Verify Received Frame via Modulo-2 Division</span>
                    </button>
                  </div>

                  {/* Verification Banner */}
                  {crcVerifyRes && (
                    <div
                      className={`mt-4 p-4 rounded-xl border ${
                        crcVerifyRes.is_valid
                          ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-200'
                          : 'bg-rose-950/40 border-rose-700/60 text-rose-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          {crcVerifyRes.is_valid ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                          ) : (
                            <XCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
                          )}
                          <div>
                            <span className="font-semibold text-xs tracking-wider block">
                              {crcVerifyRes.is_valid ? 'PASS — FRAME VERIFIED' : 'FAIL — CORRUPTED FRAME'}
                            </span>
                            <p className="text-xs mt-0.5 opacity-90">{crcVerifyRes.status_message}</p>
                          </div>
                        </div>

                        <div className="font-mono text-xs px-3 py-1 rounded bg-black/40 border border-white/10">
                          Remainder: {crcVerifyRes.remainder}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* INTERNET CHECKSUM STUDIO (RFC 1071) */}
        {/* ========================================================================= */}
        {activeTab === 'checksum' && (
          <div className="space-y-6">
            {/* Top Parameters Card */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center space-x-2">
                  <RotateCcw className="w-5 h-5 text-brand-400" />
                  <span className="text-sm font-semibold text-slate-200">
                    Standard 16-Bit Internet Checksum (RFC 1071)
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-400">Presets:</span>
                  {[
                    { label: 'RFC 1071 Example', val: '0001 F203 F4F5 F6F7' },
                    { label: 'IPv4 Header Sample', val: '4500 003C 1C46 4000 4006' },
                    { label: 'UDP Sample', val: '0035 0035 001C' },
                  ].map((p) => (
                    <button
                      key={p.label}
                      onClick={() => setChecksumHexInput(p.val)}
                      className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Payload Hexadecimal Words (16-bit words separated by space, commas, or prefixes)
                </label>
                <input aria-label="Payload Hexadecimal Words (16-bit words separated by space, commas, or prefixes)"
                  type="text"
                  value={checksumHexInput}
                  onChange={(e) => setChecksumHexInput(e.target.value)}
                  placeholder="e.g. 0x0001, 0xF203, 0xF4F5, 0xF6F7 or 0001 F203 F4F5 F6F7"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-sm font-mono text-brand-300 tracking-wider focus:outline-none focus:border-brand-500 transition"
                />
                <p className="text-[11px] text-slate-400">
                  Standard one's-complement addition with end-around carry folding and final one's complement. Odd-length byte arrays are zero-padded on the right per RFC 1071.
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleChecksumCalculate}
                  disabled={checksumLoading || !checksumHexInput}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:text-slate-300 text-white shadow-lg shadow-brand-600/20 transition flex items-center space-x-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Calculate 16-Bit Internet Checksum</span>
                </button>
              </div>

              {checksumError && (
                <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{checksumError}</span>
                </div>
              )}
            </div>

            {/* Authoritative Checksum Output */}
            {checksumCalcRes && (
              <div className="space-y-6">
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <span className="text-xs font-semibold text-slate-200">
                      Checksum result
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Evaluated {checksumCalcRes.total_words} 16-bit words
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">FOLDED ONE'S SUM:</span>
                      <span className="text-slate-200 font-bold text-sm tracking-wider">
                        0x{checksumCalcRes.uncomplemented_sum.toString(16).toUpperCase().padStart(4, '0')}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">CHECKSUM (HEX):</span>
                      <span className="text-amber-400 font-bold text-sm tracking-wider">
                        0x{checksumCalcRes.checksum_hex}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">CHECKSUM (BINARY):</span>
                      <span className="text-emerald-400 font-bold text-sm tracking-widest break-all">
                        {checksumCalcRes.checksum_binary}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Step-by-Step Addition & Carry Folding Trace */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <span className="text-xs font-semibold text-slate-200">
                      Step-by-Step One's-Complement Accumulation & Carry Folding
                    </span>
                    <span className="text-[11px] text-slate-400">RFC 1071 Section 2 Trace</span>
                  </div>

                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-900 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-2 px-3 font-medium">Step #</th>
                          <th className="py-2 px-3 font-medium">Word (Hex)</th>
                          <th className="py-2 px-3 font-medium">Sum Before</th>
                          <th className="py-2 px-3 font-medium">Sum After</th>
                          <th className="py-2 px-3 font-medium">Carry Detected</th>
                          <th className="py-2 px-3 font-medium">Folded Sum</th>
                          <th className="py-2 px-3 font-medium">Explanation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                        {checksumCalcRes.addition_steps.map((st) => (
                          <tr key={st.step_index} className="hover:bg-slate-800/30">
                            <td className="py-2 px-3 text-slate-400">{st.step_index}</td>
                            <td className="py-2 px-3 text-brand-300 font-semibold">0x{st.word_hex}</td>
                            <td className="py-2 px-3 text-slate-300">0x{st.sum_before_addition.toString(16).toUpperCase()}</td>
                            <td className="py-2 px-3 text-slate-200 font-semibold">0x{st.sum_after_addition.toString(16).toUpperCase()}</td>
                            <td className="py-2 px-3 text-amber-400">
                              {st.carry_detected > 0 ? `+0x${st.carry_detected.toString(16).toUpperCase()}` : '0'}
                            </td>
                            <td className="py-2 px-3 text-emerald-400 font-semibold">
                              0x{st.sum_after_carry_fold.toString(16).toUpperCase().padStart(4, '0')}
                            </td>
                            <td className="py-2 px-3 text-slate-400 font-sans text-xs">
                              {st.explanation}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Receiver Checksum Verification */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center space-x-2">
                      <ShieldCheck className="w-5 h-5 text-emerald-400" />
                      <span className="text-sm font-semibold text-slate-200">
                        Receiver Checksum Verification
                      </span>
                    </div>
                    <span className="text-xs text-slate-400">
                      RFC 1071 Rule: Sum of payload + Checksum Word == 0xFFFF (~0x0000)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-300">Payload Words to Verify</label>
                      <input aria-label="Payload Words to Verify"
                        type="text"
                        value={checksumTestHex}
                        onChange={(e) => setChecksumTestHex(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-xs font-mono text-slate-200"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-300">Checksum Word (Hex)</label>
                      <input aria-label="Checksum Word (Hex)"
                        type="text"
                        value={checksumTestWord}
                        onChange={(e) => setChecksumTestWord(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-xs font-mono text-amber-300"
                      />
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-2">
                    <button
                      onClick={() => handleChecksumVerify(true)}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-200 transition"
                    >
                      Inject 1-Bit Checksum Corruption
                    </button>
                    <button
                      onClick={() => handleChecksumVerify(false)}
                      disabled={checksumLoading || !checksumTestHex || !checksumTestWord}
                      className="px-5 py-2 rounded-xl text-xs font-semibold bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:text-slate-300 text-white shadow-lg shadow-brand-600/20 transition flex items-center space-x-2"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Verify Checksum on Receiver</span>
                    </button>
                  </div>

                  {/* Verification Result Banner */}
                  {checksumVerifyRes && (
                    <div
                      className={`mt-4 p-4 rounded-xl border ${
                        checksumVerifyRes.is_valid
                          ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-200'
                          : 'bg-rose-950/40 border-rose-700/60 text-rose-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          {checksumVerifyRes.is_valid ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                          ) : (
                            <XCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
                          )}
                          <div>
                            <span className="font-semibold text-xs tracking-wider block">
                              {checksumVerifyRes.is_valid ? 'PASS — CHECKSUM VALID' : 'FAIL — CHECKSUM MISMATCH'}
                            </span>
                            <p className="text-xs mt-0.5 opacity-90">{checksumVerifyRes.status_message}</p>
                          </div>
                        </div>

                        <div className="font-mono text-xs px-3 py-1 rounded bg-black/40 border border-white/10">
                          Accumulated: 0x{checksumVerifyRes.total_accumulated_sum.toString(16).toUpperCase().padStart(4, '0')} (Inverted: 0x{checksumVerifyRes.inverted_result.toString(16).toUpperCase().padStart(4, '0')})
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
};

