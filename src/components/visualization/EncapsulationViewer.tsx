import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Layers, Box, Cpu, Network, Binary, ShieldCheck } from 'lucide-react';
import { Packet } from '../../types/packet';
import { EncapsulationMode } from '../../types/visualization';

interface EncapsulationViewerProps {
  packet: Packet | null;
  onSelectLayer?: (layerIndex: number) => void;
  selectedLayerIndex?: number;
}

export const EncapsulationViewer: React.FC<EncapsulationViewerProps> = ({
  packet,
  onSelectLayer,
  selectedLayerIndex,
}) => {
  const [mode, setMode] = useState<EncapsulationMode>('encapsulation');

  if (!packet) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-400 bg-slate-900/40 rounded-2xl border border-slate-800/80">
        <Box className="w-12 h-12 text-slate-600 mb-3 stroke-[1.5]" />
        <h4 className="text-sm font-semibold text-slate-300">No Packet for Encapsulation</h4>
        <p className="text-xs text-slate-400 mt-1 max-w-[240px]">
          Select a packet from the timeline or injection list to inspect its 5-layer encapsulation transitions.
        </p>
      </div>
    );
  }

  const isTcp = packet.headers.transport.protocol.toUpperCase() === 'TCP';

  // Define 5 layers from 5 (top) to 1 (bottom)
  const layers = [
    {
      index: 5,
      name: 'Application Layer',
      protocol: packet.headers.application.protocol,
      headerBytes: 0, // payload container
      totalBytes: packet.size_bytes,
      summary: packet.headers.application.payload_preview,
      icon: Cpu,
      color: 'amber',
      borderClass: 'border-amber-500/40 bg-amber-950/20 text-amber-300',
      badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    },
    {
      index: 4,
      name: 'Transport Layer',
      protocol: isTcp ? 'TCP Segment' : 'UDP Datagram',
      headerBytes: isTcp ? 20 : 8,
      totalBytes: packet.size_bytes + (isTcp ? 20 : 8),
      summary: isTcp
        ? `Port ${packet.headers.transport.src_port} → ${packet.headers.transport.dst_port} | Seq: ${packet.headers.transport.seq_num ?? 'N/A'} | Flags: ${packet.headers.transport.flags.join(',') || 'ACK'}`
        : `Port ${packet.headers.transport.src_port} → ${packet.headers.transport.dst_port} | Datagram`,
      icon: Layers,
      color: 'cyan',
      borderClass: 'border-cyan-500/40 bg-cyan-950/20 text-cyan-300',
      badgeClass: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    },
    {
      index: 3,
      name: 'Network Layer',
      protocol: `IPv${packet.headers.network.version} Packet`,
      headerBytes: 20,
      totalBytes: packet.size_bytes + (isTcp ? 20 : 8) + 20,
      summary: `${packet.headers.network.src_ip} → ${packet.headers.network.dst_ip} | TTL: ${packet.headers.network.ttl}`,
      icon: Network,
      color: 'indigo',
      borderClass: 'border-indigo-500/40 bg-indigo-950/20 text-indigo-300',
      badgeClass: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    },
    {
      index: 2,
      name: 'Data Link Layer',
      protocol: packet.headers.datalink.frame_type || 'Ethernet II Frame',
      headerBytes: 18, // 14 bytes header + 4 bytes FCS
      totalBytes: packet.size_bytes + (isTcp ? 20 : 8) + 20 + 18,
      summary: `${packet.headers.datalink.src_mac} → ${packet.headers.datalink.dst_mac} | FCS: 0x${packet.headers.datalink.crc_fcs.toString(16).toUpperCase()}`,
      icon: ShieldCheck,
      color: 'emerald',
      borderClass: 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300',
      badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    },
    {
      index: 1,
      name: 'Physical Layer',
      protocol: 'Link Bitstream',
      headerBytes: 8, // preamble & SFD
      totalBytes: (packet.size_bytes + (isTcp ? 20 : 8) + 20 + 18) * 8,
      summary: `${packet.headers.physical?.bit_count || packet.size_bytes * 8} bits | Bandwidth: ${
        packet.headers.physical?.bandwidth_bps
          ? `${(packet.headers.physical.bandwidth_bps / 1_000_000).toFixed(0)} Mbps`
          : 'Not modeled'
      }`,
      icon: Binary,
      color: 'slate',
      borderClass: 'border-slate-500/40 bg-slate-900/40 text-slate-300',
      badgeClass: 'bg-slate-600/20 text-slate-300 border-slate-500/30',
    },
  ];

  // If in decapsulation mode, reverse stack order (1 up to 5)
  const displayLayers = mode === 'decapsulation' ? [...layers].reverse() : layers;

  return (
    <div data-testid="encapsulation-viewer" className="flex flex-col h-full bg-slate-950/80 p-4 select-none overflow-y-auto space-y-4">
      {/* Title & Mode Switcher */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>5-Layer Protocol Encapsulation</span>
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {mode === 'encapsulation'
              ? 'Sender Encapsulation: Headers prepend down the stack'
              : 'Receiver Decapsulation: Headers strip up the stack'}
          </p>
        </div>

        {/* Mode Toggle Buttons */}
        <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setMode('encapsulation')}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              mode === 'encapsulation'
                ? 'bg-cyan-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ArrowDown className="w-3.5 h-3.5" />
            <span>Encapsulate (↓)</span>
          </button>
          <button
            onClick={() => setMode('decapsulation')}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              mode === 'decapsulation'
                ? 'bg-cyan-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ArrowUp className="w-3.5 h-3.5" />
            <span>Decapsulate (↑)</span>
          </button>
        </div>
      </div>

      {/* Frame Visual Ribbon (Nested payload diagram) */}
      <div className="bg-slate-900/70 p-3 rounded-xl border border-slate-800 space-y-2">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>Nested Frame Serialization ({packet.size_bytes}B Payload)</span>
          <span className="text-cyan-400 font-bold">{isTcp ? 'TCP/IP Stack' : 'UDP/IP Stack'}</span>
        </div>
        <div className="flex w-full h-8 rounded-lg overflow-hidden border border-slate-800 text-[10px] font-mono font-bold select-none text-slate-950">
          <div className="w-[18%] bg-emerald-400 flex items-center justify-center truncate px-1" title="Ethernet Header (14B)">
            Eth (14B)
          </div>
          <div className="w-[18%] bg-indigo-400 flex items-center justify-center truncate px-1" title="IPv4 Header (20B)">
            IP (20B)
          </div>
          <div className="w-[20%] bg-cyan-400 flex items-center justify-center truncate px-1" title={isTcp ? "TCP Header (20B)" : "UDP Header (8B)"}>
            {isTcp ? 'TCP (20B)' : 'UDP (8B)'}
          </div>
          <div className="flex-1 bg-amber-400 flex items-center justify-center truncate px-1" title="Application Data">
            Payload ({packet.size_bytes}B)
          </div>
          <div className="w-[12%] bg-emerald-400 flex items-center justify-center truncate px-1" title="Ethernet FCS (4B)">
            FCS
          </div>
        </div>
      </div>

      {/* Vertical 5-Layer Stack Flow */}
      <div className="space-y-2">
        {displayLayers.map((layer, index) => {
          const isSelected = selectedLayerIndex === layer.index;
          const Icon = layer.icon;

          return (
            <React.Fragment key={layer.index}>
              <div
                onClick={() => onSelectLayer?.(layer.index)}
                className={`p-3 rounded-xl border transition-all cursor-pointer select-none ${
                  isSelected
                    ? `${layer.borderClass} ring-2 ring-cyan-400 shadow-lg shadow-cyan-950/40`
                    : 'border-slate-800/80 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border ${layer.badgeClass}`}>
                      Layer {layer.index}
                    </span>
                    <Icon className="w-4 h-4 text-slate-300" />
                    <div>
                      <div className="text-xs font-semibold text-slate-100 flex items-center space-x-2">
                        <span>{layer.name}</span>
                        <span className="text-[11px] font-mono text-cyan-400 font-medium">
                          ({layer.protocol})
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 truncate max-w-[340px]">
                        {layer.summary}
                      </div>
                    </div>
                  </div>

                  <div className="text-right font-mono text-[11px]">
                    <div className="text-slate-300 font-medium">
                      {layer.index === 1 ? `${layer.totalBytes} bits` : `${layer.totalBytes} bytes`}
                    </div>
                    {layer.headerBytes > 0 && (
                      <div className="text-[10px] text-slate-400">
                        +{layer.headerBytes}B header
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Encapsulation transition arrows between layers */}
              {index < displayLayers.length - 1 && (
                <div className="flex items-center justify-center py-0.5 text-slate-400">
                  {mode === 'encapsulation' ? (
                    <div className="flex items-center space-x-1 text-[10px] font-mono text-cyan-400">
                      <ArrowDown className="w-3.5 h-3.5 animate-bounce" />
                      <span>Encapsulates payload into Layer {displayLayers[index + 1].index}</span>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-1 text-[10px] font-mono text-amber-400">
                      <ArrowUp className="w-3.5 h-3.5 animate-bounce" />
                      <span>Strips header into Layer {displayLayers[index + 1].index}</span>
                    </div>
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
