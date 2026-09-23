import React from 'react';
import { Layers, ChevronUp, ChevronDown } from 'lucide-react';
import { SimEvent, TimelineEvent } from '../../types/events';
import { EventTimeline } from './EventTimeline';

interface TimelineDrawerProps {
  events: SimEvent[];
  isOpen: boolean;
  onToggle: () => void;
  selectedEventId?: number | null;
  onSelectEvent?: (event: TimelineEvent) => void;
}

export const TimelineDrawer: React.FC<TimelineDrawerProps> = ({
  events,
  isOpen,
  onToggle,
  selectedEventId,
  onSelectEvent,
}) => {
  return (
    <div
      data-testid="timeline-drawer"
      className={`border-t border-slate-800 bg-slate-900/95 backdrop-blur-md transition-all duration-300 flex flex-col z-20 ${
        isOpen ? 'h-64' : 'h-8'
      }`}
    >
      {/* Header bar */}
      <div
        onClick={onToggle}
        className="h-8 px-4 flex items-center justify-between cursor-pointer hover:bg-slate-800/60 select-none"
      >
        <div className="flex items-center space-x-2 text-xs font-medium text-slate-300">
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          <span>Authoritative Discrete Event Timeline</span>
          <span className="text-[10px] font-mono px-2 py-0.2 bg-slate-800 text-slate-400 rounded-full">
            {events.length} events logged
          </span>
        </div>
        <button className="text-slate-400 hover:text-white">
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {/* Events table reusing unified EventTimeline */}
      {isOpen && (
        <EventTimeline
          events={events}
          selectedEventId={selectedEventId}
          onSelectEvent={(ev) => onSelectEvent?.(ev)}
        />
      )}
    </div>
  );
};
