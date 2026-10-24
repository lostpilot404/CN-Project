import React, { useState } from 'react';
import {
  Globe,
  Globe2,
  FolderSync,
  Mail,
  Gauge,
  Package,
} from 'lucide-react';
import { Project } from '../../types/project';
import { Packet } from '../../types/packet';
import { DnsStudio } from './DnsStudio';
import { HttpStudio } from './HttpStudio';
import { FtpStudio } from './FtpStudio';
import { SmtpStudio } from './SmtpStudio';
import { SnmpStudio } from './SnmpStudio';
import { PacketInspector } from '../inspector/PacketInspector';
import { EncapsulationViewer } from '../visualization/EncapsulationViewer';
import { PacketJourney } from '../visualization/PacketJourney';

interface ApplicationWorkspaceProps {
  project?: Project | null;
}

export type ApplicationSubTab = 'dns' | 'http' | 'ftp' | 'smtp' | 'snmp';
type InspectorViewMode = 'inspector' | 'encapsulation' | 'journey';

export const ApplicationWorkspace: React.FC<ApplicationWorkspaceProps> = ({ project }) => {
  const [activeTab, setActiveTab] = useState<ApplicationSubTab>('dns');
  const [selectedPacket, setSelectedPacket] = useState<Packet | null>(null);
  const [inspectorView, setInspectorView] = useState<InspectorViewMode>('inspector');

  const tabs: { id: ApplicationSubTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'dns', label: 'DNS Studio', icon: Globe },
    { id: 'http', label: 'HTTP Studio', icon: Globe2 },
    { id: 'ftp', label: 'FTP Studio', icon: FolderSync },
    { id: 'smtp', label: 'SMTP Studio', icon: Mail },
    { id: 'snmp', label: 'SNMP Studio', icon: Gauge },
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Top Header & Sub-Navigation */}
      <header className="px-4 sm:px-6 py-3 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur flex flex-wrap items-center justify-between gap-x-4 gap-y-2 shrink-0">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-brand-500/20 text-brand-400">
              <Globe className="w-4 h-4" />
            </span>
            Application-Layer Protocols Studio
          </h2>
          <p className="text-xs text-slate-400">
            Educational L7 workflows executing over authoritative L4 TCP/UDP transport &amp; physical link queues.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800/80 max-w-full">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setSelectedPacket(null);
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-brand-600 text-white shadow-sm shadow-brand-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Split Layout: Left Studio Form & Results, Right Inspector/Journey */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Active Protocol Studio */}
        <div className="w-full lg:w-3/5 p-4 overflow-y-auto border-r border-slate-800/60 space-y-4">
          {activeTab === 'dns' && (
            <DnsStudio
              project={project}
              onPacketSelect={setSelectedPacket}
              selectedPacketId={selectedPacket?.id}
            />
          )}
          {activeTab === 'http' && (
            <HttpStudio
              project={project}
              onPacketSelect={setSelectedPacket}
              selectedPacketId={selectedPacket?.id}
            />
          )}
          {activeTab === 'ftp' && (
            <FtpStudio
              project={project}
              onPacketSelect={setSelectedPacket}
              selectedPacketId={selectedPacket?.id}
            />
          )}
          {activeTab === 'smtp' && (
            <SmtpStudio
              project={project}
              onPacketSelect={setSelectedPacket}
              selectedPacketId={selectedPacket?.id}
            />
          )}
          {activeTab === 'snmp' && (
            <SnmpStudio
              project={project}
              onPacketSelect={setSelectedPacket}
              selectedPacketId={selectedPacket?.id}
            />
          )}
        </div>

        {/* Right: Integrated Phase 5 Packet Inspector & Journey */}
        <div className="hidden lg:flex lg:w-2/5 flex-col bg-slate-900/30 overflow-hidden">
          {/* Header & View Mode Switcher */}
          <div className="p-3 border-b border-slate-800/80 flex flex-wrap gap-2 items-center justify-between shrink-0 bg-slate-900/60">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-brand-400" />
              <span className="text-xs font-bold text-slate-200">
                {selectedPacket ? `Packet: ${selectedPacket.id}` : '5-Layer Packet Inspector'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setInspectorView('inspector')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  inspectorView === 'inspector'
                    ? 'bg-brand-600/30 text-brand-300 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Headers
              </button>
              <button
                type="button"
                onClick={() => setInspectorView('encapsulation')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  inspectorView === 'encapsulation'
                    ? 'bg-brand-600/30 text-brand-300 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Encapsulation
              </button>
              <button
                type="button"
                onClick={() => setInspectorView('journey')}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  inspectorView === 'journey'
                    ? 'bg-brand-600/30 text-brand-300 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Journey
              </button>
            </div>
          </div>

          {/* View Container */}
          <div className="flex-1 p-3 overflow-y-auto">
            {inspectorView === 'inspector' && (
              <PacketInspector packet={selectedPacket} />
            )}
            {inspectorView === 'encapsulation' && (
              <EncapsulationViewer packet={selectedPacket} />
            )}
            {inspectorView === 'journey' && (
              <PacketJourney packet={selectedPacket} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
