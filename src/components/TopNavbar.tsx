import React, { useState, useRef, useEffect } from 'react';
import {
  Sun, Moon, LogOut, CheckCircle2, ChevronDown,
  Settings, Target, Plug, User,
} from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import { useTheme } from '../context/ThemeContext';
import { useAuth, AVATAR_OPTIONS } from '../context/AuthContext';
import type { ActiveTab } from './LeftNavRail';

const API = 'http://localhost:8000';

// ── Avatar display helper ──────────────────────────────────────────────────────
const UserAvatar: React.FC<{ imageUrl?: string | null; emoji?: string; initials: string; size?: number }> = ({
  imageUrl, emoji, initials, size = 28,
}) => {
  if (imageUrl) {
    return (
      <div
        className="rounded-full overflow-hidden shrink-0"
        style={{ width: size, height: size, border: '2px solid var(--color-border)' }}
      >
        <img src={imageUrl} alt="avatar" className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white shrink-0 select-none"
      style={{
        width: size,
        height: size,
        background: emoji ? 'var(--color-surface-overlay)' : 'linear-gradient(135deg, #6366f1, #10b981)',
        fontSize: emoji ? Math.round(size * 0.55) : Math.round(size * 0.38),
        border: '2px solid var(--color-border)',
      }}
    >
      {emoji ?? initials}
    </div>
  );
};

// ── Dropdown menu tab ──────────────────────────────────────────────────────────
type DropdownTab = 'profile' | 'goals' | 'settings';

const TAB_ITEMS: { id: DropdownTab; icon: React.ReactNode; label: string; sub: string }[] = [
  {
    id: 'profile',
    icon: <User className="w-4 h-4" />,
    label: 'Profil',
    sub: 'Imię, awatar, poziom',
  },
  {
    id: 'goals',
    icon: <Target className="w-4 h-4" />,
    label: 'Cele',
    sub: 'Starty i plan treningowy',
  },
  {
    id: 'settings',
    icon: <Settings className="w-4 h-4" />,
    label: 'Ustawienia',
    sub: 'Połączone konta',
  },
];

// ── Dropdown menu item ─────────────────────────────────────────────────────────
const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  sub?: string;
  danger?: boolean;
  active?: boolean;
  onClick?: () => void;
}> = ({ icon, label, sub, danger, active, onClick }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors duration-100 group"
    style={{
      color: danger ? '#f87171' : 'var(--color-text-primary)',
      background: active ? 'var(--color-surface-elevated)' : 'transparent',
    }}
    onMouseOver={e => {
      (e.currentTarget as HTMLElement).style.background = danger
        ? 'rgba(248,113,113,0.08)'
        : 'var(--color-surface-elevated)';
    }}
    onMouseOut={e => {
      (e.currentTarget as HTMLElement).style.background = active ? 'var(--color-surface-elevated)' : 'transparent';
    }}
  >
    <span className="w-4 h-4 shrink-0" style={{ color: danger ? '#f87171' : active ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
      {icon}
    </span>
    <div className="flex flex-col">
      <span className="text-sm font-medium">{label}</span>
      {sub && <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{sub}</span>}
    </div>
    {active && (
      <span
        className="ml-auto w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: 'var(--color-accent)' }}
      />
    )}
  </button>
);

// ─────────────────────────────────────────────────────────────────────────────

interface TopNavbarProps {
  onNavigate?: (tab: ActiveTab) => void;
  activeTab?: ActiveTab;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({ onNavigate, activeTab }) => {
  const { theme, toggleTheme } = useTheme();
  const { user, isLoggedIn, login, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeDropdownTab, setActiveDropdownTab] = useState<DropdownTab>('profile');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Login feedback state ──
  const [loginError, setLoginError]     = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Auto-clear error after 7 seconds
  useEffect(() => {
    if (!loginError) return;
    const t = setTimeout(() => setLoginError(null), 7000);
    return () => clearTimeout(t);
  }, [loginError]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);



  const handleGoogleSuccess = async (credentialResponse: any) => {
    if (loginLoading) return;           // zapobiega podwójnemu kliknięciu
    setLoginLoading(true);
    setLoginError(null);

    try {
      if (!credentialResponse?.credential) {
        throw new Error('Brak tokenu w odpowiedzi Google.');
      }

      const res = await fetch(`${API}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: credentialResponse.credential }),
      });

      if (!res.ok) {
        // Odczytaj detail z JSON jeśli możliwe
        let detail = `Błąd serwera (HTTP ${res.status})`;
        try { detail = (await res.json()).detail ?? detail; } catch {}
        throw new Error(detail);
      }

      const data = await res.json();
      if (!data.user_id || !data.email) {
        throw new Error('Nieprawidłowa odpowiedź serwera — brak user_id lub email.');
      }

      await login(data.user_id, data.email);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Nieznany błąd logowania.';
      console.error('[GoogleAuth]', msg);
      setLoginError(msg);
    } finally {
      setLoginLoading(false);
    }
  };

  /** Navigate to sidebar tab AND close dropdown */
  const navigateAndClose = (tab: ActiveTab) => {
    onNavigate?.(tab);
    setDropdownOpen(false);
  };

  const handleTabClick = (tab: DropdownTab) => {
    setActiveDropdownTab(tab);
    if (tab === 'profile') navigateAndClose('planner');   // Profile info is in PlannerPanel (goals section)
    if (tab === 'goals') navigateAndClose('planner');
    if (tab === 'settings') {
      // Settings: handle inline (Strava link)
      if (!user?.strava_linked) {
        window.location.href = `${API}/api/auth/strava/login?user_id=${user?.user_id}`;
      }
    }
  };

  // Display name: prefer server-side display_name, fall back to email prefix
  const displayName = user?.display_name || user?.email?.split('@')[0] || 'Runner';
  const initials = displayName.slice(0, 2).toUpperCase();
  // avatar_url (custom upload) takes priority over emoji avatarId
  const avatarImageUrl = user?.avatar_url ?? null;
  const avatarEmoji = !avatarImageUrl && user?.avatarId
    ? AVATAR_OPTIONS.find(a => a.id === user.avatarId)?.emoji
    : undefined;

  return (
    <header
      className="fixed top-0 left-0 right-0 flex items-center justify-between px-5 h-14"
      style={{
        zIndex: 1010,
        background: 'var(--nav-bg)',
        borderBottom: '1px solid var(--nav-border)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      {/* ── Logo ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 select-none">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-black"
            style={{ background: 'linear-gradient(135deg, #6366f1, #10b981)' }}
          >
            A
          </div>
          <span
            className="text-base font-extrabold tracking-tight"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #818cf8, #10b981)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Ace of Pace
          </span>
        </div>
        <span
          className="hidden sm:inline text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
          style={{
            color: 'var(--color-text-muted)',
            background: 'var(--color-surface-overlay)',
            border: '1px solid var(--color-border)',
          }}
        >
          v1.2
        </span>
      </div>

      {/* ── Right controls ───────────────────────────────────────── */}
      <div className="flex items-center gap-2">

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          id="theme-toggle-btn"
          title={theme === 'dark' ? 'Tryb jasny' : 'Tryb ciemny'}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95"
          style={{
            background: 'var(--color-surface-overlay)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* ── User section ───────────────────────────────────────── */}
        {isLoggedIn && user ? (
          <div className="relative" ref={dropdownRef}>
            {/* Trigger */}
            <button
              id="profile-dropdown-trigger"
              onClick={() => setDropdownOpen(o => !o)}
              className="flex items-center gap-2 px-2 py-1 rounded-xl transition-all duration-150"
              style={{
                background: dropdownOpen ? 'var(--color-surface-overlay)' : 'transparent',
                border: '1px solid',
                borderColor: dropdownOpen ? 'var(--color-border)' : 'transparent',
              }}
            >
              <UserAvatar imageUrl={avatarImageUrl} emoji={avatarEmoji} initials={initials} size={28} />
              <span
                className="hidden sm:block text-sm font-semibold max-w-[100px] truncate"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {displayName}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`}
                style={{ color: 'var(--color-text-muted)' }}
              />
            </button>

            {/* Dropdown panel */}
            {dropdownOpen && (
              <div
                id="profile-dropdown-panel"
                className="absolute right-0 top-full mt-2 rounded-2xl overflow-hidden shadow-2xl"
                style={{
                  zIndex: 9999,
                  width: '260px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  boxShadow: '0 24px 48px rgba(0,0,0,0.3)',
                  animation: 'dropdownSlideIn 0.15s ease-out',
                }}
              >
                {/* User identity header */}
                <div
                  className="px-4 py-4 flex items-center gap-3"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <UserAvatar imageUrl={avatarImageUrl} emoji={avatarEmoji} initials={initials} size={40} />
                  <div className="overflow-hidden flex-1">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {displayName}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                      {user.email}
                    </p>
                    {/* Strava badge */}
                    {user.strava_linked && (
                      <div className="flex items-center gap-1 mt-1">
                        <CheckCircle2 className="w-3 h-3" style={{ color: '#fc4c02' }} />
                        <span className="text-[10px] font-bold" style={{ color: '#fc4c02' }}>Strava połączona</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Tabs: Profile / Goals / Settings ── */}
                <div
                  className="flex"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  {TAB_ITEMS.map(tab => (
                    <button
                      key={tab.id}
                      id={`profile-tab-${tab.id}`}
                      onClick={() => setActiveDropdownTab(tab.id)}
                      className="flex-1 flex flex-col items-center py-2.5 gap-0.5 text-[10px] font-bold uppercase tracking-wider transition-all duration-150"
                      style={{
                        color: activeDropdownTab === tab.id ? 'var(--color-accent)' : 'var(--color-text-muted)',
                        borderBottom: activeDropdownTab === tab.id ? '2px solid var(--color-accent)' : '2px solid transparent',
                        background: activeDropdownTab === tab.id ? 'var(--color-accent-subtle)' : 'transparent',
                      }}
                    >
                      <span style={{ color: activeDropdownTab === tab.id ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
                        {tab.icon}
                      </span>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* ── Tab content ── */}
                <div className="py-1">
                  {activeDropdownTab === 'profile' && (
                    <>
                      <MenuItem
                        icon={<User className="w-4 h-4" />}
                        label="Edytuj Profil"
                        sub="Imię, awatar, poziom zaawansowania"
                        onClick={() => navigateAndClose('planner')}
                      />
                      <MenuItem
                        icon={<Target className="w-4 h-4" />}
                        label="Planer treningowy"
                        sub="Cele, plan, kalendarz"
                        onClick={() => navigateAndClose('planner')}
                      />
                    </>
                  )}

                  {activeDropdownTab === 'goals' && (
                    <>
                      <MenuItem
                        icon={<Target className="w-4 h-4" />}
                        label="Twoje Cele"
                        sub="Starty i plany od Kasi"
                        onClick={() => navigateAndClose('planner')}
                      />
                      <MenuItem
                        icon={<CheckCircle2 className="w-4 h-4" />}
                        label="Kalendarz treningowy"
                        sub="Zaplanowane + ukończone"
                        onClick={() => navigateAndClose('planner')}
                      />
                    </>
                  )}

                  {activeDropdownTab === 'settings' && (
                    <>
                      <MenuItem
                        icon={<Plug className="w-4 h-4" />}
                        label="Połączone Konta"
                        sub={user.strava_linked ? 'Strava ✓  ·  Google ✓' : 'Google ✓  ·  Strava —'}
                        onClick={() => {
                          setDropdownOpen(false);
                          if (!user.strava_linked) {
                            window.location.href = `${API}/api/auth/strava/login?user_id=${user.user_id}`;
                          }
                        }}
                      />
                      <MenuItem
                        icon={<Settings className="w-4 h-4" />}
                        label="Preferencje"
                        sub="Motyw, język, powiadomienia"
                        onClick={() => { setDropdownOpen(false); }}
                      />
                    </>
                  )}
                </div>

                {/* Divider + Logout */}
                <div style={{ borderTop: '1px solid var(--color-border)' }} className="py-1">
                  <MenuItem
                    icon={<LogOut className="w-4 h-4" />}
                    label="Wyloguj się"
                    danger
                    onClick={() => { logout(); setDropdownOpen(false); }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Not logged in */
          <div className="flex flex-col items-end gap-1.5">
            <div className="scale-90 origin-right">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => {
                  setLoginError('Logowanie Google nie powiodło się. Spróbuj ponownie.');
                  setLoginLoading(false);
                }}
                theme={theme === 'dark' ? 'filled_black' : 'outline'}
                shape="pill"
                size="medium"
                text="signin"
              />
            </div>
            {/* Error tooltip — pojawia się gdy backend zwróci błąd */}
            {loginError && (
              <div
                role="alert"
                style={{
                  position: 'absolute',
                  top: '52px',
                  right: 16,
                  zIndex: 9999,
                  maxWidth: 320,
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'rgba(239,68,68,0.95)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  boxShadow: '0 4px 20px rgba(239,68,68,0.35)',
                  backdropFilter: 'blur(8px)',
                  lineHeight: 1.4,
                }}
              >
                ❌ {loginError}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
