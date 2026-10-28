import type { ComponentType } from 'react';
import { Laptop, Server, Router, Network, Wifi, Cpu, Plus } from 'lucide-react';
import { NodeType } from '../../types/topology';

interface DevicePaletteProps {
  onAddDevice: (type: NodeType, label: string) => void;
}

export const DevicePalette = ({ onAddDevice }: DevicePaletteProps) => {
  const devices: { type: NodeType; label: string; icon: ComponentType<{ className?: string }> }[] = [
    { type: 'pc', label: 'Workstation PC', icon: Laptop },
    { type: 'router', label: 'Core Router', icon: Router },
    { type: 'switch', label: 'L2 Switch', icon: Network },
    { type: 'server', label: 'Web Server', icon: Server },
    { type: 'access_point', label: 'Wireless AP', icon: Wifi },
    { type: 'generic', label: 'Generic Host', icon: Cpu },
  ];

  return (
    <div className="absolute bottom-4 left-4 z-10 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl px-2 py-1.5 shadow-xl flex flex-wrap items-center gap-1 select-none">
      <div className="px-1.5 text-[10px] font-semibold tracking-wider text-slate-400">
        Add Devices
      </div>
      {devices.map((device) => {
        const Icon = device.icon;
        return (
          <button
            key={device.type}
            onClick={() => onAddDevice(device.type, device.label)}
            title={`Add ${device.label}`}
            aria-label={`Add ${device.label}`}
            className="flex items-center space-x-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors border border-transparent hover:border-slate-700"
          >
            <div className="w-5 h-5 rounded bg-slate-800 flex items-center justify-center text-brand-400">
              <Icon className="w-3 h-3" />
            </div>
            <span>{device.label}</span>
            <Plus className="w-3 h-3 text-slate-400" />
          </button>
        );
      })}
    </div>
  );
};
