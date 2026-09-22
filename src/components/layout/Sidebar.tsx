import {
  Network,
  PlayCircle,
  Binary,
  BarChart3,
  FlaskConical,
  GraduationCap,
  BookOpenCheck,
} from 'lucide-react';
import { cn } from '../../lib/utils';

export type ActiveTab =
  | 'topology'
  | 'simulation'
  | 'algorithms'
  | 'qos'
  | 'experiments'
  | 'learning'
  | 'exam';

interface SidebarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}

import type { ComponentType } from 'react';

export const Sidebar = ({ activeTab, onTabChange }: SidebarProps) => {
  const navItems: { id: ActiveTab; label: string; icon: ComponentType<{ className?: string }> }[] = [
    { id: 'topology', label: 'Topology Canvas', icon: Network },
    { id: 'simulation', label: 'Simulation & Events', icon: PlayCircle },
    { id: 'algorithms', label: 'Algorithm Studio', icon: Binary },
    { id: 'qos', label: 'QoS Performance', icon: BarChart3 },
    { id: 'experiments', label: 'Batch Experiments', icon: FlaskConical },
    { id: 'learning', label: 'Learning Mode', icon: GraduationCap },
    { id: 'exam', label: 'Exam Mode', icon: BookOpenCheck },
  ];

  return (
    <aside className="w-56 bg-slate-900/90 border-r border-slate-800 flex flex-col justify-between select-none py-3">
      <div className="space-y-1 px-2">
        <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Workspaces
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={cn(
                'w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left',
                isActive
                  ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
              )}
            >
              <Icon className={cn('w-4 h-4', isActive ? 'text-brand-400' : 'text-slate-400')} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="px-4 py-2 border-t border-slate-800/60 text-[11px] text-slate-400">
        <div className="flex items-center justify-between">
          <span>Simulation Engine:</span>
          <span className="font-mono text-emerald-400 font-semibold">ONLINE</span>
        </div>
        <div className="mt-1 text-[10px] text-slate-400">Tauri 2.x • Rust Core</div>
      </div>
    </aside>
  );
};
