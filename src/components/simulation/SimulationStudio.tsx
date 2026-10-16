import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  StepForward,
  FastForward,
  RotateCcw,
  Send,
  Layers,
  Box,
  Route,
  Clock,
} from 'lucide-react';
import { Project } from '../../types/project';
import { SimulationStateSnapshot } from '../../types/simulation';
import { SimEvent, TimelineEvent, EventFilter } from '../../types/events';
import { Packet, PacketHopRecord } from '../../types/packet';
import { api } from '../../lib/api';
import { formatTimeUs } from '../../lib/utils';
import { PacketInspector } from '../inspector/PacketInspector';
import { EncapsulationViewer } from '../visualization/EncapsulationViewer';
import { PacketJourney } from '../visualization/PacketJourney';
import { PacketMarker } from '../visualization/PacketMarker';
import { EventFilters, initialEventFilter } from '../timeline/EventFilters';
import { EventTimeline } from '../timeline/EventTimeline';
import { EventDetail } from '../timeline/EventDetail';

interface SimulationStudioProps {
  project: Project | null;
}

export const SimulationStudio: React.FC<SimulationStudioProps> = ({ project }) => {
  const [snapshot, setSnapshot] = useState<SimulationStateSnapshot | null>(null);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [selectedLayerIndex, setSelectedLayerIndex] = useState<number | undefined>(undefined);
  const [selectedHopIndex, setSelectedHopIndex] = useState<number | undefined>(undefined);
  const [filter, setFilter] = useState<EventFilter>(initialEventFilter);
  const [rightPanelTab, setRightPanelTab] = useState<'encapsulation' | 'inspector'>('encapsulation');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Packet Injection Modal / Form State
  const [showInjectModal, setShowInjectModal] = useState<boolean>(false);
  const [injectSrc, setInjectSrc] = useState<string>('');
  const [injectDst, setInjectDst] = useState<string>('');
  const [injectSize, setInjectSize] = useState<number>(1000);
  const [injectAppProto, setInjectAppProto] = useState<string>('HTTP');
  const [injectTransProto, setInjectTransProto] = useState<string>('TCP');

  // Initialize node defaults
  useEffect(() => {
    if (project && project.nodes.length >= 2) {
      if (!injectSrc) setInjectSrc(project.nodes[0].id);
      if (!injectDst) setInjectDst(project.nodes[1].id);
    }
  }, [project, injectSrc, injectDst]);

  // Sync state from backend
  const refreshSimulation = useCallback(async () => {
    try {
      const snap = await api.getSimulationState();
      setSnapshot(snap);
      setEvents(snap.recent_events || []);
      if (snap.packets && snap.packets.length > 0) {
        setPackets(snap.packets);
        // Select first packet if none selected
        setSelectedPacketId((prev) => prev || snap.packets![0].id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refreshSimulation();
  }, [refreshSimulation]);

  // Currently selected packet object
  const selectedPacket = useMemo(() => {
    if (!selectedPacketId) return packets[0] || null;
    return packets.find((p) => p.id === selectedPacketId) || packets[0] || null;
  }, [packets, selectedPacketId]);

  // Simulation Controls Handlers
  const handleStep = async () => {
    try {
      const ev = await api.stepSimulation();
      if (ev) {
        setEvents((prev) => [ev, ...prev]);
        if (ev.packet_id) {
          setSelectedPacketId(ev.packet_id);
        }
      }
      await refreshSimulation();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRunBurst = async () => {
    try {
      await api.runSimulationMicros(50_000); // 50ms burst
      await refreshSimulation();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRunAll = async () => {
    try {
      await api.runSimulationUntilEmpty();
      await refreshSimulation();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePause = async () => {
    try {
      const snap = await api.pauseSimulation();
      setSnapshot(snap);
      await refreshSimulation();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReset = async () => {
    try {
      const snap = await api.resetSimulation();
      setSnapshot(snap);
      setEvents([]);
      setPackets(snap.packets || []);
      setSelectedPacketId(null);
      setSelectedEvent(null);
      setSelectedHopIndex(undefined);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleInjectPacket = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const pktId = await api.injectPacket(
        injectSrc,
        injectDst,
        injectSize,
        injectAppProto,
        injectTransProto
      );
      setShowInjectModal(false);
      await refreshSimulation();
      setSelectedPacketId(pktId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Event Selection & Topology Synchronization
  const handleSelectEvent = (ev: TimelineEvent) => {
    setSelectedEvent(ev);
    if (ev.packetId) {
      setSelectedPacketId(ev.packetId);
    }
  };

  const handleSelectHop = (hop: PacketHopRecord) => {
    setSelectedHopIndex(hop.hop_index);
  };

  const availableNodeIds = useMemo(() => {
    return project?.nodes.map((n) => n.id) || ['node-1', 'node-2'];
  }, [project]);

  const availableLinkIds = useMemo(() => {
    return project?.links.map((l) => l.id) || ['link-1'];
  }, [project]);

  const metrics = snapshot?.metrics;
  const isRunning = snapshot?.status === 'running';

  return (
    <div data-testid="simulation-studio" className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden select-none">
      {errorMsg && (
        <div
          role="alert"
          data-testid="simulation-error"
          className="flex items-center justify-between px-4 py-2 bg-rose-950/80 border-b border-rose-800 text-rose-200 text-xs font-mono"
        >
          <span>Simulation command failed: {errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="ml-4 px-2 py-0.5 rounded border border-rose-700 hover:bg-rose-900 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}
      {/* Top Playback & Metrics Toolbar */}
      <div className="h-14 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between px-4 z-10">
        {/* Playback action buttons */}
        <div className="flex items-center space-x-2">
          {isRunning ? (
            <button
              onClick={handlePause}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors shadow-sm cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5 fill-current" />
              <span>Pause</span>
            </button>
          ) : (
            <button
              onClick={handleRunBurst}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-700 hover:bg-cyan-800 text-white transition-colors shadow-sm cursor-pointer"
              title="Advance 50ms virtual simulation time"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Run 50ms</span>
            </button>
          )}

          <button
            onClick={handleStep}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            title="Step Next Discrete Event"
          >
            <StepForward className="w-3.5 h-3.5" />
            <span>Step Event</span>
          </button>

          <button
            onClick={handleRunAll}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            title="Run until event queue is empty"
          >
            <FastForward className="w-3.5 h-3.5" />
            <span>Run All</span>
          </button>

          <button
            onClick={handleReset}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
            title="Reset Simulation Engine"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>

          <div className="h-4 w-px bg-slate-800 mx-1" />

          {/* Inject Packet Button */}
          <button
            onClick={() => setShowInjectModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white transition-colors shadow-sm cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Inject Packet</span>
          </button>
        </div>

        {/* Live Metrics and SimTime */}
        <div className="flex items-center space-x-4 text-xs font-mono">
          <div className="flex items-center space-x-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-400">SimTime:</span>
            <span className="text-cyan-300 font-bold">
              {formatTimeUs(snapshot?.current_time_us || 0)}
            </span>
          </div>

          <div className="flex items-center space-x-3 text-slate-400">
            <div>
              <span>Delivered: </span>
              <span className="text-emerald-400 font-bold">
                {metrics?.packets_delivered ?? 0}
              </span>
            </div>
            <div>
              <span>Dropped: </span>
              <span
                className={`font-bold ${
                  (metrics?.packets_dropped_overflow ?? 0) +
                    (metrics?.packets_dropped_loss ?? 0) +
                    (metrics?.packets_dropped_error ?? 0) +
                    (metrics?.packets_dropped_link_down ?? 0) +
                    (metrics?.packets_dropped_ttl ?? 0) +
                    (metrics?.packets_dropped_no_route ?? 0) >
                  0
                    ? 'text-rose-400'
                    : 'text-slate-400'
                }`}
              >
                {(metrics?.packets_dropped_overflow ?? 0) +
                  (metrics?.packets_dropped_loss ?? 0) +
                  (metrics?.packets_dropped_error ?? 0) +
                  (metrics?.packets_dropped_link_down ?? 0) +
                  (metrics?.packets_dropped_ttl ?? 0) +
                  (metrics?.packets_dropped_no_route ?? 0)}
              </span>
            </div>
            <div>
              <span>Queue: </span>
              <span className="text-amber-400 font-bold">
                {snapshot?.pending_events_count ?? 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main 3-Column Studio Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT COLUMN: Event Filters, Active Packets, Chronological Timeline (380px) */}
        <div className="w-96 border-r border-slate-800 bg-slate-900/60 flex flex-col overflow-hidden">
          {/* Filters */}
          <EventFilters
            filter={filter}
            onChange={setFilter}
            availableNodes={availableNodeIds}
            availableLinks={availableLinkIds}
          />

          {/* Active Packets Carousel */}
          {packets.length > 0 && (
            <div className="p-2.5 border-b border-slate-800 bg-slate-950/40">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span>Active Packets ({packets.length})</span>
                <span className="text-[9px] text-slate-400">Click to inspect</span>
              </div>
              <div className="flex items-center space-x-2 overflow-x-auto pb-1">
                {packets.map((pkt) => (
                  <PacketMarker
                    key={pkt.id}
                    packetId={pkt.id}
                    protocol={pkt.headers.transport.protocol}
                    sizeBytes={pkt.size_bytes}
                    state={pkt.state}
                    isSelected={selectedPacketId === pkt.id}
                    onClick={() => setSelectedPacketId(pkt.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Chronological Event Timeline */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-800/80 flex items-center justify-between text-[11px] font-semibold text-slate-300">
              <span>Chronological Event Trace</span>
              <span className="text-[10px] font-mono text-slate-400">
                {events.length} logged
              </span>
            </div>
            <EventTimeline
              events={events}
              selectedEventId={selectedEvent?.id}
              onSelectEvent={handleSelectEvent}
              filter={filter}
            />
          </div>
        </div>

        {/* CENTER COLUMN: Packet Journey Hop Map (Flex-1) */}
        <div className="flex-1 flex flex-col border-r border-slate-800 bg-slate-950/90 overflow-hidden">
          <div className="h-10 border-b border-slate-800 px-4 flex items-center justify-between bg-slate-900/40">
            <div className="flex items-center space-x-2 text-xs font-semibold text-slate-200">
              <Route className="w-4 h-4 text-emerald-400" />
              <span>Multi-Hop Packet Journey</span>
              {selectedPacket && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300">
                  {selectedPacket.id}
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            <PacketJourney
              packet={selectedPacket}
              selectedHopIndex={selectedHopIndex}
              onSelectHop={handleSelectHop}
            />
          </div>
        </div>

        {/* RIGHT COLUMN: 5-Layer Encapsulation Viewer & Packet Inspector (420px) */}
        <div className="w-[420px] flex flex-col bg-slate-900/70 overflow-hidden">
          {/* Tab selector */}
          <div className="h-10 border-b border-slate-800 px-3 flex items-center justify-between bg-slate-900/90">
            <div className="flex items-center space-x-1">
              <button
                onClick={() => setRightPanelTab('encapsulation')}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  rightPanelTab === 'encapsulation'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>5-Layer Encapsulation</span>
              </button>
              <button
                onClick={() => setRightPanelTab('inspector')}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  rightPanelTab === 'inspector'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Box className="w-3.5 h-3.5" />
                <span>Packet Inspector</span>
              </button>
            </div>
          </div>

          {/* Right Panel Body */}
          <div className="flex-1 overflow-hidden">
            {rightPanelTab === 'encapsulation' ? (
              <EncapsulationViewer
                packet={selectedPacket}
                selectedLayerIndex={selectedLayerIndex}
                onSelectLayer={(lIdx) => setSelectedLayerIndex(lIdx)}
              />
            ) : (
              <PacketInspector
                packet={selectedPacket}
                currentTimeUs={snapshot?.current_time_us}
                activeLayerIndex={selectedLayerIndex}
              />
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM PANEL: Authoritative Event Detail Inspector (140px) */}
      <div className="h-44 border-t border-slate-800 bg-slate-900/95 overflow-y-auto">
        <EventDetail
          event={selectedEvent}
          onSelectPacket={(pktId) => setSelectedPacketId(pktId)}
        />
      </div>

      {/* Inject Packet Modal */}
      {showInjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 select-none">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Send className="w-4 h-4 text-emerald-400" />
                <span>Inject Discrete Packet</span>
              </h3>
              <button
                onClick={() => setShowInjectModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleInjectPacket} className="p-4 space-y-3 font-mono text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                    Source Node
                  </label>
                  <select aria-label="Source Node"
                    value={injectSrc}
                    onChange={(e) => setInjectSrc(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    {availableNodeIds.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                    Destination Node
                  </label>
                  <select aria-label="Destination Node"
                    value={injectDst}
                    onChange={(e) => setInjectDst(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    {availableNodeIds.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                    Payload Size
                  </label>
                  <input aria-label="Payload Size"
                    type="number"
                    min={64}
                    max={65535}
                    value={injectSize}
                    onChange={(e) => setInjectSize(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                    App Protocol
                  </label>
                  <select aria-label="App Protocol"
                    value={injectAppProto}
                    onChange={(e) => setInjectAppProto(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="HTTP">HTTP</option>
                    <option value="DNS">DNS</option>
                    <option value="FTP">FTP</option>
                    <option value="RAW">RAW</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                    Transport
                  </label>
                  <select aria-label="Transport"
                    value={injectTransProto}
                    onChange={(e) => setInjectTransProto(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="TCP">TCP</option>
                    <option value="UDP">UDP</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowInjectModal(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 font-bold text-white shadow-md cursor-pointer"
                >
                  Inject Packet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
