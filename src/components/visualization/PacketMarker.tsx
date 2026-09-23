import React from 'react';
import { Package, Send, CheckCircle2, AlertOctagon, RotateCcw, Clock, AlertTriangle } from 'lucide-react';
import { PacketState } from '../../types/packet';

interface PacketMarkerProps {
  packetId: string;
  protocol?: string;
  sizeBytes?: number;
  state: PacketState | string;
  onClick?: () => void;
  isSelected?: boolean;
}

export const PacketMarker: React.FC<PacketMarkerProps> = ({
  packetId,
  protocol = 'TCP',
  sizeBytes = 1000,
  state,
  onClick,
  isSelected = false,
}) => {
  const normalizedState = state.toLowerCase();

  // Status mapping
  const configMap: Record<
    string,
    { bg: string; border: string; text: string; icon: React.ComponentType<{ className?: string }> }
  > = {
    created: { bg: 'bg-slate-900', border: 'border-slate-700', text: 'text-slate-300', icon: Package },
    queued: { bg: 'bg-amber-950/80', border: 'border-amber-700', text: 'text-amber-300', icon: Clock },
    transmitting: { bg: 'bg-cyan-950/90', border: 'border-cyan-500 animate-pulse', text: 'text-cyan-300', icon: Send },
    in_flight: { bg: 'bg-indigo-950/80', border: 'border-indigo-600', text: 'text-indigo-300', icon: Send },
    arrived: { bg: 'bg-teal-950/80', border: 'border-teal-600', text: 'text-teal-300', icon: CheckCircle2 },
    delivered: { bg: 'bg-emerald-950/80', border: 'border-emerald-500', text: 'text-emerald-300', icon: CheckCircle2 },
    dropped_queue_full: { bg: 'bg-rose-950/80', border: 'border-rose-600', text: 'text-rose-300', icon: AlertOctagon },
    dropped_bit_error: { bg: 'bg-rose-950/80', border: 'border-rose-600', text: 'text-rose-300', icon: AlertTriangle },
    dropped_link_down: { bg: 'bg-rose-950/80', border: 'border-rose-600', text: 'text-rose-300', icon: AlertOctagon },
    retransmitted: { bg: 'bg-amber-950/90', border: 'border-amber-500', text: 'text-amber-300', icon: RotateCcw },
    timeout: { bg: 'bg-rose-950/80', border: 'border-rose-700', text: 'text-rose-300', icon: Clock },
  };

  const currentCfg = configMap[normalizedState] || configMap['created'];
  const Icon = currentCfg.icon;

  return (
    <div
      onClick={onClick}
      data-testid={`packet-marker-${packetId}`}
      className={`inline-flex items-center space-x-2 px-2.5 py-1.5 rounded-xl border font-mono select-none cursor-pointer transition-all duration-200 shadow-md ${
        currentCfg.bg
      } ${currentCfg.border} ${
        isSelected ? 'ring-2 ring-cyan-400 shadow-cyan-950/50 scale-105' : 'hover:scale-102'
      }`}
    >
      <Icon className={`w-3.5 h-3.5 ${currentCfg.text}`} />
      <span className="text-xs font-bold text-white">{packetId}</span>
      <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-cyan-300">
        {protocol}
      </span>
      <span className="text-[10px] text-slate-400">{sizeBytes}B</span>
      <span className={`text-[9px] uppercase font-bold px-1.5 py-0.2 rounded ${currentCfg.text}`}>
        {normalizedState.replace(/_/g, ' ')}
      </span>
    </div>
  );
};
