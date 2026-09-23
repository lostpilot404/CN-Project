import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Binary } from 'lucide-react';
import { LayerView } from '../../types/packet';

interface LayerCardProps {
  layer: LayerView;
  isActive?: boolean;
  defaultExpanded?: boolean;
}

export const LayerCard: React.FC<LayerCardProps> = ({
  layer,
  isActive = false,
  defaultExpanded = true,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);
  const [showRawHex, setShowRawHex] = useState<boolean>(false);

  // Layer color schemes
  const colorMap: Record<number, { border: string; bg: string; badge: string; text: string }> = {
    5: {
      border: 'border-amber-500/40',
      bg: 'bg-amber-950/20',
      badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      text: 'text-amber-400',
    },
    4: {
      border: 'border-cyan-500/40',
      bg: 'bg-cyan-950/20',
      badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
      text: 'text-cyan-400',
    },
    3: {
      border: 'border-indigo-500/40',
      bg: 'bg-indigo-950/20',
      badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
      text: 'text-indigo-400',
    },
    2: {
      border: 'border-emerald-500/40',
      bg: 'bg-emerald-950/20',
      badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      text: 'text-emerald-400',
    },
    1: {
      border: 'border-slate-500/40',
      bg: 'bg-slate-900/40',
      badge: 'bg-slate-600/20 text-slate-300 border-slate-500/30',
      text: 'text-slate-400',
    },
  };

  const colors = colorMap[layer.layerIndex] || colorMap[1];

  return (
    <div
      data-testid={`layer-card-${layer.layerIndex}`}
      className={`rounded-xl border transition-all duration-200 overflow-hidden ${
        isActive
          ? `${colors.border} ${colors.bg} ring-1 ring-cyan-400/50 shadow-lg shadow-cyan-950/30`
          : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
      }`}
    >
      {/* Header bar */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-3.5 py-2.5 flex items-center justify-between cursor-pointer select-none bg-slate-900/80 hover:bg-slate-850/80 transition-colors"
      >
        <div className="flex items-center space-x-2.5">
          <span
            className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border ${colors.badge}`}
          >
            L{layer.layerIndex}
          </span>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold text-slate-200">{layer.layerName}</span>
              <span className={`text-[11px] font-mono font-medium ${colors.text}`}>
                {layer.protocol}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 truncate max-w-[220px]">
              {layer.title}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {layer.statusBadge && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
              {layer.statusBadge}
            </span>
          )}
          {layer.isModeled && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowRawHex(!showRawHex);
              }}
              title="Toggle raw hex preview"
              className={`p-1 rounded text-slate-400 hover:text-white transition-colors ${
                showRawHex ? 'bg-slate-750 text-cyan-300' : 'hover:bg-slate-800'
              }`}
            >
              <Binary className="w-3.5 h-3.5" />
            </button>
          )}
          <button className="text-slate-400 hover:text-white">
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded Details Body */}
      {isExpanded && (
        <div className="p-3 border-t border-slate-800/80 space-y-2.5 bg-slate-950/40 text-xs">
          {/* Summary / preview */}
          {layer.payloadSummary && (
            <div className="text-[11px] font-mono text-slate-400 bg-slate-900/70 p-2 rounded-lg border border-slate-800/80">
              {layer.payloadSummary}
            </div>
          )}

          {/* Key-Value Fields */}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {layer.headerFields.map((f, idx) => (
              <div
                key={idx}
                className="bg-slate-900/60 p-1.5 rounded border border-slate-800/60 flex flex-col justify-between"
              >
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                  {f.label}
                </span>
                <div className="flex items-baseline justify-between mt-0.5">
                  <span
                    className={`font-mono font-medium truncate ${
                      f.isModeled === false
                        ? 'text-slate-400 italic'
                        : 'text-slate-200'
                    }`}
                  >
                    {String(f.value)}
                  </span>
                  {showRawHex && f.hex && (
                    <span className="text-[9px] font-mono text-cyan-400 ml-1">
                      {f.hex}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Raw Byte Representation (Display-only formatting) */}
          {showRawHex && layer.isModeled && (
            <div className="p-2 rounded bg-slate-950 border border-slate-800 font-mono text-[10px] text-slate-400 space-y-1">
              <div className="text-[9px] text-slate-400 uppercase font-semibold">
                Authoritative Field Hex Map:
              </div>
              <div className="flex flex-wrap gap-1.5 text-cyan-300">
                {layer.headerFields
                  .filter((f) => f.hex)
                  .map((f, i) => (
                    <span key={i} title={`${f.label}: ${f.value}`} className="bg-slate-900 px-1 py-0.5 rounded">
                      {f.hex}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
