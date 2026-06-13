import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const API = 'http://localhost:8000';

interface ChatMessage {
  id: number;
  sender: string;
  text: string;
  isAi: boolean;
  isLoading?: boolean;
}

interface AssistantPanelProps {
  initialAnalysis?: { activityId: number; activityName: string } | null;
  onAnalysisConsumed?: () => void;
}

// Minimal markdown: **bold**, newlines
function renderText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part.split('\n').map((line, j, arr) => (
      <React.Fragment key={`${i}-${j}`}>
        {line}
        {j < arr.length - 1 && <br />}
      </React.Fragment>
    ));
  });
}

function TypingDots() {
  return (
    <span className="typing-dots" aria-label="Kasia pisze…">
      <span /><span /><span />
    </span>
  );
}

export const AssistantPanel: React.FC<AssistantPanelProps> = ({ initialAnalysis, onAnalysisConsumed }) => {
  const { user, isLoggedIn } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      sender: 'Kasia',
      text: "Hej! Jestem Kasia, Twoja trenerka AI. Pytaj mnie o treningi, strategię startową, albo prześlij aktywność ze Stravy do analizy.",
      isAi: true,
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const processedRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(scrollToBottom, [messages]);

  useEffect(() => {
    if (
      initialAnalysis &&
      isLoggedIn &&
      user &&
      processedRef.current !== initialAnalysis.activityId
    ) {
      processedRef.current = initialAnalysis.activityId;
      handleAnalyzeActivity(initialAnalysis.activityId, initialAnalysis.activityName);
      onAnalysisConsumed?.();
    }
  }, [initialAnalysis, isLoggedIn, user]);

  const addMessage = (msg: Omit<ChatMessage, 'id'>) => {
    setMessages(prev => [...prev, { ...msg, id: Date.now() + Math.random() }]);
  };

  const replaceLoadingMessage = (text: string) => {
    setMessages(prev => {
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].isLoading) { idx = i; break; }
      }
      if (idx === -1) return prev;
      const copy = [...prev];
      copy[idx] = { ...copy[idx], text, isLoading: false };
      return copy;
    });
  };

  const handleAnalyzeActivity = async (activityId: number, activityName: string) => {
    if (!user) return;
    addMessage({ sender: 'Ty', text: `Przeanalizuj mój trening: „${activityName}"`, isAi: false });
    addMessage({ sender: 'Kasia', text: '', isAi: true, isLoading: true });
    setIsSending(true);
    try {
      const res = await fetch(`${API}/api/assistant/analyze-activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.user_id, activity_id: activityId }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Błąd API');
      replaceLoadingMessage((await res.json()).response);
    } catch (err: any) {
      replaceLoadingMessage(`Błąd: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = async () => {
    const msg = inputValue.trim();
    if (!msg || isSending) return;
    addMessage({ sender: 'Ty', text: msg, isAi: false });
    setInputValue('');
    addMessage({ sender: 'Kasia', text: '', isAi: true, isLoading: true });
    setIsSending(true);
    try {
      const res = await fetch(`${API}/api/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user?.user_id ?? 0, message: msg }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Błąd API');
      replaceLoadingMessage((await res.json()).response);
    } catch (err: any) {
      replaceLoadingMessage(`Błąd: ${err.message}`);
    } finally {
      setIsSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div
        className="shrink-0 px-4 py-3 flex items-center gap-3"
        style={{
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)' }}
          >
            K
          </div>
          <span
            className="absolute -bottom-px -right-px w-2.5 h-2.5 rounded-full border-2"
            style={{
              background: 'var(--color-success)',
              borderColor: 'var(--color-surface)',
            }}
          />
        </div>

        {/* Name */}
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-none" style={{ color: 'var(--color-text-primary)' }}>
            Kasia
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Running Coach AI
          </p>
        </div>

        <Sparkles className="ml-auto w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-text-muted)' }} />
      </div>

      {/* ── Messages ───────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 flex flex-col gap-2"
        style={{ background: 'var(--color-bg)' }}
      >
        {!isLoggedIn && (
          <div
            className="text-center text-xs py-2 px-3 rounded-lg"
            style={{
              background: 'var(--color-surface-overlay)',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
            }}
          >
            Zaloguj się, żeby porozmawiać z Kasią
          </div>
        )}

        {messages.map((msg, idx) => {
          const prevMsg = messages[idx - 1];
          const isFirstInGroup = !prevMsg || prevMsg.isAi !== msg.isAi;

          return (
            <div
              key={msg.id}
              className={`flex ${msg.isAi ? 'justify-start' : 'justify-end'} ${isFirstInGroup ? 'mt-2' : ''}`}
            >
              {/* Kasia avatar — tylko przy pierwszej w grupie */}
              {msg.isAi && (
                <div className="mr-2 mt-auto shrink-0">
                  {isFirstInGroup ? (
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ background: 'linear-gradient(135deg, #a855f7, #6366f1)' }}
                    >
                      K
                    </div>
                  ) : (
                    <div className="w-6" />
                  )}
                </div>
              )}

              <div
                className="max-w-[82%] px-3.5 py-2.5 text-[13px] leading-relaxed"
                style={
                  msg.isAi
                    ? {
                        background: 'var(--color-surface-elevated)',
                        color: 'var(--color-text-primary)',
                        borderRadius: isFirstInGroup
                          ? '16px 16px 16px 4px'
                          : '4px 16px 16px 4px',
                        border: '1px solid var(--color-border)',
                        boxShadow: isFirstInGroup
                          ? '0 0 0 1px rgba(168,85,247,0.08), 0 1px 3px rgba(0,0,0,0.2)'
                          : '0 1px 3px rgba(0,0,0,0.15)',
                      }
                    : {
                        background: 'var(--color-surface-overlay)',
                        color: 'var(--color-text-primary)',
                        borderRadius: isFirstInGroup
                          ? '16px 16px 4px 16px'
                          : '16px 4px 4px 16px',
                        border: '1px solid var(--color-border-strong)',
                      }
                }
              >
                {msg.isLoading ? (
                  <TypingDots />
                ) : (
                  <span className="whitespace-pre-wrap">{renderText(msg.text)}</span>
                )}
              </div>
            </div>
          );
        })}

        <div ref={chatEndRef} />
      </div>

      {/* ── Input ──────────────────────────────────────────── */}
      <div
        className="shrink-0 px-3 py-3"
        style={{
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all"
          style={{
            background: 'var(--color-surface-overlay)',
            border: '1px solid var(--color-border)',
            outline: 'none',
          }}
          onFocusCapture={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(168,85,247,0.5)';
            (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 2px rgba(168,85,247,0.12)';
          }}
          onBlurCapture={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)';
            (e.currentTarget as HTMLElement).style.boxShadow = 'none';
          }}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder={isLoggedIn ? 'Napisz do Kasi…' : 'Zaloguj się, aby rozmawiać'}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isLoggedIn || isSending}
            className="flex-1 bg-transparent text-[13px] outline-none disabled:opacity-40"
            style={{
              color: 'var(--color-text-primary)',
              caretColor: '#a855f7',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!isLoggedIn || isSending || !inputValue.trim()}
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-30"
            style={{
              background: inputValue.trim() && isLoggedIn && !isSending
                ? 'linear-gradient(135deg, #a855f7, #6366f1)'
                : 'transparent',
              color: inputValue.trim() && isLoggedIn && !isSending
                ? '#fff'
                : 'var(--color-text-muted)',
            }}
            aria-label="Wyślij"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
