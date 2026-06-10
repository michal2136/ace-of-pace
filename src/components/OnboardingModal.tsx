import React, { useState, useRef } from 'react';
import { ChevronRight, Loader2, Upload } from 'lucide-react';
import { AVATAR_OPTIONS, AvatarId, useAuth } from '../context/AuthContext';

const API = 'http://localhost:8000';

interface OnboardingModalProps {
  onComplete: () => void;
}

const GOAL_OPTIONS = [
  { id: '5k',       label: '5 km',       emoji: '🏃' },
  { id: '10k',      label: '10 km',      emoji: '🔥' },
  { id: 'half',     label: 'Półmaraton', emoji: '🥈' },
  { id: 'marathon', label: 'Maraton',    emoji: '🏅' },
  { id: 'ultra',    label: 'Ultra',      emoji: '🌄' },
];

const LEVEL_OPTIONS = [
  { id: 'beginner',     label: 'Początkujący',           desc: 'Dopiero zaczynam biegać' },
  { id: 'intermediate', label: 'Średnio-zaawansowany',   desc: 'Biegnę regularnie od roku' },
  { id: 'advanced',     label: 'Pro',                    desc: 'Startuję w zawodach' },
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ onComplete }) => {
  const { user, updateProfile } = useAuth();
  const [step, setStep]               = useState<1 | 2 | 3>(1);
  const [displayName, setDisplayName] = useState('');
  const [selectedGoal, setSelectedGoal]   = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarId | null>(null);
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null);
  const [uploadPreview, setUploadPreview]     = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving]       = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Avatar upload ──────────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Local preview
    const objectUrl = URL.createObjectURL(file);
    setUploadPreview(objectUrl);
    setSelectedAvatar(null); // deselect emoji avatar

    setUploading(true);
    try {
      const form = new FormData();
      form.append('user_id', String(user.user_id));
      form.append('file', file);
      const res = await fetch(`${API}/api/user/profile/avatar`, { method: 'POST', body: form });
      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || 'Błąd uploadu');
        setUploadPreview(null);
        return;
      }
      const { avatar_url } = await res.json();
      setCustomAvatarUrl(avatar_url);
    } catch {
      alert('Błąd połączenia podczas uploadu.');
      setUploadPreview(null);
    } finally {
      setUploading(false);
    }
  };

  // ── Save & close ──────────────────────────────────────────────────────────
  const handleFinish = async () => {
    if (!displayName.trim()) return;
    setSaving(true);
    await updateProfile({
      display_name:   displayName.trim(),
      avatarId:       selectedAvatar ?? undefined,
      fitness_level:  selectedLevel  ?? null,
      training_goal:  selectedGoal   ?? null,
      onboarding_done: true,
      // avatar_url handled separately by upload endpoint
    } as any);
    setSaving(false);
    onComplete();
  };

  const canNext1 = displayName.trim().length >= 2;
  const canNext2 = !!selectedGoal && !!selectedLevel;
  const canFinish = (!!selectedAvatar || !!customAvatarUrl) && !uploading;

  const stepLabel = ['Twój profil', 'Twój cel', 'Wybierz awatara'];

  // Preview emoji for header
  const headerEmoji = uploadPreview ? null : (selectedAvatar
    ? AVATAR_OPTIONS.find(a => a.id === selectedAvatar)?.emoji
    : null);

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          maxHeight: '90vh',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div
          className="px-6 py-5 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              {[1, 2, 3].map(n => (
                <div
                  key={n}
                  className="h-1.5 rounded-full transition-all duration-300"
                  style={{
                    width: n === step ? '24px' : '8px',
                    background: n <= step ? 'var(--color-accent)' : 'var(--color-border)',
                  }}
                />
              ))}
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
              Krok {step} z 3
            </p>
            <h2 className="text-lg font-bold mt-0.5" style={{ color: 'var(--color-text-primary)' }}>
              {stepLabel[step - 1]}
            </h2>
          </div>
          {/* Live avatar preview */}
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-2xl overflow-hidden"
            style={{ background: 'var(--color-surface-overlay)', border: '2px solid var(--color-border)' }}
          >
            {uploadPreview
              ? <img src={uploadPreview} alt="preview" className="w-full h-full object-cover" />
              : (headerEmoji ?? '👤')
            }
          </div>
        </div>

        {/* ── Content ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">

          {/* Step 1 — Imię */}
          {step === 1 && (
            <div className="flex flex-col gap-5">
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Witaj w Smart Loop! Powiedz nam kilka słów o sobie, żeby Kasia mogła lepiej dopasować treningi. 🏃
              </p>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>
                  Jak masz na imię?
                </label>
                <input
                  autoFocus
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && canNext1 && setStep(2)}
                  placeholder="np. Michał"
                  maxLength={32}
                  className="input-base w-full text-base"
                />
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  To Twoja nazwa widoczna w aplikacji.
                </p>
              </div>
            </div>
          )}

          {/* Step 2 — Cel + Poziom */}
          {step === 2 && (
            <div className="flex flex-col gap-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)' }}>
                  Twój główny cel biegowy
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {GOAL_OPTIONS.map(g => (
                    <button
                      key={g.id}
                      onClick={() => setSelectedGoal(g.id)}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-center transition-all duration-150 hover:scale-[1.02]"
                      style={{
                        background: selectedGoal === g.id ? 'var(--color-accent-subtle)' : 'var(--color-surface-elevated)',
                        border: selectedGoal === g.id ? '2px solid var(--color-accent)' : '2px solid transparent',
                      }}
                    >
                      <span className="text-2xl">{g.emoji}</span>
                      <span className="text-xs font-bold" style={{ color: 'var(--color-text-primary)' }}>{g.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)' }}>
                  Twój poziom
                </label>
                <div className="flex flex-col gap-2">
                  {LEVEL_OPTIONS.map(l => (
                    <button
                      key={l.id}
                      onClick={() => setSelectedLevel(l.id)}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-150"
                      style={{
                        background: selectedLevel === l.id ? 'var(--color-accent-subtle)' : 'var(--color-surface-elevated)',
                        border: selectedLevel === l.id ? '2px solid var(--color-accent)' : '2px solid transparent',
                      }}
                    >
                      <div
                        className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
                        style={{ borderColor: selectedLevel === l.id ? 'var(--color-accent)' : 'var(--color-border-strong)' }}
                      >
                        {selectedLevel === l.id && (
                          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-accent)' }} />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{l.label}</p>
                        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{l.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — Avatar */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Wybierz zwierzęcego patrona lub wgraj własne zdjęcie.
              </p>

              {/* Emoji grid */}
              <div className="grid grid-cols-3 gap-3">
                {AVATAR_OPTIONS.map(av => (
                  <button
                    key={av.id}
                    onClick={() => { setSelectedAvatar(av.id); setUploadPreview(null); setCustomAvatarUrl(null); }}
                    className="flex flex-col items-center gap-2 p-4 rounded-2xl transition-all duration-200 hover:scale-105"
                    style={{
                      background: selectedAvatar === av.id && !uploadPreview ? 'var(--color-accent-subtle)' : 'var(--color-surface-elevated)',
                      border: selectedAvatar === av.id && !uploadPreview ? '2px solid var(--color-accent)' : '2px solid var(--color-border)',
                      boxShadow: selectedAvatar === av.id && !uploadPreview ? '0 0 0 3px var(--color-accent-subtle)' : 'none',
                    }}
                  >
                    <span className="text-4xl leading-none select-none">{av.emoji}</span>
                    <span
                      className="text-[11px] font-bold"
                      style={{ color: selectedAvatar === av.id && !uploadPreview ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}
                    >
                      {av.label}
                    </span>
                  </button>
                ))}
              </div>

              {/* Upload own */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.gif"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-150 hover:opacity-80"
                style={{
                  background: uploadPreview ? 'var(--color-accent-subtle)' : 'var(--color-surface-overlay)',
                  border: uploadPreview ? '2px solid var(--color-accent)' : '1px dashed var(--color-border-strong)',
                  color: uploadPreview ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                }}
              >
                {uploading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Przesyłam…</>
                  : uploadPreview
                    ? <>
                        <img src={uploadPreview} alt="avatar" className="w-5 h-5 rounded-full object-cover" />
                        Własne zdjęcie ✓ (kliknij by zmienić)
                      </>
                    : <><Upload className="w-4 h-4" /> Wgraj własne zdjęcie</>
                }
              </button>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div
          className="px-6 py-4 flex items-center gap-3 shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          {step > 1 && (
            <button
              onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-70"
              style={{ background: 'var(--color-surface-overlay)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
            >
              Wstecz
            </button>
          )}

          <div className="flex-1" />

          {step < 3 ? (
            <button
              onClick={() => setStep(s => (s + 1) as 2 | 3)}
              disabled={step === 1 ? !canNext1 : !canNext2}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all duration-200 disabled:opacity-40 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              Dalej <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={!canFinish || saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all duration-200 disabled:opacity-40 hover:-translate-y-0.5 hover:shadow-lg"
              style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Zapisuję…</>
                : <>Zacznijmy! 🚀</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
