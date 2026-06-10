import React from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { LogOut, User as UserIcon, Link2, CheckCircle2, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const ProfileSection: React.FC = () => {
  const { user, isLoading, isLoggedIn, login, logout, refreshUser } = useAuth();

  const handleGoogleSuccess = async (credentialResponse: any) => {
    try {
      const res = await fetch('http://localhost:8000/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: credentialResponse.credential }),
      });
      if (res.ok) {
        const data = await res.json();
        await login(data.user_id, data.email);
      }
    } catch (err) {
      console.error('Błąd autoryzacji z backendem', err);
    }
  };

  // Sprawdzamy czy powróciliśmy ze Stravy (query param ?strava_linked=true)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('strava_linked') === 'true') {
      refreshUser();
      window.history.replaceState({}, '', '/');
    }
  }, [refreshUser]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4 mb-4">
        <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
      </div>
    );
  }

  // ── ZALOGOWANY ──────────────────────────────────────────────────────────────
  if (isLoggedIn && user) {
    return (
      <div className="flex flex-col gap-2 p-3 bg-gray-950/50 rounded-xl border border-gray-700/50 mb-4">
        {/* Wiersz z awatarem */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500/30 to-indigo-500/30 flex items-center justify-center border border-emerald-500/40 shrink-0">
            <UserIcon className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Zalogowano</p>
            <p className="text-sm text-gray-200 truncate font-semibold">{user.email}</p>
          </div>
          <button
            onClick={logout}
            title="Wyloguj"
            className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-500 hover:text-red-400 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {/* Status Strava */}
        {user.strava_linked ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-[#fc4c02]/10 border border-[#fc4c02]/20 rounded-lg">
            <CheckCircle2 className="w-4 h-4 text-[#fc4c02] shrink-0" />
            <span className="text-xs text-[#fc4c02] font-semibold">Strava połączona ✓</span>
          </div>
        ) : (
          <a
            href={`http://localhost:8000/api/auth/strava/login?user_id=${user.user_id}`}
            className="flex items-center justify-center gap-2 w-full py-2 bg-[#fc4c02]/10 hover:bg-[#fc4c02]/20 border border-[#fc4c02]/30 text-[#fc4c02] rounded-lg text-xs font-bold transition-colors"
          >
            <Link2 className="w-3.5 h-3.5" />
            Połącz ze Stravą
          </a>
        )}
      </div>
    );
  }

  // ── NIEZALOGOWANY ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3 p-3 bg-gray-950/50 rounded-xl border border-gray-700/50 mb-4">
      <p className="text-xs text-center text-gray-400 font-medium">
        Zaloguj się, aby połączyć Stravę i zapisywać trasy.
      </p>
      <div className="flex justify-center w-full">
        <GoogleLogin
          onSuccess={handleGoogleSuccess}
          onError={() => console.error('Google Login Failed')}
          useOneTap
          theme="filled_black"
          shape="pill"
        />
      </div>
    </div>
  );
};
