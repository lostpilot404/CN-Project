import React from 'react';
import { Search, RotateCcw } from 'lucide-react';
import { EventFilter } from '../../types/events';

interface EventFiltersProps {
  filter: EventFilter;
  onChange: (filter: EventFilter) => void;
  availableNodes?: string[];
  availableLinks?: string[];
}

export const initialEventFilter: EventFilter = {
  eventType: 'all',
  layer: 'all',
  protocol: 'all',
  nodeId: 'all',
  linkId: 'all',
  packetId: '',
  status: 'all',
  searchQuery: '',
};

export const EventFilters: React.FC<EventFiltersProps> = ({
  filter,
  onChange,
  availableNodes = [],
  availableLinks = [],
}) => {
  const handleReset = () => {
    onChange({ ...initialEventFilter });
  };

  return (
    <div data-testid="event-filters" className="p-3 bg-slate-900/80 border-b border-slate-800 space-y-2.5 select-none">
      {/* Search and Quick Reset */}
      <div className="flex items-center justify-between space-x-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search events, packet ID, description..."
            value={filter.searchQuery}
            onChange={(e) => onChange({ ...filter, searchQuery: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-cyan-500 font-mono"
          />
        </div>

        <button
          onClick={handleReset}
          title="Reset all filters"
          className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reset</span>
        </button>
      </div>

      {/* Multi-Dimensional Dropdown Selectors (this panel always lives in the narrow
          timeline column, so viewport breakpoints only ever squeezed it: keep 2 columns). */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Layer Filter */}
        <div>
          <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">
            Layer
          </label>
          <select aria-label="Layer"
            value={filter.layer}
            onChange={(e) => onChange({ ...filter, layer: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-[11px]"
          >
            <option value="all">All Layers</option>
            <option value="Application">Application</option>
            <option value="Transport">Transport</option>
            <option value="Network">Network</option>
            <option value="Data Link">Data Link</option>
            <option value="Physical">Physical</option>
          </select>
        </div>

        {/* Protocol Filter */}
        <div>
          <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">
            Protocol
          </label>
          <select aria-label="Protocol"
            value={filter.protocol}
            onChange={(e) => onChange({ ...filter, protocol: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-[11px]"
          >
            <option value="all">All Protocols</option>
            <option value="TCP">TCP</option>
            <option value="UDP">UDP</option>
            <option value="HTTP">HTTP</option>
            <option value="IPv4">IPv4</option>
            <option value="Ethernet">Ethernet</option>
            <option value="Routing">Routing</option>
          </select>
        </div>

        {/* Event Type Filter */}
        <div>
          <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">
            Event Type
          </label>
          <select aria-label="Event Type"
            value={filter.eventType}
            onChange={(e) => onChange({ ...filter, eventType: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-[11px]"
          >
            <option value="all">All Events</option>
            <option value="packet_created">Packet Created</option>
            <option value="queue_entered">Queue Entered</option>
            <option value="transmission_started">Transmission Started</option>
            <option value="transmission_finished">Transmission Finished</option>
            <option value="packet_arrived">Packet Arrived</option>
            <option value="packet_dropped">Packet Dropped</option>
            <option value="route_updated">Route Updated</option>
            <option value="fault_injected">Fault Injected</option>
            <option value="timer_expired">Timer Expired</option>
            <option value="application_event">Application Event</option>
          </select>
        </div>

        {/* Status Filter */}
        <div>
          <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">
            Status
          </label>
          <select aria-label="Status"
            value={filter.status}
            onChange={(e) => onChange({ ...filter, status: e.target.value as EventFilter['status'] })}
            className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-[11px]"
          >
            <option value="all">All Statuses</option>
            <option value="success">Success / Delivered</option>
            <option value="dropped">Dropped</option>
            <option value="error">Error / Corrupted</option>
            <option value="retransmission">Retransmissions</option>
          </select>
        </div>

        {/* Node Filter */}
        <div>
          <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">
            Node
          </label>
          <select aria-label="Node"
            value={filter.nodeId}
            onChange={(e) => onChange({ ...filter, nodeId: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-[11px]"
          >
            <option value="all">All Nodes</option>
            {availableNodes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        {/* Link Filter */}
        <div>
          <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">
            Link
          </label>
          <select aria-label="Link"
            value={filter.linkId}
            onChange={(e) => onChange({ ...filter, linkId: e.target.value })}
            className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-[11px]"
          >
            <option value="all">All Links</option>
            {availableLinks.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
