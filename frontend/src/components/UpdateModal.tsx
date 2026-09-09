import React, { useEffect, useState } from 'react';
import {
  X,
  RefreshCw,
  ArrowUpCircle,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Terminal,
  Copy,
  Check,
  ShieldCheck,
  Loader2,
  Calendar,
  Layers
} from 'lucide-react';
import Dialog from './Dialog';

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_name: string | null;
  release_notes: string | null;
  html_url: string | null;
  published_at: string | null;
  checked_at: string | null;
  cached?: boolean;
  upgrade_command_docker?: string;
  upgrade_command_installer?: string;
  error?: string | null;
  warning?: string | null;
}

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiUrl: string;
  currentAppVersion?: string;
  onUpdateDetected?: (info: UpdateInfo) => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  apiUrl,
  currentAppVersion,
  onUpdateDetected
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [copiedDocker, setCopiedDocker] = useState(false);
  const [copiedInstaller, setCopiedInstaller] = useState(false);

  const fetchUpdates = async (force: boolean = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `${apiUrl}/api/system/check-updates${force ? '?force=true' : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      const data: UpdateInfo = await res.json();
      setUpdateInfo(data);
      if (data.error) {
        setError(data.error);
      }
      if (onUpdateDetected && data.has_update) {
        onUpdateDetected(data);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to check for updates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUpdates(false);
    }
  }, [isOpen]);

  const handleCopy = (text: string, type: 'docker' | 'installer') => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    if (type === 'docker') {
      setCopiedDocker(true);
      setTimeout(() => setCopiedDocker(false), 2000);
    } else {
      setCopiedInstaller(true);
      setTimeout(() => setCopiedInstaller(false), 2000);
    }
  };

  const dockerCmd = updateInfo?.upgrade_command_docker || 'cd /opt/snoomp && git pull && docker compose up -d --build';
  const installerCmd = updateInfo?.upgrade_command_installer || 'curl -fsSL https://raw.githubusercontent.com/ardhanata/snoomp/main/install.sh | sudo bash';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      className="modal-content"
      style={{
        maxWidth: '560px',
        width: '95%',
        padding: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--radius-lg, 12px)',
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.45)'
      }}
      aria-labelledby="update-modal-title"
    >
      {/* Modal Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--border)',
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
            background: 'var(--accent-glow, rgba(56, 189, 248, 0.12))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent)'
          }}>
            <ShieldCheck size={18} />
          </div>
          <div>
            <h2 id="update-modal-title" style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Software Updates
            </h2>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Snoomp Enterprise Health Platform
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>
      </div>

      {/* Modal Body */}
      <div style={{
        padding: '20px',
        overflowY: 'auto',
        maxHeight: 'calc(80vh - 120px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        {loading && !updateInfo ? (
          <div style={{
            padding: '40px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            color: 'var(--text-muted)'
          }}>
            <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
            <div style={{ fontSize: '13px', fontWeight: 500 }}>Checking for updates via GitHub...</div>
          </div>
        ) : error && !updateInfo ? (
          <div style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px'
          }}>
            <AlertTriangle size={20} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px', color: '#ef4444' }}>Unable to verify updates</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{error}</div>
              {currentAppVersion && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                  Current version: {currentAppVersion}
                </div>
              )}
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
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '14px'
              }}>
                <ArrowUpCircle size={24} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '2px' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>
                      Update Available: v{updateInfo.latest_version}
                    </span>
                    <span style={{
                      fontSize: '11px',
                      background: 'rgba(56, 189, 248, 0.2)',
                      color: 'var(--accent)',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      fontWeight: 600
                    }}>
                      Current: v{updateInfo.current_version}
                    </span>
                  </div>

                  {updateInfo.release_name && (
                    <div style={{ fontSize: '13px', color: 'var(--text-primary)', marginTop: '6px', fontWeight: 500 }}>
                      {updateInfo.release_name}
                    </div>
                  )}

                  {updateInfo.published_at && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      <Calendar size={12} />
                      Published {new Date(updateInfo.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </div>
                  )}

                  {updateInfo.release_notes && (
                    <div style={{
                      marginTop: '10px',
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      maxHeight: '140px',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      background: 'rgba(0, 0, 0, 0.25)',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      lineHeight: '1.45',
                      border: '1px solid var(--border)'
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
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px'
              }}>
                <CheckCircle2 size={24} style={{ color: '#22c55e', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '15px', color: '#22c55e' }}>
                    Snoomp is up to date
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    You are running the latest version (v{updateInfo.current_version}).
                  </div>
                </div>
              </div>
            )}

            {updateInfo.warning && (
              <div style={{
                fontSize: '11px',
                color: 'var(--color-warn, #eab308)',
                background: 'rgba(234, 179, 8, 0.1)',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(234, 179, 8, 0.2)'
              }}>
                {updateInfo.warning}
              </div>
            )}

            {/* Terminal Upgrade Options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Layers size={14} style={{ color: 'var(--accent)' }} />
                Upgrade Instructions
              </div>

              {/* Docker Compose Command */}
              <div style={{
                background: 'rgba(0, 0, 0, 0.25)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Terminal size={12} /> Standard Docker Stack:
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(dockerCmd, 'docker')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      background: copiedDocker ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                      color: copiedDocker ? '#22c55e' : 'var(--text-primary)',
                      border: '1px solid',
                      borderColor: copiedDocker ? 'rgba(34, 197, 94, 0.4)' : 'var(--border)',
                      borderRadius: '4px',
                      padding: '2px 8px',
                      cursor: 'pointer'
                    }}
                  >
                    {copiedDocker ? <Check size={11} /> : <Copy size={11} />}
                    {copiedDocker ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <code style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '11px',
                  color: 'var(--accent)',
                  background: 'rgba(0, 0, 0, 0.35)',
                  padding: '6px 8px',
                  borderRadius: '5px',
                  userSelect: 'all',
                  overflowX: 'auto',
                  whiteSpace: 'nowrap'
                }}>
                  {dockerCmd}
                </code>
              </div>

              {/* Automated Turnkey Installer Command */}
              <div style={{
                background: 'rgba(0, 0, 0, 0.25)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Terminal size={12} /> Turnkey Linux Bootstrap:
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(installerCmd, 'installer')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      background: copiedInstaller ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                      color: copiedInstaller ? '#22c55e' : 'var(--text-primary)',
                      border: '1px solid',
                      borderColor: copiedInstaller ? 'rgba(34, 197, 94, 0.4)' : 'var(--border)',
                      borderRadius: '4px',
                      padding: '2px 8px',
                      cursor: 'pointer'
                    }}
                  >
                    {copiedInstaller ? <Check size={11} /> : <Copy size={11} />}
                    {copiedInstaller ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <code style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '11px',
                  color: 'var(--accent)',
                  background: 'rgba(0, 0, 0, 0.35)',
                  padding: '6px 8px',
                  borderRadius: '5px',
                  userSelect: 'all',
                  overflowX: 'auto',
                  whiteSpace: 'nowrap'
                }}>
                  {installerCmd}
                </code>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Footer Actions */}
      <div style={{
        padding: '12px 20px',
        borderTop: '1px solid var(--border)',
        background: 'rgba(255, 255, 255, 0.02)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px'
      }}>
        <button
          type="button"
          onClick={() => fetchUpdates(true)}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            background: 'rgba(255, 255, 255, 0.06)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '6px 12px',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Checking...' : 'Check Again'}
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
                gap: '5px',
                fontSize: '12px',
                color: 'var(--accent)',
                textDecoration: 'none',
                padding: '6px 10px',
                borderRadius: '6px'
              }}
            >
              Release Notes <ExternalLink size={12} />
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: '12px',
              background: 'var(--accent)',
              color: '#0c0d12',
              fontWeight: 600,
              border: 'none',
              borderRadius: '6px',
              padding: '6px 14px',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default UpdateModal;
