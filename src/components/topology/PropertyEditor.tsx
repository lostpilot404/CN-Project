import React, { useState, useEffect } from 'react';
import {
  X,
  Server,
  Laptop,
  Router as RouterIcon,
  Network,
  Wifi,
  HelpCircle,
  Trash2,
  Check,
  Layers,
  Sliders,
  AlertCircle,
} from 'lucide-react';
import { Node, Link, Interface, NodeType, NodeState, LinkStatus } from '../../types/topology';

interface PropertyEditorProps {
  selectedNode: Node | null;
  selectedLink: Link | null;
  onClose: () => void;
  onUpdateNode: (nodeId: string, label: string, state: NodeState) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onUpdateLink: (
    linkId: string,
    bandwidthBps: number,
    delayUs: number,
    lossProb: number,
    ber: number,
    queueCap: number,
    status: LinkStatus
  ) => Promise<void>;
  onDeleteLink: (linkId: string) => Promise<void>;
  onUpdateInterface: (
    nodeId: string,
    interfaceId: string,
    ipv4?: string,
    subnetMask?: string,
    status?: 'up' | 'down'
  ) => Promise<void>;
}

export const PropertyEditor: React.FC<PropertyEditorProps> = ({
  selectedNode,
  selectedLink,
  onClose,
  onUpdateNode,
  onDeleteNode,
  onUpdateLink,
  onDeleteLink,
  onUpdateInterface,
}) => {
  // Local state for Node
  const [nodeLabel, setNodeLabel] = useState('');
  const [nodeState, setNodeState] = useState<NodeState>('up');

  // Local state for Link
  const [bandwidthMbps, setBandwidthMbps] = useState(10);
  const [delayMs, setDelayMs] = useState(10);
  const [lossPercent, setLossPercent] = useState(0);
  const [bitErrorRate, setBitErrorRate] = useState(0);
  const [queueCapacity, setQueueCapacity] = useState(50);
  const [linkStatus, setLinkStatus] = useState<LinkStatus>('up');

  // Interface state tracking
  const [editingInterfaceId, setEditingInterfaceId] = useState<string | null>(null);
  const [ifaceIpv4, setIfaceIpv4] = useState('');
  const [ifaceMask, setIfaceMask] = useState('');

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (selectedNode) {
      setNodeLabel(selectedNode.label);
      setNodeState(selectedNode.state);
      setErrorMessage(null);
    }
  }, [selectedNode]);

  useEffect(() => {
    if (selectedLink) {
      setBandwidthMbps(selectedLink.bandwidth_bps / 1_000_000);
      setDelayMs(selectedLink.propagation_delay_us / 1000);
      setLossPercent(selectedLink.loss_probability * 100);
      setBitErrorRate(selectedLink.bit_error_rate);
      setQueueCapacity(selectedLink.queue_capacity);
      setLinkStatus(selectedLink.status);
      setErrorMessage(null);
    }
  }, [selectedLink]);

  if (!selectedNode && !selectedLink) return null;

  const handleSaveNode = async () => {
    if (!selectedNode) return;
    try {
      setErrorMessage(null);
      await onUpdateNode(selectedNode.id, nodeLabel, nodeState);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveLink = async () => {
    if (!selectedLink) return;
    try {
      setErrorMessage(null);
      await onUpdateLink(
        selectedLink.id,
        Math.max(1, Math.round(bandwidthMbps * 1_000_000)),
        Math.max(0, Math.round(delayMs * 1000)),
        Math.min(1, Math.max(0, lossPercent / 100)),
        Math.min(1, Math.max(0, bitErrorRate)),
        Math.max(1, Math.round(queueCapacity)),
        linkStatus
      );
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveInterface = async (iface: Interface) => {
    if (!selectedNode) return;
    try {
      setErrorMessage(null);
      await onUpdateInterface(selectedNode.id, iface.id, ifaceIpv4, ifaceMask, iface.status);
      setEditingInterfaceId(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const getNodeIcon = (type: NodeType) => {
    switch (type) {
      case 'pc':
        return <Laptop className="w-4 h-4 text-sky-400" />;
      case 'server':
        return <Server className="w-4 h-4 text-emerald-400" />;
      case 'router':
        return <RouterIcon className="w-4 h-4 text-amber-400" />;
      case 'switch':
        return <Network className="w-4 h-4 text-purple-400" />;
      case 'access_point':
        return <Wifi className="w-4 h-4 text-cyan-400" />;
      default:
        return <HelpCircle className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="absolute top-4 left-4 right-4 sm:left-auto sm:right-4 z-20 sm:w-84 max-h-[calc(100vh-140px)] flex flex-col bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-950/40">
        <div className="flex items-center space-x-2">
          {selectedNode ? (
            <>
              {getNodeIcon(selectedNode.node_type)}
              <span className="text-xs font-semibold text-slate-200">Node Properties</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                {selectedNode.id}
              </span>
            </>
          ) : (
            <>
              <Sliders className="w-4 h-4 text-brand-400" />
              <span className="text-xs font-semibold text-slate-200">Link Properties</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                {selectedLink?.id}
              </span>
            </>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Error feedback */}
      {errorMessage && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-start space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Body */}
      <div className="p-4 space-y-4 overflow-y-auto text-xs">
        {selectedNode && (
          <>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Node Label
              </label>
              <input aria-label="Node Label"
                type="text"
                value={nodeLabel}
                onChange={(e) => setNodeLabel(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-brand-500 transition-colors"
                placeholder="Device Name"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Device Type
                </label>
                <div className="px-2.5 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-slate-300 font-mono text-[11px]">
                  {selectedNode.node_type}
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">State</label>
                <select aria-label="State"
                  value={nodeState}
                  onChange={(e) => setNodeState(e.target.value as NodeState)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-brand-500"
                >
                  <option value="up">Online (Up)</option>
                  <option value="down">Offline (Down)</option>
                  <option value="degraded">Degraded</option>
                </select>
              </div>
            </div>

            {/* Interfaces List */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-slate-400" />
                  Interfaces ({selectedNode.interfaces.length})
                </span>
              </div>
              <div className="space-y-2">
                {selectedNode.interfaces.map((iface) => (
                  <div
                    key={iface.id}
                    className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/90 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-semibold text-slate-200">{iface.name}</span>
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            iface.status === 'up' ? 'bg-emerald-400' : 'bg-rose-500'
                          }`}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">
                        {iface.link_id ? (
                          <span className="text-brand-400 font-medium">Connected</span>
                        ) : (
                          <span className="text-slate-500">Unconnected</span>
                        )}
                      </span>
                    </div>

                    <div className="text-[10px] font-mono text-slate-400">
                      MAC: {iface.mac_address}
                    </div>

                    {editingInterfaceId === iface.id ? (
                      <div className="space-y-1.5 pt-1.5 border-t border-slate-800/60">
                        <div>
                          <label className="block text-[10px] text-slate-400">IPv4 Address</label>
                          <input aria-label="IPv4 Address"
                            type="text"
                            value={ifaceIpv4}
                            onChange={(e) => setIfaceIpv4(e.target.value)}
                            placeholder="192.168.1.10"
                            className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-400">Subnet Mask</label>
                          <input aria-label="Subnet Mask"
                            type="text"
                            value={ifaceMask}
                            onChange={(e) => setIfaceMask(e.target.value)}
                            placeholder="255.255.255.0"
                            className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-100 text-xs font-mono"
                          />
                        </div>
                        <div className="flex justify-end space-x-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() => setEditingInterfaceId(null)}
                            className="px-2 py-0.5 rounded text-[11px] text-slate-400 hover:text-slate-200"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveInterface(iface)}
                            className="px-2 py-0.5 rounded bg-brand-600 hover:bg-brand-700 text-white text-[11px] font-medium"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between pt-1">
                        <div className="text-[11px] font-mono text-slate-300">
                          {iface.ipv4 || 'No IP configured'}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingInterfaceId(iface.id);
                            setIfaceIpv4(iface.ipv4 || '');
                            setIfaceMask(iface.subnet_mask || '255.255.255.0');
                          }}
                          className="text-[10px] text-brand-400 hover:text-brand-300 font-medium"
                        >
                          Configure
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
              <button
                type="button"
                onClick={() => onDeleteNode(selectedNode.id)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20 text-xs font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Node</span>
              </button>

              <button
                type="button"
                onClick={handleSaveNode}
                className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-lg shadow-brand-500/20 transition-colors"
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Saved!</span>
                  </>
                ) : (
                  <span>Apply Changes</span>
                )}
              </button>
            </div>
          </>
        )}

        {selectedLink && (
          <>
            {/* Endpoints */}
            <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] space-y-1">
              <div className="text-slate-400 font-medium">Link Endpoints</div>
              <div className="flex items-center justify-between font-mono text-slate-200">
                <span>
                  {selectedLink.source.node_id} ({selectedLink.source.interface_id})
                </span>
                <span className="text-brand-400">⟷</span>
                <span>
                  {selectedLink.target.node_id} ({selectedLink.target.interface_id})
                </span>
              </div>
            </div>

            {/* Link bandwidth */}
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-slate-400">Bandwidth (Mbps)</span>
                <span className="font-mono text-slate-200 font-medium">{bandwidthMbps} Mbps</span>
              </div>
              <input
                type="number"
                min="1"
                step="1"
                value={bandwidthMbps}
                onChange={(e) => setBandwidthMbps(Math.max(1, parseFloat(e.target.value) || 1))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs font-mono"
              />
            </div>

            {/* Propagation delay */}
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-slate-400">Propagation Delay (ms)</span>
                <span className="font-mono text-slate-200 font-medium">{delayMs} ms</span>
              </div>
              <input
                type="number"
                min="0"
                step="0.5"
                value={delayMs}
                onChange={(e) => setDelayMs(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs font-mono"
              />
            </div>

            {/* Loss probability */}
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-slate-400">Loss Probability (%)</span>
                <span className="font-mono text-slate-200 font-medium">
                  {lossPercent.toFixed(2)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="0.5"
                value={lossPercent}
                onChange={(e) => setLossPercent(parseFloat(e.target.value))}
                className="w-full accent-brand-500"
              />
            </div>

            {/* Bit Error Rate */}
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-slate-400">Bit Error Rate (BER)</span>
                <span className="font-mono text-slate-200 font-medium">{bitErrorRate}</span>
              </div>
              <input
                type="number"
                min="0"
                max="1"
                step="0.00001"
                value={bitErrorRate}
                onChange={(e) => setBitErrorRate(parseFloat(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs font-mono"
              />
            </div>

            {/* Queue Capacity */}
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-slate-400">Buffer Queue Capacity</span>
                <span className="font-mono text-slate-200 font-medium">
                  {queueCapacity} packets
                </span>
              </div>
              <input
                type="number"
                min="1"
                max="10000"
                value={queueCapacity}
                onChange={(e) => setQueueCapacity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 text-xs font-mono"
              />
            </div>

            {/* Link Status */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Link Status</label>
              <select aria-label="Link Status"
                value={linkStatus}
                onChange={(e) => setLinkStatus(e.target.value as LinkStatus)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-brand-500"
              >
                <option value="up">Active (Up)</option>
                <option value="down">Severed (Down)</option>
                <option value="degraded">Degraded</option>
              </select>
            </div>

            {/* Actions */}
            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
              <button
                type="button"
                onClick={() => onDeleteLink(selectedLink.id)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20 text-xs font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Link</span>
              </button>

              <button
                type="button"
                onClick={handleSaveLink}
                className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-lg shadow-brand-500/20 transition-colors"
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Saved!</span>
                  </>
                ) : (
                  <span>Apply Changes</span>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
