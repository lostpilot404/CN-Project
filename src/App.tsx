import { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/layout/Navbar';
import { Sidebar, ActiveTab } from './components/layout/Sidebar';
import { TopologyCanvas } from './components/topology/TopologyCanvas';
import { RoutingWorkspace } from './components/routing/RoutingWorkspace';
import { AddressingWorkspace } from './components/addressing/AddressingWorkspace';
import { ControlBar } from './components/simulation/ControlBar';
import { TimelineDrawer } from './components/timeline/TimelineDrawer';
import { api } from './lib/tauri';
import { Project } from './types/project';
import { NodeType, NodeState, LinkStatus, HistoryStatus } from './types/topology';
import { SimulationStatus, SimEvent, SimulationMetrics } from './types/simulation';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('topology');
  const [project, setProject] = useState<Project | null>(null);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>({
    can_undo: false,
    can_redo: false,
  });
  const [currentTimeUs, setCurrentTimeUs] = useState<number>(0);
  const [simStatus, setSimStatus] = useState<SimulationStatus>('ready');
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [pendingEventsCount, setPendingEventsCount] = useState<number>(0);
  const [metrics, setMetrics] = useState<SimulationMetrics | undefined>(undefined);
  const [isTimelineOpen, setIsTimelineOpen] = useState<boolean>(true);
  const [toast, setToast] = useState<{
    message: string;
    type: 'error' | 'success' | 'info';
  } | null>(null);

  const showToast = useCallback(
    (message: string, type: 'error' | 'success' | 'info' = 'error') => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 4000);
    },
    []
  );

  // Load project on mount
  const refreshProject = useCallback(async () => {
    try {
      const proj = await api.getProject();
      setProject(proj);
      try {
        const hStatus = await api.getTopologyHistoryStatus();
        setHistoryStatus(hStatus);
      } catch {
        // history status fallback
      }
    } catch (err) {
      console.error('Failed to load project from core:', err);
    }
  }, []);

  const refreshSimulation = useCallback(async () => {
    try {
      const snap = await api.getSimulationState();
      setCurrentTimeUs(snap.current_time_us);
      setSimStatus(snap.status);
      setEvents(snap.recent_events);
      setPendingEventsCount(snap.pending_events_count);
      setMetrics(snap.metrics);
    } catch (err) {
      console.error('Failed to sync simulation state:', err);
    }
  }, []);

  useEffect(() => {
    refreshProject();
    refreshSimulation();
  }, [refreshProject, refreshSimulation]);

  const handleNewProject = async () => {
    try {
      const newProj = await api.createProject('New Network Topology');
      setProject(newProj);
      await refreshProject();
      await refreshSimulation();
    } catch (err) {
      console.error('Error creating project:', err);
    }
  };

  const handleSaveProject = async () => {
    try {
      const json = await api.saveProjectJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project?.metadata.name.replace(/\s+/g, '_') || 'netsim_project'}.netsim`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting project:', err);
    }
  };

  const handleResetProject = async () => {
    try {
      const snap = await api.resetSimulation();
      setCurrentTimeUs(snap.current_time_us);
      setSimStatus(snap.status);
      setEvents([]);
    } catch (err) {
      console.error('Error resetting simulation:', err);
    }
  };

  const handleAddNode = async (type: NodeType, label: string) => {
    try {
      const x = 200 + Math.random() * 300;
      const y = 150 + Math.random() * 200;
      await api.addNode(label, type, x, y);
      await refreshProject();
    } catch (err) {
      console.error('Error adding node:', err);
    }
  };

  const handleUpdateNode = async (nodeId: string, label: string, state: NodeState) => {
    await api.updateNode(nodeId, label, state);
    await refreshProject();
  };

  const handleNodePositionChange = async (
    nodeId: string,
    position: { x: number; y: number }
  ) => {
    try {
      await api.updateNode(nodeId, undefined, undefined, position);
      await refreshProject();
    } catch (err) {
      console.error('Error updating node position:', err);
    }
  };

  const handleDeleteNode = async (nodeId: string) => {
    await api.removeNode(nodeId);
    await refreshProject();
    await refreshSimulation();
  };

  const handleConnectNodes = async (sourceId: string, targetId: string) => {
    try {
      await api.addLink(sourceId, targetId);
      await refreshProject();
      await refreshSimulation();
      showToast('Connection created successfully', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg, 'error');
    }
  };

  const handleUpdateLink = async (
    linkId: string,
    bandwidthBps: number,
    delayUs: number,
    lossProb: number,
    ber: number,
    queueCap: number,
    status: LinkStatus
  ) => {
    await api.updateLink(
      linkId,
      bandwidthBps,
      delayUs,
      lossProb,
      ber,
      queueCap,
      status
    );
    await refreshProject();
    await refreshSimulation();
  };

  const handleDeleteLink = async (linkId: string) => {
    await api.removeLink(linkId);
    await refreshProject();
    await refreshSimulation();
  };

  const handleUpdateInterface = async (
    nodeId: string,
    interfaceId: string,
    ipv4?: string,
    subnetMask?: string,
    status?: 'up' | 'down'
  ) => {
    await api.updateInterface(
      nodeId,
      interfaceId,
      ipv4,
      subnetMask,
      undefined,
      undefined,
      status
    );
    await refreshProject();
  };

  const handleUndo = async () => {
    try {
      await api.undoTopology();
      await refreshProject();
      await refreshSimulation();
    } catch (err) {
      console.error('Error executing undo:', err);
    }
  };

  const handleRedo = async () => {
    try {
      await api.redoTopology();
      await refreshProject();
      await refreshSimulation();
    } catch (err) {
      console.error('Error executing redo:', err);
    }
  };

  const handleStep = async () => {
    try {
      const ev = await api.stepSimulation();
      if (ev) {
        setEvents((prev) => [ev, ...prev]);
      }
      await refreshSimulation();
    } catch (err) {
      console.error('Error stepping simulation:', err);
    }
  };

  const handleRunBurst = async () => {
    try {
      await api.runSimulationMicros(50_000); // 50 ms virtual time burst
      await refreshSimulation();
    } catch (err) {
      console.error('Error running simulation burst:', err);
    }
  };

  const handleRunAll = async () => {
    try {
      await api.runSimulationUntilEmpty();
      await refreshSimulation();
    } catch (err) {
      console.error('Error running simulation to empty:', err);
    }
  };

  const handlePause = async () => {
    try {
      const snap = await api.pauseSimulation();
      setSimStatus(snap.status);
      await refreshSimulation();
    } catch (err) {
      console.error('Error pausing simulation:', err);
    }
  };

  const handleSendDemoPacket = async () => {
    try {
      if (project && project.nodes.length >= 2) {
        const src = project.nodes[0].id;
        const dst = project.nodes[1].id;
        await api.injectPacket(src, dst, 1000, 'HTTP', 'TCP');
      } else {
        await api.injectPacket('node-1', 'node-2', 1000, 'HTTP', 'TCP');
      }
      await refreshSimulation();
    } catch (err) {
      console.error('Error injecting packet:', err);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 overflow-hidden text-slate-100 font-sans">
      {/* Top Authoritative Navbar */}
      <Navbar
        project={project}
        currentTimeUs={currentTimeUs}
        onNewProject={handleNewProject}
        onSaveProject={handleSaveProject}
        onResetProject={handleResetProject}
      />

      {/* Main App Body */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="flex-1 flex flex-col relative overflow-hidden">
          {activeTab === 'topology' ? (
            <TopologyCanvas
              project={project}
              historyStatus={historyStatus}
              onAddNode={handleAddNode}
              onConnectNodes={handleConnectNodes}
              onUpdateNode={handleUpdateNode}
              onNodePositionChange={handleNodePositionChange}
              onDeleteNode={handleDeleteNode}
              onUpdateLink={handleUpdateLink}
              onDeleteLink={handleDeleteLink}
              onUpdateInterface={handleUpdateInterface}
              onUndo={handleUndo}
              onRedo={handleRedo}
            />
          ) : activeTab === 'routing' ? (
            <RoutingWorkspace project={project} />
          ) : activeTab === 'addressing' ? (
            <AddressingWorkspace project={project} />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-slate-950 text-slate-400 p-8 text-center">
              <div>
                <h3 className="text-base font-semibold text-slate-200 capitalize">
                  {activeTab.replace('_', ' ')} Workspace
                </h3>
                <p className="text-xs text-slate-400 mt-1 max-w-md">
                  Phase 4A authoritative networking algorithms active: Dijkstra Link-State, Bellman-Ford Distance-Vector, IPv4/CIDR, VLSM, Duplicate IP detection, IPv6 RFC 5952, and stateful NAT/NAPT.
                </p>
              </div>
            </div>
          )}

          {/* Bottom Timeline Drawer */}
          <TimelineDrawer
            events={events}
            isOpen={isTimelineOpen}
            onToggle={() => setIsTimelineOpen(!isTimelineOpen)}
          />

          {/* Simulation Control Bar */}
          <ControlBar
            status={simStatus}
            onStep={handleStep}
            onRunBurst={handleRunBurst}
            onRunAll={handleRunAll}
            onPause={handlePause}
            onReset={handleResetProject}
            onSendDemoPacket={handleSendDemoPacket}
            eventsCount={events.length}
            pendingCount={pendingEventsCount}
            metrics={metrics}
          />
          {/* Toast Notification */}
          {toast && (
            <div
              data-testid="toast-notification"
              className={`fixed bottom-16 right-6 z-50 px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-md border text-xs font-medium flex items-center space-x-2 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 ${
                toast.type === 'error'
                  ? 'bg-rose-950/90 text-rose-200 border-rose-800/80 shadow-rose-950/50'
                  : toast.type === 'success'
                  ? 'bg-emerald-950/90 text-emerald-200 border-emerald-800/80 shadow-emerald-950/50'
                  : 'bg-slate-900/90 text-slate-200 border-slate-800 shadow-slate-950/50'
              }`}
            >
              <span>{toast.message}</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
