import React, { useMemo, useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node as FlowNode,
  Edge as FlowEdge,
  Connection,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Undo2, Redo2, Network, Cpu, Link2 } from 'lucide-react';
import { ConnectDialog } from './ConnectDialog';
import { CustomNode } from './CustomNode';
import { DevicePalette } from './DevicePalette';
import { PropertyEditor } from './PropertyEditor';
import { Project } from '../../types/project';
import { NodeType, NodeState, LinkStatus, HistoryStatus } from '../../types/topology';

interface TopologyCanvasProps {
  project: Project | null;
  historyStatus: HistoryStatus;
  onAddNode: (type: NodeType, label: string) => void;
  onConnectNodes: (sourceId: string, targetId: string) => Promise<string | null>;
  onUpdateNode: (nodeId: string, label: string, state: NodeState) => Promise<void>;
  onNodePositionChange: (nodeId: string, position: { x: number; y: number }) => Promise<void>;
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
  onUndo: () => void;
  onRedo: () => void;
}

export const TopologyCanvas: React.FC<TopologyCanvasProps> = ({
  project,
  historyStatus,
  onAddNode,
  onConnectNodes,
  onUpdateNode,
  onNodePositionChange,
  onDeleteNode,
  onUpdateLink,
  onDeleteLink,
  onUpdateInterface,
  onUndo,
  onRedo,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const nodeTypes = useMemo(() => ({ custom: CustomNode }), []);

  const selectedNode = useMemo(() => {
    if (!project || !selectedNodeId) return null;
    return project.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [project, selectedNodeId]);

  const selectedLink = useMemo(() => {
    if (!project || !selectedLinkId) return null;
    return project.links.find((l) => l.id === selectedLinkId) || null;
  }, [project, selectedLinkId]);

  // Keyboard/AT selection of a canvas node (Enter or Space on the focused node).
  const selectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedLinkId(null);
  }, []);

  // Map Project nodes to XYFlow nodes
  const initialNodes: FlowNode[] = useMemo(() => {
    if (!project) return [];
    return project.nodes.map((n) => ({
      id: n.id,
      type: 'custom',
      position: { x: n.position.x, y: n.position.y },
      selected: n.id === selectedNodeId,
      data: {
        label: n.label,
        nodeType: n.node_type,
        ip: n.interfaces[0]?.ipv4 || 'Unconfigured',
        status: n.state,
        nodeId: n.id,
        onSelect: selectNode,
      },
    }));
  }, [project, selectedNodeId, selectNode]);

  // Map Project links to XYFlow edges
  const initialEdges: FlowEdge[] = useMemo(() => {
    if (!project) return [];
    return project.links.map((l) => {
      const isSelected = l.id === selectedLinkId;
      const isUp = l.status === 'up';
      const isDegraded = l.status === 'degraded';
      const strokeColor = isSelected
        ? '#38bdf8'
        : isUp
        ? '#38aaf6'
        : isDegraded
        ? '#fbbf24'
        : '#f43f5e';

      const bwDisplay =
        l.bandwidth_bps >= 1_000_000_000
          ? `${l.bandwidth_bps / 1_000_000_000} Gbps`
          : l.bandwidth_bps >= 1_000_000
          ? `${l.bandwidth_bps / 1_000_000} Mbps`
          : `${l.bandwidth_bps / 1_000} Kbps`;

      const delayDisplay = `${(l.propagation_delay_us / 1000).toFixed(1)}ms`;

      return {
        id: l.id,
        source: l.source.node_id,
        target: l.target.node_id,
        animated: isUp,
        label: `${bwDisplay} · ${delayDisplay}`,
        labelStyle: {
          fill: isSelected ? '#38bdf8' : '#94a3b8',
          fontSize: 10,
          fontWeight: 600,
          fontFamily: 'monospace',
        },
        labelBgStyle: {
          fill: '#090d16',
          fillOpacity: 0.85,
          stroke: isSelected ? '#38bdf8' : '#1e293b',
          strokeWidth: 1,
          rx: 6,
          ry: 6,
        },
        labelBgPadding: [6, 3] as [number, number],
        style: {
          stroke: strokeColor,
          strokeWidth: isSelected ? 3.5 : 2.5,
          strokeDasharray: !isUp ? '5,5' : undefined,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
          width: 12,
          height: 12,
        },
      };
    });
  }, [project, selectedLinkId]);

  const [nodes, setNodes] = useState<FlowNode[]>(initialNodes);
  const [edges, setEdges] = useState<FlowEdge[]>(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) =>
      setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) =>
      setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (params.source && params.target) {
        setEdges((eds) => addEdge(params, eds));
        // Drag connections report failures through the App toast; the keyboard dialog
        // surfaces the same authoritative add_link errors inline.
        void onConnectNodes(params.source, params.target);
      }
    },
    [onConnectNodes]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: FlowNode) => {
    setSelectedNodeId(node.id);
    setSelectedLinkId(null);
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: FlowEdge) => {
    setSelectedLinkId(edge.id);
    setSelectedNodeId(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedLinkId(null);
  }, []);

  const onNodeDragStop = useCallback(
    (_event: unknown, node: FlowNode) => {
      // Optional snap-to-grid: 10 px grid keeps topologies aligned without pixel hunting.
      const position = snapEnabled
        ? { x: Math.round(node.position.x / 10) * 10, y: Math.round(node.position.y / 10) * 10 }
        : { x: node.position.x, y: node.position.y };
      setNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, position } : n)));
      onNodePositionChange(node.id, position);
    },
    [onNodePositionChange, snapEnabled]
  );

  // Arrow-key nudge for the selected node (Shift = coarse step).
  const nudgeSelectedNode = useCallback(
    (dx: number, dy: number, coarse: boolean) => {
      if (!selectedNodeId) return;
      const current = nodes.find((n) => n.id === selectedNodeId);
      if (!current) return;
      const step = coarse ? 40 : 10;
      const raw = { x: current.position.x + dx * step, y: current.position.y + dy * step };
      const position = snapEnabled
        ? { x: Math.round(raw.x / 10) * 10, y: Math.round(raw.y / 10) * 10 }
        : raw;
      setNodes((nds) => nds.map((n) => (n.id === selectedNodeId ? { ...n, position } : n)));
      onNodePositionChange(selectedNodeId, position);
    },
    [selectedNodeId, nodes, snapEnabled, onNodePositionChange]
  );

  // Global keyboard shortcuts for Undo, Redo, and Delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input or textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (historyStatus.can_undo) {
          onUndo();
        }
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        if (historyStatus.can_redo) {
          onRedo();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) {
          e.preventDefault();
          onDeleteNode(selectedNodeId);
          setSelectedNodeId(null);
        } else if (selectedLinkId) {
          e.preventDefault();
          onDeleteLink(selectedLinkId);
          setSelectedLinkId(null);
        }
      } else if (e.key === 'Escape') {
        setShowHelp(false);
        setSelectedNodeId(null);
        setSelectedLinkId(null);
      } else if (e.key === '?' ) {
        e.preventDefault();
        setShowHelp((open) => !open);
      } else if ((e.key === 'c' || e.key === 'C') && project && project.nodes.length >= 2) {
        e.preventDefault();
        setConnectOpen(true);
      } else if (e.key.startsWith('Arrow') && selectedNodeId) {
        e.preventDefault();
        const step = e.shiftKey;
        if (e.key === 'ArrowUp') nudgeSelectedNode(0, -1, step);
        else if (e.key === 'ArrowDown') nudgeSelectedNode(0, 1, step);
        else if (e.key === 'ArrowLeft') nudgeSelectedNode(-1, 0, step);
        else if (e.key === 'ArrowRight') nudgeSelectedNode(1, 0, step);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    historyStatus,
    selectedNodeId,
    selectedLinkId,
    onUndo,
    onRedo,
    onDeleteNode,
    onDeleteLink,
    nudgeSelectedNode,
    project,
  ]);

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden">
      {/* Device Palette */}
      <DevicePalette onAddDevice={onAddNode} />

      {/* Top Topology Canvas Action Bar */}
      <div className="absolute top-4 left-4 z-10 flex items-center space-x-2 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl px-2 py-1.5 shadow-xl select-none">
        {/* Undo Button */}
        <button
          onClick={onUndo}
          disabled={!historyStatus.can_undo}
          title="Undo (Ctrl+Z)"
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
            historyStatus.can_undo
              ? 'text-slate-200 hover:text-white hover:bg-slate-800'
              : 'text-slate-600 cursor-not-allowed'
          }`}
        >
          <Undo2 className="w-3.5 h-3.5" />
          <span>Undo</span>
        </button>

        {/* Redo Button */}
        <button
          onClick={onRedo}
          disabled={!historyStatus.can_redo}
          title="Redo (Ctrl+Y)"
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
            historyStatus.can_redo
              ? 'text-slate-200 hover:text-white hover:bg-slate-800'
              : 'text-slate-600 cursor-not-allowed'
          }`}
        >
          <Redo2 className="w-3.5 h-3.5" />
          <span>Redo</span>
        </button>

        <div className="w-[1px] h-4 bg-slate-800" />

        {/* Snap-to-grid toggle */}
        <button
          onClick={() => setSnapEnabled((v) => !v)}
          aria-pressed={snapEnabled}
          title="Snap nodes to a 10 px grid (toggle)"
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
            snapEnabled ? 'text-cyan-300 bg-cyan-950/50' : 'text-slate-300 hover:bg-slate-800'
          }`}
          data-testid="snap-toggle"
        >
          Snap {snapEnabled ? 'On' : 'Off'}
        </button>

        {/* Keyboard-accessible connection workflow */}
        <button
          onClick={() => setConnectOpen(true)}
          disabled={!project || project.nodes.length < 2}
          title="Connect two nodes (C)"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="connect-nodes"
        >
          <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
          Connect
        </button>

        {/* Keyboard help */}
        <button
          onClick={() => setShowHelp((v) => !v)}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800"
          data-testid="keyboard-help"
        >
          Keys ?
        </button>

        <div className="w-[1px] h-4 bg-slate-800" />

        {/* Topology Summary Counts */}
        <div className="flex items-center space-x-3 px-2 text-[11px] font-mono text-slate-400">
          <span className="flex items-center space-x-1">
            <Cpu className="w-3 h-3 text-brand-400" />
            <span>{project?.nodes.length || 0} Nodes</span>
          </span>
          <span className="flex items-center space-x-1">
            <Network className="w-3 h-3 text-cyan-400" />
            <span>{project?.links.length || 0} Links</span>
          </span>
        </div>
      </div>

      {/* Interactive ReactFlow Diagram */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onNodeDragStop={onNodeDragStop}
        fitView
        proOptions={{ hideAttribution: false }}
        attributionPosition="top-right"
        className="bg-slate-950"
      >
        <Background color="#1e293b" gap={20} size={1} />
        <Controls position="bottom-left" style={{ bottom: 64 }} className="!bg-slate-900 !border-slate-800 !fill-slate-300" />
        <MiniMap
          nodeColor={(node) => {
            const status = (node.data as { status?: string } | undefined)?.status;
            if (status === 'up') return '#38aaf6';
            if (status === 'degraded') return '#fbbf24';
            return '#64748b';
          }}
          nodeStrokeWidth={1.5}
          maskColor="rgba(6, 10, 18, 0.7)"
          className="!bg-slate-900/80 !border-slate-800 !rounded-lg"
        />
      </ReactFlow>

      {/* Keyboard help overlay */}
      {showHelp && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/70"
          onClick={() => setShowHelp(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="keyboard-help-title"
            className="w-[min(24rem,90vw)] rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            data-testid="keyboard-help-overlay"
          >
            <h2 id="keyboard-help-title" className="text-sm font-semibold text-slate-100">
              Keyboard shortcuts
            </h2>
            <dl className="mt-3 space-y-1.5 text-xs text-slate-300">
              {[
                ['Ctrl/⌘ + Z', 'Undo'],
                ['Ctrl/⌘ + Y or Shift + Ctrl/⌘ + Z', 'Redo'],
                ['Delete / Backspace', 'Remove selected node or link'],
                ['C', 'Connect two nodes (source and target dialog)'],
                ['Arrow keys', 'Nudge the selected node by 10 px'],
                ['Shift + Arrow keys', 'Nudge the selected node by 40 px'],
                ['?', 'Toggle this help'],
                ['Escape', 'Close help / clear selection'],
              ].map(([keys, what]) => (
                <div key={keys} className="flex justify-between gap-4">
                  <dt className="font-mono text-cyan-300">{keys}</dt>
                  <dd className="text-right text-slate-400">{what}</dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="mt-4 w-full rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Keyboard-accessible connection workflow */}
      <ConnectDialog
        open={connectOpen}
        nodes={(project?.nodes ?? []).map((n) => ({ id: n.id, label: n.label }))}
        onCancel={() => setConnectOpen(false)}
        onConfirm={async (sourceId, targetId) => {
          const failure = await onConnectNodes(sourceId, targetId);
          if (!failure) setConnectOpen(false);
          return failure;
        }}
      />

      {/* Properties Inspector Panel */}
      <PropertyEditor
        selectedNode={selectedNode}
        selectedLink={selectedLink}
        onClose={() => {
          setSelectedNodeId(null);
          setSelectedLinkId(null);
        }}
        onUpdateNode={onUpdateNode}
        onDeleteNode={onDeleteNode}
        onUpdateLink={onUpdateLink}
        onDeleteLink={onDeleteLink}
        onUpdateInterface={onUpdateInterface}
      />
    </div>
  );
};
