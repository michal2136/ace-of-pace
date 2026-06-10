import React from 'react';
import {
  Map as MapIcon,
  Route as RouteIcon,
  Activity,
  Target,
  BotMessageSquare,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type ActiveTab = 'mapper' | 'routes' | 'strava' | 'planner' | 'assistant';

interface NavItem {
  id: ActiveTab;
  icon: React.ReactNode;
  label: string;
  requiresAuth?: boolean;
  accentColor?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'mapper',    icon: <MapIcon className="w-5 h-5" />,          label: 'Mapper',   accentColor: '#10b981' },
  { id: 'routes',    icon: <RouteIcon className="w-5 h-5" />,        label: 'Trasy',    accentColor: '#6366f1', requiresAuth: true },
  { id: 'strava',    icon: <Activity className="w-5 h-5" />,         label: 'Treningi', accentColor: '#fc4c02', requiresAuth: true },
  { id: 'planner',   icon: <Target className="w-5 h-5" />,           label: 'Planer',   accentColor: '#8b5cf6', requiresAuth: true },
  { id: 'assistant', icon: <BotMessageSquare className="w-5 h-5" />, label: 'Kasia',    accentColor: '#a855f7', requiresAuth: true },
];

interface LeftNavRailProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}

export const LeftNavRail: React.FC<LeftNavRailProps> = ({ activeTab, onTabChange }) => {
  const { isLoggedIn } = useAuth();

  return (
    <nav
      className="fixed flex flex-col items-center py-3 gap-1"
      style={{
        top: '56px',
        left: 0,
        bottom: 0,
        width: '68px',
        zIndex: 40,
        background: 'var(--nav-bg)',
        borderRight: '1px solid var(--nav-border)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {NAV_ITEMS.map((item) => {
        if (item.requiresAuth && !isLoggedIn) return null;
        const isActive = activeTab === item.id;

        return (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            title={item.label}
            className="relative group flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95"
            style={{
              background: isActive ? `${item.accentColor}18` : 'transparent',
              border: isActive ? `1px solid ${item.accentColor}35` : '1px solid transparent',
              color: isActive ? item.accentColor : 'var(--color-text-muted)',
            }}
          >
            {/* Active indicator dot */}
            {isActive && (
              <span
                className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                style={{ background: item.accentColor }}
              />
            )}

            {/* Icon */}
            <span
              className="transition-colors duration-200"
              style={{ color: isActive ? item.accentColor : 'var(--color-text-muted)' }}
            >
              {item.icon}
            </span>

            {/* Label */}
            <span
              className="text-[9px] font-bold mt-0.5 tracking-wide"
              style={{
                color: isActive ? item.accentColor : 'var(--color-text-muted)',
                letterSpacing: '0.04em',
              }}
            >
              {item.label}
            </span>

            {/* Tooltip on hover */}
            <span
              className="absolute left-full ml-3 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap
                         opacity-0 pointer-events-none group-hover:opacity-100
                         transition-all duration-150 translate-x-1 group-hover:translate-x-0 z-50"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              }}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
