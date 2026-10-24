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
import { Undo2, Redo2, Network, Cpu } from 'lucide-react';
import { CustomNode } from './CustomNode';
import { DevicePalette } from './DevicePalette';
import { PropertyEditor } from './PropertyEditor';
import { Project } from '../../types/project';
import { NodeType, NodeState, LinkStatus, HistoryStatus } from '../../types/topology';

interface TopologyCanvasProps {
  project: Project | null;
  historyStatus: HistoryStatus;
  onAddNode: (type: NodeType, label: string) => void;
  onConnectNodes: (sourceId: string, targetId: string) => void;
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

  const nodeTypes = useMemo(() => ({ custom: CustomNode }), []);

  const selectedNode = useMemo(() => {
    if (!project || !selectedNodeId) return null;
    return project.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [project, selectedNodeId]);

  const selectedLink = useMemo(() => {
    if (!project || !selectedLinkId) return null;
    return project.links.find((l) => l.id === selectedLinkId) || null;
  }, [project, selectedLinkId]);

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
      },
    }));
  }, [project, selectedNodeId]);

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
        onConnectNodes(params.source, params.target);
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
      onNodePositionChange(node.id, { x: node.position.x, y: node.position.y });
    },
    [onNodePositionChange]
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
  ]);

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden">
      {/* Device Palette */}
      <DevicePalette onAddDevice={onAddNode} />

      {/* Top Topology Canvas Action Bar (docked bottom-center on narrow screens where the
          device palette would otherwise cover it). */}
      <div className="absolute z-10 flex items-center space-x-2 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl px-2 py-1.5 shadow-xl select-none top-auto bottom-4 left-1/2 -translate-x-1/2 lg:top-4 lg:bottom-auto lg:left-64 lg:translate-x-0">
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

        <div className="hidden sm:block w-[1px] h-4 bg-slate-800" />

        {/* Topology Summary Counts */}
        <div className="hidden sm:flex items-center space-x-3 px-2 text-[11px] font-mono text-slate-400">
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
        className="bg-slate-950"
      >
        <Background color="#1e293b" gap={20} size={1} />
        <Controls className="!bg-slate-900 !border-slate-800 !fill-slate-300" />
        <MiniMap
          nodeColor="#38aaf6"
          maskColor="rgba(6, 10, 18, 0.7)"
          className="!bg-slate-900/80 !border-slate-800 !rounded-lg max-sm:!hidden"
        />
      </ReactFlow>

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
