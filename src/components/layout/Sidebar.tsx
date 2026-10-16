import {
  Network,
  Route,
  Hash,
  PlayCircle,
  Binary,
  ArrowLeftRight,
  BarChart3,
  FlaskConical,
  Globe,
  Cable,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { BackendStatus } from '../../lib/apiClient';

export type ActiveTab =
  | 'topology'
  | 'routing'
  | 'addressing'
  | 'simulation'
  | 'algorithms'
  | 'transport'
  | 'application'
  | 'switching'
  | 'qos'
  | 'experiments';

interface SidebarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  backendStatus?: BackendStatus;
  backendVersion?: string | null;
}

import type { ComponentType } from 'react';

export const Sidebar = ({
  activeTab,
  onTabChange,
  backendStatus = 'unknown',
  backendVersion = null,
}: SidebarProps) => {
  const navItems: { id: ActiveTab; label: string; icon: ComponentType<{ className?: string }> }[] = [
    { id: 'topology', label: 'Topology Canvas', icon: Network },
    { id: 'routing', label: 'Routing Studio', icon: Route },
    { id: 'addressing', label: 'Addressing & NAT', icon: Hash },
    { id: 'simulation', label: 'Simulation & Events', icon: PlayCircle },
    { id: 'algorithms', label: 'Algorithm Studio', icon: Binary },
    { id: 'transport', label: 'Transport Layer', icon: ArrowLeftRight },
    { id: 'application', label: 'Application Layer', icon: Globe },
    { id: 'switching', label: 'Circuit Switching', icon: Cable },
    { id: 'qos', label: 'QoS Performance', icon: BarChart3 },
    { id: 'experiments', label: 'Batch Experiments', icon: FlaskConical },
  ];

  // Engine status is derived from a real health probe of the Python simulation service.
  const engineStatus =
    backendStatus === 'online'
      ? { label: 'ONLINE', className: 'text-emerald-400', dot: 'bg-emerald-400' }
      : backendStatus === 'connecting'
        ? { label: 'CHECKING', className: 'text-amber-300', dot: 'bg-amber-300 animate-pulse' }
        : backendStatus === 'offline'
          ? { label: 'OFFLINE', className: 'text-rose-400', dot: 'bg-rose-400' }
          : { label: 'UNKNOWN', className: 'text-slate-400', dot: 'bg-slate-500' };

  return (
    <aside className="w-14 md:w-56 bg-slate-900/90 border-r border-slate-800 flex flex-col justify-between select-none py-3">
      <div className="space-y-1 px-2">
        <div className="hidden md:block px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Workspaces
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              aria-label={item.label}
              title={item.label}
              className={cn(
                'w-full flex items-center justify-center md:justify-start space-x-0 md:space-x-2.5 px-2 md:px-3 py-2 rounded-lg text-xs font-medium transition-all text-left',
                isActive
                  ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
              )}
            >
              <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-brand-400' : 'text-slate-400')} />
              <span className="hidden md:inline">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="px-2 md:px-4 py-2 border-t border-slate-800/60 text-[11px] text-slate-400">
        <div className="flex flex-col md:flex-row items-center md:justify-between gap-0.5 md:gap-0">
          <span className="hidden md:inline">Simulation Engine:</span>
          <span className={cn('font-mono font-semibold flex items-center space-x-1.5 text-[9px] md:text-[11px]', engineStatus.className)}>
            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', engineStatus.dot)} aria-hidden="true" />
            <span data-testid="engine-status">{engineStatus.label}</span>
          </span>
        </div>
        <div className="hidden md:block mt-1 text-[10px] text-slate-400">
          {backendVersion ? `Python core v${backendVersion}` : 'Python core • HTTP JSON-RPC'}
        </div>
      </div>
    </aside>
  );
};
