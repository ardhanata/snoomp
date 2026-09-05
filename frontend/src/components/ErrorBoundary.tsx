import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  info: React.ErrorInfo | null;
  copied: boolean;
}

/**
 * Catches render-phase errors so a crash shows something actionable instead of
 * a black page.
 *
 * This exists because a stale deployed bundle threw `flatMap is not a function`
 * during render, React unmounted the whole tree, and the only evidence was a
 * console stack trace behind a blank screen. Any future render crash should
 * name itself and say what to do next.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info });
    console.error('Snoomp crashed during render:', error, info.componentStack);
  }

  private details(): string {
    const { error, info } = this.state;
    return [
      `Snoomp ${__APP_BUILD__ ?? 'unknown build'}`,
      `${new Date().toISOString()}  ${navigator.userAgent}`,
      `${location.href}`,
      '',
      `${error?.name}: ${error?.message}`,
      error?.stack ?? '',
      info?.componentStack ?? '',
    ].join('\n');
  }

  private copy = async () => {
    const text = this.details();
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.top = '-9999px';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    } catch {
      /* clipboard unavailable — the details are on screen to copy by hand */
    }
  };

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'var(--bg-void, #0c0d12)',
          color: 'var(--text-primary, #f4f5fb)',
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: '640px',
            width: '100%',
            background: 'var(--bg-elevated, #181a24)',
            border: '1px solid var(--border, rgba(255,255,255,0.12))',
            borderRadius: '16px',
            padding: '28px 32px',
          }}
        >
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Snoomp stopped rendering</h1>

          <p style={{ margin: '10px 0 0', fontSize: '14px', lineHeight: 1.6, color: 'var(--text-secondary, #8b92aa)' }}>
            The interface hit an error it could not recover from. Monitoring is unaffected — checks keep
            running on the server, and no data was lost.
          </p>

          <p style={{ margin: '14px 0 0', fontSize: '14px', lineHeight: 1.6, color: 'var(--text-secondary, #8b92aa)' }}>
            Reload first. If it happens again straight away, the deployed frontend is likely out of date —
            replace <code style={{ fontFamily: 'var(--font-mono, monospace)' }}>frontend/dist</code> next to
            the server executable and restart it.
          </p>

          <pre
            style={{
              margin: '18px 0 0',
              padding: '12px 14px',
              maxHeight: '180px',
              overflow: 'auto',
              background: 'var(--bg-void, #08090d)',
              border: '1px solid var(--border, rgba(255,255,255,0.12))',
              borderRadius: '8px',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '11.5px',
              lineHeight: 1.5,
              color: 'var(--color-down, #f85149)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {error.name}: {error.message}
          </pre>

          <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
              Reload Snoomp
            </button>
            <button type="button" className="secondary" onClick={this.copy}>
              {copied ? 'Details copied' : 'Copy error details'}
            </button>
          </div>

          <span role="status" aria-live="polite" className="sr-only">
            {copied ? 'Error details copied to clipboard' : ''}
          </span>
        </div>
      </div>
    );
  }
}
