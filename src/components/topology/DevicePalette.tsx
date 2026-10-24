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
    <div className="absolute top-4 left-4 z-10 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-2 shadow-xl flex flex-col space-y-1 select-none">
      <div className="hidden sm:block px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Add Devices
      </div>
      <div className="grid grid-cols-1 gap-1">
        {devices.map((device) => {
          const Icon = device.icon;
          return (
            <button
              key={device.type}
              onClick={() => onAddDevice(device.type, device.label)}
              title={device.label}
              aria-label={`Add ${device.label}`}
              className="flex items-center sm:space-x-2.5 p-1.5 sm:px-3 sm:py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors border border-transparent hover:border-slate-700 sm:text-left"
            >
              <div className="w-6 h-6 rounded bg-slate-800 flex items-center justify-center text-brand-400">
                <Icon className="w-3.5 h-3.5" />
              </div>
              <span className="hidden sm:inline flex-1">{device.label}</span>
              <Plus className="hidden sm:block w-3 h-3 text-slate-400" />
            </button>
          );
        })}
      </div>
    </div>
  );
};
