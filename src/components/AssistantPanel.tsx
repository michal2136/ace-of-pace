import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Loader2 } from 'lucide-react';
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

export const AssistantPanel: React.FC<AssistantPanelProps> = ({ initialAnalysis, onAnalysisConsumed }) => {
  const { user, isLoggedIn } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      sender: 'Kasia',
      text: "Hej biegaczu! 👋 Jestem Kasia, Twoja trenerka AI. Pytaj mnie o treningi, strategię startową, albo prześlij aktywność do analizy — rozbiorę ją na czynniki pierwsze! 🏃",
      isAi: true,
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const processedRef = useRef<number | null>(null);

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
      const idx = prev.findLastIndex(m => m.isLoading);
      if (idx === -1) return prev;
      const copy = [...prev];
      copy[idx] = { ...copy[idx], text, isLoading: false };
      return copy;
    });
  };

  const handleAnalyzeActivity = async (activityId: number, activityName: string) => {
    if (!user) return;
    addMessage({ sender: 'Ty', text: `Przeanalizuj mój trening: "${activityName}"`, isAi: false });
    addMessage({ sender: 'Kasia', text: '🔍 Pobieram dane ze Stravy i analizuję…', isAi: true, isLoading: true });
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
      replaceLoadingMessage(`⚠️ Błąd: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = async () => {
    const msg = inputValue.trim();
    if (!msg || isSending) return;
    addMessage({ sender: 'Ty', text: msg, isAi: false });
    setInputValue('');
    addMessage({ sender: 'Kasia', text: '💭 Myślę…', isAi: true, isLoading: true });
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
      replaceLoadingMessage(`⚠️ Błąd: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: 'var(--color-surface)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center relative shadow-lg"
            style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)' }}
          >
            <span className="text-white font-black italic text-base">K</span>
            <span
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
              style={{
                background: '#10b981',
                borderColor: 'var(--color-surface)',
                boxShadow: '0 0 6px rgba(16,185,129,0.7)',
              }}
            />
          </div>
          <div>
            <p
              className="text-sm font-bold tracking-wide"
              style={{
                background: 'linear-gradient(135deg, #a855f7, #6366f1)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              KASIA
            </p>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#10b981' }}>
              Running Coach AI
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
          <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>AI</span>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 custom-scrollbar">
        <div className="text-center">
          <span
            className="text-[10px] font-medium px-3 py-1 rounded-full"
            style={{
              background: 'var(--color-surface-overlay)',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
            }}
          >
            {isLoggedIn ? 'Pytaj Kasię o treningi i strategię' : 'Zaloguj się, żeby porozmawiać z Kasią'}
          </span>
        </div>

        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.isAi ? 'items-start' : 'items-end'} gap-1`}>
            <div className="flex items-center gap-1.5 px-1">
              {msg.isAi && (
                <div
                  className="w-4 h-4 rounded-md flex items-center justify-center text-[9px] font-bold text-white italic"
                  style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)' }}
                >
                  K
                </div>
              )}
              <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                {msg.sender}
              </span>
            </div>
            <div
              className="px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap max-w-[90%]"
              style={
                msg.isAi
                  ? {
                      background: 'var(--color-surface-overlay)',
                      border: '1px solid rgba(139,92,246,0.2)',
                      color: 'var(--color-text-primary)',
                      borderRadius: '12px 12px 12px 4px',
                    }
                  : {
                      background: 'var(--color-accent-subtle)',
                      border: '1px solid rgba(99,102,241,0.25)',
                      color: 'var(--color-text-primary)',
                      borderRadius: '12px 12px 4px 12px',
                    }
              }
            >
              {msg.isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#a855f7' }} />
                  {msg.text}
                </span>
              ) : (
                msg.text
              )}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div
        className="p-3 shrink-0"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <div
          className="flex items-center rounded-xl transition-all"
          style={{
            background: 'var(--color-surface-overlay)',
            border: '1px solid var(--color-border)',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-border)')}
        >
          <input
            type="text"
            placeholder={isLoggedIn ? 'Napisz do Kasi...' : 'Zaloguj się, aby rozmawiać'}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isLoggedIn || isSending}
            className="flex-1 bg-transparent border-none py-2.5 pl-4 pr-2 text-sm focus:outline-none disabled:opacity-50"
            style={{ color: 'var(--color-text-primary)' }}
          />
          <button
            onClick={handleSend}
            disabled={!isLoggedIn || isSending || !inputValue.trim()}
            className="p-2 mr-1 rounded-lg transition-all disabled:opacity-30 hover:scale-105 active:scale-95"
            style={{ color: 'var(--color-accent)' }}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
