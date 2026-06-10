/**
 * ErrorBoundary — class component (React wymaga klasy dla componentDidCatch).
 *
 * Łapie każdy nieobsłużony błąd JS/TSX w potomnym drzewie i zamiast
 * białego ekranu renderuje elegancki komunikat "Ups" z przyciskiem odświeżenia.
 *
 * Użycie:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 *
 * Opcjonalnie możesz też owinąć konkretne widoki dla bardziej granularnego
 * wyizolowania błędów.
 */

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** Opcjonalny fallback — jeśli nie podany, używany jest domyślny ekran błędu. */
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Loguj do konsoli (w produkcji podpiąłbyś tu Sentry/DataDog)
    console.error('[ErrorBoundary] Caught an error:', error);
    console.error('[ErrorBoundary] Component stack:', info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            width: '100%',
            gap: '20px',
            padding: '32px',
            background: 'var(--color-bg, #0f0f11)',
            color: 'var(--color-text-primary, #fafafa)',
            fontFamily: "'Inter', sans-serif",
            textAlign: 'center',
          }}
        >
          {/* Icon */}
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(248, 113, 113, 0.12)',
              border: '1px solid rgba(248, 113, 113, 0.3)',
            }}
          >
            <AlertTriangle
              style={{ color: '#f87171', width: 28, height: 28 }}
            />
          </div>

          {/* Heading */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 440 }}>
            <h2
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                margin: 0,
                color: 'var(--color-text-primary, #fafafa)',
              }}
            >
              Ups, coś poszło nie tak
            </h2>
            <p
              style={{
                fontSize: '0.875rem',
                margin: 0,
                color: 'var(--color-text-secondary, #a1a1aa)',
                lineHeight: 1.6,
              }}
            >
              Napotkaliśmy nieoczekiwany błąd. Spróbuj odświeżyć stronę —
              jeśli problem się powtarza, skontaktuj się z pomocą.
            </p>

            {/* Show error detail only in dev mode */}
            {import.meta.env.DEV && this.state.error && (
              <pre
                style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: 'rgba(248, 113, 113, 0.06)',
                  border: '1px solid rgba(248, 113, 113, 0.2)',
                  fontSize: '0.7rem',
                  color: '#f87171',
                  textAlign: 'left',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 160,
                  overflow: 'auto',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                border: 'none',
                color: '#fff',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'opacity 150ms',
              }}
              onMouseOver={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85'; }}
              onMouseOut={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
            >
              <RefreshCw style={{ width: 16, height: 16 }} />
              Odśwież stronę
            </button>

            <button
              onClick={this.handleReset}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                borderRadius: 12,
                background: 'transparent',
                border: '1px solid var(--color-border, rgba(63,63,70,0.6))',
                color: 'var(--color-text-secondary, #a1a1aa)',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'background 150ms',
              }}
              onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-overlay, #27272a)'; }}
              onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              Spróbuj ponownie
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * PanelErrorBoundary — lżejszy wariant do owinięcia paneli bocznych.
 * Zamiast fullscreen, pokazuje inline-komunikat w obrębie panelu.
 */
export const PanelErrorBoundary: React.FC<{ children: React.ReactNode; label?: string }> = ({
  children,
  label = 'widok',
}) => (
  <ErrorBoundary
    fallback={
      <div
        style={{
          padding: '24px 16px',
          borderRadius: 12,
          background: 'rgba(248,113,113,0.06)',
          border: '1px solid rgba(248,113,113,0.2)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          textAlign: 'center',
        }}
      >
        <AlertTriangle style={{ color: '#f87171', width: 24, height: 24 }} />
        <p style={{ fontSize: '0.8rem', color: '#f87171', margin: 0, fontWeight: 600 }}>
          Błąd w: {label}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 8,
            background: 'rgba(248,113,113,0.12)',
            border: '1px solid rgba(248,113,113,0.3)',
            color: '#f87171',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <RefreshCw style={{ width: 12, height: 12 }} />
          Odśwież
        </button>
      </div>
    }
  >
    {children}
  </ErrorBoundary>
);
