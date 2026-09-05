import { useEffect, useState } from 'react';
import {
  X, RefreshCw, CheckCircle2, AlertCircle, ArrowUpCircle,
  ExternalLink, Copy, Check, Terminal, Sparkles, Loader2
} from 'lucide-react';
import Dialog from './Dialog';

export interface UpdateInfo {
  current_version: string;
  latest_version: string | null;
  has_update: boolean;
  release_name?: string;
  release_notes?: string;
  html_url?: string;
  download_url?: string;
  published_at?: string;
  message?: string;
  error?: string;
}

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiUrl: string;
}

export default function UpdateModal({ isOpen, onClose, apiUrl }: UpdateModalProps) {
  const [loading, setLoading] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchUpdates = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/system/check-updates`);
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      const data: UpdateInfo = await res.json();
      setUpdateInfo(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to check for updates. Check network connectivity.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUpdates();
    } else {
      setCopied(false);
    }
  }, [isOpen]);

  const updateCommand = 'powershell "C:\\Program Files\\Snoomp\\update-snoomp.ps1"';

  const handleCopy = () => {
    navigator.clipboard.writeText(updateCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="update-dialog-title"
      style={{
        maxWidth: '560px',
        width: '92vw',
        background: 'var(--bg-elevated, #181b20)',
        color: 'var(--text-primary, #e6edf3)',
        borderRadius: '12px',
        border: '1px solid var(--border, rgba(255, 255, 255, 0.1))',
        boxShadow: '0 20px 45px rgba(0, 0, 0, 0.65)',
        padding: 0,
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255, 255, 255, 0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: updateInfo?.has_update ? 'rgba(56, 189, 248, 0.15)' : 'rgba(34, 197, 94, 0.15)',
            color: updateInfo?.has_update ? 'var(--accent, #38bdf8)' : '#22c55e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {updateInfo?.has_update ? <Sparkles size={18} /> : <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />}
          </div>
          <div>
            <h2 id="update-dialog-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
              Check for Updates
            </h2>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted, #8b949e)' }}>
              Snoomp Enterprise Observability Platform
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          aria-label="Close update modal"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted, #8b949e)',
            cursor: 'pointer',
            padding: '6px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted, #8b949e)')}
        >
          <X size={18} />
        </button>
      </div>

      {/* Body Content */}
      <div style={{ padding: '24px 20px', minHeight: '220px', display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: 'auto', gap: '12px' }}>
            <Loader2 size={32} className="animate-spin" style={{ color: 'var(--accent, #38bdf8)' }} />
            <span style={{ fontSize: '13px', color: 'var(--text-muted, #8b949e)' }}>Connecting to GitHub Releases API...</span>
          </div>
        ) : error ? (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px'
          }}>
            <AlertCircle size={20} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px', color: '#ef4444' }}>Unable to verify updates</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted, #8b949e)', marginTop: '4px' }}>{error}</div>
            </div>
          </div>
        ) : updateInfo ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Status Card */}
            {updateInfo.has_update ? (
              <div style={{
                background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(99, 102, 241, 0.08))',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '10px',
                padding: '18px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '14px'
              }}>
                <ArrowUpCircle size={24} style={{ color: 'var(--accent, #38bdf8)', flexShrink: 0, marginTop: '2px' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '15px', color: '#fff' }}>
                      Update Available: v{updateInfo.latest_version}
                    </span>
                    <span style={{
                      fontSize: '11px',
                      background: 'rgba(56, 189, 248, 0.2)',
                      color: 'var(--accent, #38bdf8)',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      fontWeight: 600
                    }}>
                      Current: v{updateInfo.current_version}
                    </span>
                  </div>

                  {updateInfo.release_name && (
                    <div style={{ fontSize: '13px', color: 'var(--text-primary, #e6edf3)', marginTop: '6px', fontWeight: 500 }}>
                      {updateInfo.release_name}
                    </div>
                  )}

                  {updateInfo.release_notes && (
                    <div style={{
                      marginTop: '8px',
                      fontSize: '12px',
                      color: 'var(--text-muted, #8b949e)',
                      maxHeight: '100px',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      background: 'rgba(0,0,0,0.2)',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      lineHeight: '1.4'
                    }}>
                      {updateInfo.release_notes}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{
                background: 'rgba(34, 197, 94, 0.08)',
                border: '1px solid rgba(34, 197, 94, 0.25)',
                borderRadius: '10px',
                padding: '18px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px'
              }}>
                <CheckCircle2 size={24} style={{ color: '#22c55e', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '15px', color: '#22c55e' }}>
                    Snoomp is up to date!
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted, #8b949e)', marginTop: '2px' }}>
                    You are running the latest version (v{updateInfo.current_version}).
                  </div>
                </div>
              </div>
            )}

            {/* Terminal Command Card for Windows Updates */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
              borderRadius: '8px',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted, #8b949e)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Terminal size={14} /> One-click update via PowerShell (Run as Administrator):
                </span>
                <button
                  onClick={handleCopy}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    background: copied ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                    color: copied ? '#22c55e' : 'var(--text-primary, #e6edf3)',
                    border: '1px solid',
                    borderColor: copied ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255, 255, 255, 0.15)',
                    borderRadius: '4px',
                    padding: '3px 8px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <code style={{
                fontFamily: 'Consolas, monospace',
                fontSize: '12px',
                color: 'var(--accent, #38bdf8)',
                background: 'rgba(0,0,0,0.4)',
                padding: '8px 10px',
                borderRadius: '6px',
                userSelect: 'all',
                overflowX: 'auto'
              }}>
                {updateCommand}
              </code>
            </div>
          </div>
        ) : null}
      </div>

      {/* Footer Actions */}
      <div style={{
        padding: '12px 20px',
        borderTop: '1px solid var(--border, rgba(255, 255, 255, 0.08))',
        background: 'rgba(255, 255, 255, 0.02)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px'
      }}>
        <button
          onClick={fetchUpdates}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
            background: 'rgba(255, 255, 255, 0.06)',
            color: 'var(--text-primary, #e6edf3)',
            border: '1px solid var(--border, rgba(255, 255, 255, 0.1))',
            borderRadius: '6px',
            padding: '6px 14px',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
          onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Check Again
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {updateInfo?.html_url && (
            <a
              href={updateInfo.html_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                color: 'var(--accent, #38bdf8)',
                textDecoration: 'none',
                padding: '6px 12px',
                borderRadius: '6px'
              }}
            >
              Release Notes <ExternalLink size={13} />
            </a>
          )}
          <button
            onClick={onClose}
            style={{
              fontSize: '13px',
              background: 'var(--accent, #38bdf8)',
              color: '#0f172a',
              fontWeight: 600,
              border: 'none',
              borderRadius: '6px',
              padding: '6px 16px',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
