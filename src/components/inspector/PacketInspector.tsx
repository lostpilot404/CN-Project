import React from 'react';
import { Package, ArrowRight, Clock } from 'lucide-react';
import { Packet, LayerView } from '../../types/packet';
import { LayerCard } from './LayerCard';
import { formatTimeUs } from '../../lib/utils';

interface PacketInspectorProps {
  packet: Packet | null;
  currentTimeUs?: number;
  activeLayerIndex?: number;
}

export const PacketInspector: React.FC<PacketInspectorProps> = ({
  packet,
  currentTimeUs = 0,
  activeLayerIndex,
}) => {
  if (!packet) {
    return (
      <div
        data-testid="packet-inspector"
        data-state="empty"
        className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-400 bg-slate-900/40 rounded-2xl border border-slate-800/80"
      >
        <Package className="w-12 h-12 text-slate-600 mb-3 stroke-[1.5]" />
        <h4 className="text-sm font-semibold text-slate-300">No Packet Selected</h4>
        <p className="text-xs text-slate-400 mt-1 max-w-[240px]">
          Inject a packet or click an event in the timeline to inspect its 5-layer encapsulation headers.
        </p>
      </div>
    );
  }

  // Derive 5 LayerViews from authoritative packet headers
  const appFields: { label: string; value: string | number; hex?: string; isModeled?: boolean }[] = [
    {
      label: 'Protocol',
      value: packet.headers.application.protocol,
      hex: '0x' + Array.from(packet.headers.application.protocol.slice(0, 4)).map((c) => c.charCodeAt(0).toString(16)).join(''),
      isModeled: true,
    },
    { label: 'Message Type', value: packet.headers.application.message_type || 'Not modeled', isModeled: Boolean(packet.headers.application.message_type) },
    { label: 'Payload Size', value: `${packet.size_bytes} bytes`, isModeled: true },
  ];

  if (packet.headers.application.session_id) {
    appFields.push({ label: 'Session ID', value: packet.headers.application.session_id, isModeled: true });
  }
  if (packet.headers.application.transaction_id !== undefined && packet.headers.application.transaction_id !== null) {
    appFields.push({
      label: 'Transaction ID',
      value: packet.headers.application.transaction_id,
      hex: `0x${packet.headers.application.transaction_id.toString(16)}`,
      isModeled: true,
    });
  }
  if (packet.headers.application.resource_or_command) {
    appFields.push({ label: 'Command / Resource', value: packet.headers.application.resource_or_command, isModeled: true });
  }
  if (packet.headers.application.status_code) {
    appFields.push({ label: 'Status Code', value: packet.headers.application.status_code, isModeled: true });
  }

  const appLayer: LayerView = {
    layerIndex: 5,
    layerName: 'Application',
    title: `${packet.headers.application.protocol} Message`,
    protocol: packet.headers.application.protocol,
    headerFields: appFields,
    payloadSummary: packet.headers.application.payload_preview,
    statusBadge: packet.headers.application.status_code || packet.headers.application.message_type || 'Application Data',
    isModeled: true,
  };

  const isTcp = packet.headers.transport.protocol.toUpperCase() === 'TCP';
  const transportFields: { label: string; value: string | number; hex?: string; isModeled?: boolean }[] = [
    { label: 'Source Port', value: packet.headers.transport.src_port, hex: `0x${packet.headers.transport.src_port.toString(16).padStart(4, '0')}`, isModeled: true },
    { label: 'Destination Port', value: packet.headers.transport.dst_port, hex: `0x${packet.headers.transport.dst_port.toString(16).padStart(4, '0')}`, isModeled: true },
  ];

  if (isTcp) {
    transportFields.push(
      {
        label: 'Sequence Number',
        value: packet.headers.transport.seq_num !== null && packet.headers.transport.seq_num !== undefined ? packet.headers.transport.seq_num : 'Not modeled',
        hex: packet.headers.transport.seq_num !== null && packet.headers.transport.seq_num !== undefined ? `0x${packet.headers.transport.seq_num.toString(16)}` : undefined,
        isModeled: packet.headers.transport.seq_num !== null && packet.headers.transport.seq_num !== undefined,
      },
      {
        label: 'Acknowledgment Number',
        value: packet.headers.transport.ack_num !== null && packet.headers.transport.ack_num !== undefined ? packet.headers.transport.ack_num : 'Not modeled',
        hex: packet.headers.transport.ack_num !== null && packet.headers.transport.ack_num !== undefined ? `0x${packet.headers.transport.ack_num.toString(16)}` : undefined,
        isModeled: packet.headers.transport.ack_num !== null && packet.headers.transport.ack_num !== undefined,
      },
      {
        label: 'Window Size',
        value: packet.headers.transport.window_size ? `${packet.headers.transport.window_size} bytes` : 'Not modeled',
        hex: packet.headers.transport.window_size ? `0x${packet.headers.transport.window_size.toString(16)}` : undefined,
        isModeled: Boolean(packet.headers.transport.window_size),
      },
      {
        label: 'Control Flags',
        value: packet.headers.transport.flags.length > 0 ? packet.headers.transport.flags.join(', ') : 'None',
        isModeled: true,
      },
      {
        label: 'Retransmission',
        value: packet.headers.transport.is_retransmission ? 'Yes (Retransmit)' : 'No (Original)',
        isModeled: true,
      },
      {
        label: 'Connection State',
        value: packet.headers.transport.connection_state || 'Established',
        isModeled: true,
      }
    );
  } else {
    transportFields.push(
      {
        label: 'Sequence Number',
        value: 'Not applicable (UDP)',
        isModeled: false,
      },
      {
        label: 'Acknowledgment Number',
        value: 'Not applicable (UDP)',
        isModeled: false,
      },
      {
        label: 'Window Size',
        value: 'Not applicable (UDP)',
        isModeled: false,
      },
      {
        label: 'Control Flags',
        value: 'None (UDP is connectionless)',
        isModeled: false,
      },
      {
        label: 'Connection State',
        value: 'Connectionless (UDP)',
        isModeled: true,
      }
    );
  }

  const transportLayer: LayerView = {
    layerIndex: 4,
    layerName: 'Transport',
    title: `${packet.headers.transport.protocol} Segment / Datagram`,
    protocol: packet.headers.transport.protocol,
    headerFields: transportFields,
    payloadSummary: `${packet.headers.transport.protocol} ${isTcp ? 'Segment' : 'Datagram'} payload: ${packet.headers.transport.payload_length || packet.size_bytes} bytes`,
    statusBadge: isTcp ? (packet.headers.transport.flags.length > 0 ? packet.headers.transport.flags.join(' ') : 'TCP') : 'UDP',
    isModeled: true,
  };

  const networkLayer: LayerView = {
    layerIndex: 3,
    layerName: 'Network',
    title: `IPv${packet.headers.network.version} Packet`,
    protocol: `IPv${packet.headers.network.version}`,
    headerFields: [
      { label: 'Source IP', value: packet.headers.network.src_ip, isModeled: true },
      { label: 'Destination IP', value: packet.headers.network.dst_ip, isModeled: true },
      { label: 'Version', value: `IPv${packet.headers.network.version}`, isModeled: true },
      { label: 'Time To Live (TTL)', value: packet.headers.network.ttl, isModeled: true },
      { label: 'Protocol Number', value: `${packet.headers.network.protocol_num} (${isTcp ? 'TCP' : 'UDP'})`, hex: `0x${packet.headers.network.protocol_num.toString(16).padStart(2, '0')}`, isModeled: true },
      { label: 'Header Checksum', value: `0x${packet.headers.network.checksum.toString(16).toUpperCase()}`, hex: `0x${packet.headers.network.checksum.toString(16).toUpperCase()}`, isModeled: true },
      { label: 'Next Hop', value: packet.next_hop_node_id || 'Direct Hop', isModeled: true },
    ],
    payloadSummary: `Encapsulated ${packet.headers.transport.protocol} packet (${packet.size_bytes + 20} bytes total)`,
    statusBadge: `TTL ${packet.headers.network.ttl}`,
    isModeled: true,
  };

  const dataLinkLayer: LayerView = {
    layerIndex: 2,
    layerName: 'Data Link',
    title: packet.headers.datalink.frame_type || 'Ethernet II Frame',
    protocol: 'Ethernet',
    headerFields: [
      { label: 'Source MAC', value: packet.headers.datalink.src_mac, isModeled: true },
      { label: 'Destination MAC', value: packet.headers.datalink.dst_mac, isModeled: true },
      { label: 'EtherType', value: `0x${packet.headers.datalink.ether_type.toString(16).padStart(4, '0').toUpperCase()} (IPv4)`, hex: `0x${packet.headers.datalink.ether_type.toString(16)}`, isModeled: true },
      { label: 'CRC FCS Checksum', value: `0x${packet.headers.datalink.crc_fcs.toString(16).toUpperCase()}`, hex: `0x${packet.headers.datalink.crc_fcs.toString(16).toUpperCase()}`, isModeled: true },
      { label: 'Frame Check Integrity', value: packet.headers.datalink.fcs_valid !== false ? 'Valid FCS' : 'Corrupted FCS', isModeled: true },
    ],
    payloadSummary: `Ethernet Frame carrying ${packet.size_bytes + 34} bytes including MACs & FCS`,
    statusBadge: packet.headers.datalink.fcs_valid !== false ? 'FCS OK' : 'FCS ERROR',
    isModeled: true,
  };

  const phys = packet.headers.physical;
  const physicalLayer: LayerView = {
    layerIndex: 1,
    layerName: 'Physical',
    title: phys?.link_id ? `Link ${phys.link_id} Bitstream` : 'Physical Transmission',
    protocol: 'Bitstream',
    headerFields: [
      { label: 'Active Link', value: phys?.link_id || 'Not modeled', isModeled: Boolean(phys?.link_id) },
      {
        label: 'Link Bandwidth',
        value: phys?.bandwidth_bps ? `${(phys.bandwidth_bps / 1_000_000).toFixed(1)} Mbps` : 'Not modeled',
        isModeled: Boolean(phys?.bandwidth_bps),
      },
      {
        label: 'Propagation Delay',
        value: phys?.propagation_delay_us ? `${(phys.propagation_delay_us / 1000).toFixed(1)} ms` : 'Not modeled',
        isModeled: Boolean(phys?.propagation_delay_us),
      },
      {
        label: 'Transmission Start',
        value: phys?.tx_start_us !== null && phys?.tx_start_us !== undefined ? `${phys.tx_start_us} µs` : 'Not modeled',
        isModeled: phys?.tx_start_us !== null && phys?.tx_start_us !== undefined,
      },
      {
        label: 'Transmission Finish',
        value: phys?.tx_finish_us !== null && phys?.tx_finish_us !== undefined ? `${phys.tx_finish_us} µs` : 'Not modeled',
        isModeled: phys?.tx_finish_us !== null && phys?.tx_finish_us !== undefined,
      },
      { label: 'Bit Count', value: `${(phys?.bit_count || packet.size_bytes * 8).toLocaleString()} bits`, isModeled: true },
      { label: 'Preamble / SFD', value: phys?.preamble_bits || 'Not modeled', isModeled: Boolean(phys?.preamble_bits) },
      { label: 'Signal Encoding', value: phys?.signal_encoding || 'Not modeled', isModeled: Boolean(phys?.signal_encoding) },
    ],
    payloadSummary: `Physical layer serialization: ${phys?.bit_count || packet.size_bytes * 8} bits transmitted`,
    statusBadge: phys?.link_id ? 'In Transmission' : 'Physical Layer',
    isModeled: Boolean(phys),
  };

  const layers: LayerView[] = [appLayer, transportLayer, networkLayer, dataLinkLayer, physicalLayer];

  // Helper for status styling
  const stateColor: Record<string, string> = {
    created: 'bg-slate-700/60 text-slate-300 border-slate-600',
    queued: 'bg-amber-950/60 text-amber-300 border-amber-800',
    transmitting: 'bg-cyan-950/60 text-cyan-300 border-cyan-800 animate-pulse',
    in_flight: 'bg-indigo-950/60 text-indigo-300 border-indigo-800',
    delivered: 'bg-emerald-950/60 text-emerald-300 border-emerald-800',
    dropped_queue_full: 'bg-rose-950/60 text-rose-300 border-rose-800',
    dropped_bit_error: 'bg-rose-950/60 text-rose-300 border-rose-800',
    dropped_link_down: 'bg-rose-950/60 text-rose-300 border-rose-800',
    retransmitted: 'bg-amber-950/60 text-amber-300 border-amber-800',
  };

  return (
    <div
      data-testid="packet-inspector"
      data-state="populated"
      className="flex flex-col h-full bg-slate-950/90 overflow-hidden select-none"
    >
      {/* Overview Top Card */}
      <div className="p-3.5 border-b border-slate-800 bg-slate-900/70 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Package className="w-4 h-4 text-cyan-400" />
            <span className="font-mono text-sm font-bold text-white">{packet.id}</span>
            <span
              className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${
                stateColor[packet.state] || 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
            >
              {packet.state.toUpperCase().replace(/_/g, ' ')}
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {packet.size_bytes} bytes
          </span>
        </div>

        {/* Source -> Destination & Current Location */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">Route Path</span>
            <div className="flex items-center space-x-1 font-mono text-slate-200 mt-0.5">
              <span>{packet.src_node_id}</span>
              <ArrowRight className="w-3 h-3 text-cyan-400" />
              <span>{packet.dst_node_id}</span>
            </div>
          </div>

          <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">Current Location</span>
            <div className="flex items-center space-x-1.5 font-mono text-emerald-400 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span>{packet.current_node_id}</span>
              {packet.next_hop_node_id && (
                <span className="text-[10px] text-slate-400">
                  (next: {packet.next_hop_node_id})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Timing info */}
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/40">
          <span className="flex items-center space-x-1">
            <Clock className="w-3 h-3 text-slate-400" />
            <span>Created: {formatTimeUs(packet.created_at_us)}</span>
          </span>
          <span>SimTime: {formatTimeUs(currentTimeUs)}</span>
        </div>
      </div>

      {/* 5-Layer Stack Cards */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
          OSI / TCP-IP 5-Layer Headers
        </div>
        {layers.map((layer) => (
          <LayerCard
            key={layer.layerIndex}
            layer={layer}
            isActive={activeLayerIndex === layer.layerIndex}
          />
        ))}
      </div>
    </div>
  );
};
