import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Laptop, Server, Router, Network, Wifi, Cpu } from 'lucide-react';
import { NodeType, NodeState } from '../../types/topology';

interface CustomNodeData {
  label: string;
  nodeType: NodeType;
  ip?: string;
  status: NodeState;
  /** Keyboard/AT selection hook: Enter or Space on the focused node selects it. */
  onSelect?: (nodeId: string) => void;
  nodeId?: string;
}

const getNodeIcon = (type: NodeType) => {
  switch (type) {
    case 'pc':
      return <Laptop className="w-5 h-5 text-sky-400" />;
    case 'server':
      return <Server className="w-5 h-5 text-emerald-400" />;
    case 'router':
      return <Router className="w-5 h-5 text-amber-400" />;
    case 'switch':
      return <Network className="w-5 h-5 text-purple-400" />;
    case 'access_point':
      return <Wifi className="w-5 h-5 text-cyan-400" />;
    case 'generic':
    default:
      return <Cpu className="w-5 h-5 text-slate-300" />;
  }
};

export const CustomNode = memo(({ data, selected, id }: { data: CustomNodeData; selected?: boolean; id?: string }) => {
  const getStatusColor = () => {
    switch (data.status) {
      case 'up':
        return 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]';
      case 'degraded':
        return 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]';
      case 'down':
      default:
        return 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]';
    }
  };

  const nodeKey = id ?? data.nodeId ?? '';
  return (
    <div
      tabIndex={0}
      role="button"
      aria-pressed={!!selected}
      aria-label={`Node ${data.label}, type ${data.nodeType}, status ${data.status}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          data.onSelect?.(nodeKey);
        }
      }}
      className={`px-3.5 py-2.5 rounded-xl bg-slate-900/95 border transition-all duration-200 shadow-lg min-w-[140px] select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
        selected
          ? 'border-brand-500 shadow-brand-500/20 ring-2 ring-brand-500/30'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Handles for XYFlow connections */}
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-brand-500 !border-slate-900" />
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-brand-500 !border-slate-900" />
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-brand-500 !border-slate-900" />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-brand-500 !border-slate-900" />

      <div className="flex items-center space-x-2.5">
        <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700">
          {getNodeIcon(data.nodeType)}
        </div>
        <div className="overflow-hidden">
          <div className="flex items-center space-x-1.5">
            <span className="text-xs font-semibold text-slate-100 truncate">{data.label}</span>
            <span className={`w-1.5 h-1.5 rounded-full ${getStatusColor()}`} />
          </div>
          <div className="text-[10px] font-mono text-slate-400 truncate">
            {data.ip || 'Unconfigured'}
          </div>
        </div>
      </div>
    </div>
  );
});

CustomNode.displayName = 'CustomNode';
