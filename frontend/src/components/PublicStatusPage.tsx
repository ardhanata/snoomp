import React, { useEffect, useState, useCallback } from 'react';
import { Shield, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { SnoompLogo } from './SnoompLogo';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface PublicStatusPageProps {
  slug: string;
}

const PublicStatusPage: React.FC<PublicStatusPageProps> = ({ slug }) => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchStatusPage = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const res = await fetch(`${API_URL}/api/status-pages/public/${slug}`);
      if (!res.ok) throw new Error('Status page not found');
      const d = await res.json();
      setData(d);
      setLastUpdated(new Date().toLocaleTimeString());
      
      setOpenCategories(prev => {
        if (Object.keys(prev).length > 0) return prev;
        const groups: Record<string, boolean> = {};
        d.monitors.forEach((m: any) => {
          const tag = (m.tags && m.tags.length > 0) ? m.tags[0] : 'Other Services';
          groups[tag] = true;
        });
        return groups;
      });
      setError('');
    } catch (e: any) {
      setError(e.message || 'Failed to load status page');
    } finally {
      setIsRefreshing(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchStatusPage();
    const interval = setInterval(() => {
      fetchStatusPage();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchStatusPage]);

  const toggleCategory = (cat: string) => {
    setOpenCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-void)', color: 'var(--text-primary)', padding: '24px' }}>
        <div style={{ textAlign: 'center', maxWidth: '420px', padding: '32px', background: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border)' }}>
          <Shield size={48} style={{ color: 'var(--color-down)', marginBottom: '16px' }} />
          <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px 0' }}>404 - {error}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>The requested status page does not exist or is private.</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ minHeight: '100vh', padding: '60px 24px', color: 'var(--text-muted)', background: 'var(--bg-void)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px' }}>
        Loading system status...
      </div>
    );
  }

  const monitorsList: any[] = data.monitors || [];
  const allUp = monitorsList.length > 0 && monitorsList.every((m: any) => m.status === 'up');

  // Compute average 24h uptime
  const avgUptime = monitorsList.length > 0
    ? monitorsList.reduce((acc: number, m: any) => acc + (m.uptime_24h ?? 100), 0) / monitorsList.length
    : 100;

  // Group monitors by first tag
  const groupedMonitors: Record<string, any[]> = {};
  monitorsList.forEach((m: any) => {
    const tag = (m.tags && m.tags.length > 0) ? m.tags[0] : 'Other Services';
    if (!groupedMonitors[tag]) {
      groupedMonitors[tag] = [];
    }
    groupedMonitors[tag].push(m);
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-void)', color: 'var(--text-primary)', padding: '60px 24px', fontFamily: 'var(--font-sans)' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        
        {/* Header & Title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            {data.logo_url ? (
              <img src={data.logo_url} alt="Logo" style={{ height: '52px', borderRadius: '12px' }} />
            ) : (
              <div style={{ padding: '8px 12px', borderRadius: '16px', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--accent-glow)' }}>
                <SnoompLogo size={36} color="var(--accent)" showText={false} />
              </div>
            )}
            <div>
              <h1 style={{ margin: 0, fontSize: '32px', fontWeight: 800, fontFamily: 'var(--font-header)', letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                {data.name || 'System Status'}
              </h1>
              {data.description && <p style={{ margin: '6px 0 0 0', color: 'var(--text-secondary)', fontSize: '15px' }}>{data.description}</p>}
            </div>
          </div>

          {/* Last Updated Timestamp & Auto-Refresh Indicator */}
          {lastUpdated && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
              <span>Updated {lastUpdated}</span>
              <button
                type="button"
                onClick={() => fetchStatusPage(true)}
                title="Refresh status"
                aria-label="Refresh status"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'inline-flex',
                  alignItems: 'center'
                }}
              >
                <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
              </button>
            </div>
          )}
        </div>

        {/* Status Hero Card */}
        <div style={{
          padding: '6px',
          background: allUp ? 'rgba(5, 150, 105, 0.08)' : 'rgba(220, 38, 38, 0.08)',
          borderRadius: '24px',
          border: `1px solid ${allUp ? 'rgba(5, 150, 105, 0.2)' : 'rgba(220, 38, 38, 0.2)'}`,
          marginBottom: '36px',
          boxShadow: 'var(--shadow-md)'
        }}>
          <div style={{
            padding: '24px 28px',
            background: 'var(--bg-secondary)',
            borderRadius: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {allUp ? (
                <CheckCircle2 size={28} style={{ color: 'var(--color-up)' }} />
              ) : (
                <AlertCircle size={28} style={{ color: 'var(--color-down)' }} />
              )}
              <div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-header)', color: 'var(--text-primary)' }}>
                  {allUp ? 'All Core Systems Operational' : 'Active System Degradation Detected'}
                </h2>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  24h Average Uptime: <strong style={{ color: 'var(--text-primary)' }}>{avgUptime.toFixed(2)}%</strong>
                </span>
              </div>
            </div>

            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              borderRadius: '9999px',
              background: allUp ? 'var(--color-up-glow)' : 'var(--color-down-glow)',
              color: allUp ? 'var(--color-up)' : 'var(--color-down)',
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.05em'
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: allUp ? 'var(--color-up)' : 'var(--color-down)', boxShadow: `0 0 8px ${allUp ? 'var(--color-up)' : 'var(--color-down)'}` }} />
              {allUp ? 'OPERATIONAL' : 'INCIDENT ACTIVE'}
            </div>
          </div>
        </div>

        {/* Services List Grouped */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {Object.entries(groupedMonitors).sort((a, b) => a[0].localeCompare(b[0])).map(([category, monitors]) => {
            const isOpen = openCategories[category] !== false;
            const groupUp = monitors.every((m: any) => m.status === 'up');
            
            return (
              <div key={category} style={{
                padding: '6px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: '24px',
                transition: 'all 0.2s ease'
              }}>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: '18px', overflow: 'hidden' }}>
                  
                  {/* Accordion Bar Header */}
                  <button 
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggleCategory(category)}
                    style={{ 
                      display: 'flex', width: '100%', border: 'none',
                      justifyContent: 'space-between', alignItems: 'center', 
                      padding: '18px 24px', cursor: 'pointer', background: 'var(--bg-secondary)',
                      userSelect: 'none', textAlign: 'left', color: 'var(--text-primary)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div style={{
                        width: '32px', height: '32px', borderRadius: '8px',
                        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        {isOpen ? <ChevronUp size={18} color="var(--text-secondary)" /> : <ChevronDown size={18} color="var(--text-secondary)" />}
                      </div>
                      <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, fontFamily: 'var(--font-header)', color: 'var(--text-primary)' }}>
                        {category}
                      </h3>
                    </div>

                    <div style={{ 
                      color: groupUp ? 'var(--color-up)' : 'var(--color-down)',
                      fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '4px 12px', borderRadius: '9999px',
                      background: groupUp ? 'var(--color-up-glow)' : 'var(--color-down-glow)'
                    }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: groupUp ? 'var(--color-up)' : 'var(--color-down)' }} />
                      {groupUp ? 'Operational' : 'Degraded'}
                    </div>
                  </button>
                  
                  {/* Grid Card Container */}
                  {isOpen && (
                    <div style={{ 
                      padding: '20px 24px 24px 24px', borderTop: '1px solid var(--border)',
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '16px' 
                    }}>
                      {monitors.map((m: any) => {
                        const recentHbs = m.recent_heartbeats || [];
                        const uptime = m.uptime_24h ?? 100;
                        return (
                          <div key={m.id} style={{ 
                            display: 'flex', flexDirection: 'column', gap: '12px',
                            padding: '16px 20px', background: 'var(--bg-void)',
                            border: '1px solid var(--border)', borderRadius: '14px',
                            boxShadow: 'var(--shadow-sm)'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                                  {m.name}
                                </div>
                                <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                                  {m.type ? m.type.toUpperCase() : 'HTTP'} MONITOR • {uptime.toFixed(1)}% 24h
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{
                                  width: '8px', height: '8px', borderRadius: '50%',
                                  background: m.status === 'up' ? 'var(--color-up)' : 'var(--color-down)',
                                  boxShadow: `0 0 8px ${m.status === 'up' ? 'var(--color-up)' : 'var(--color-down)'}`
                                }} />
                                <span style={{ 
                                  color: m.status === 'up' ? 'var(--color-up)' : 'var(--color-down)',
                                  fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase'
                                }}>
                                  {m.status || 'Unknown'}
                                </span>
                              </div>
                            </div>

                            {/* 30-bar Heartbeat Strip */}
                            <div className="mini-hb-row">
                              {recentHbs.length > 0
                                ? recentHbs.map((hb: any, i: number) => (
                                    <div key={i} className={`mini-hb-bar ${hb.status || 'unknown'}`} />
                                  ))
                                : Array(20).fill(null).map((_, i) => (
                                    <div key={i} className="mini-hb-bar unknown" />
                                  ))
                              }
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
};

export default PublicStatusPage;
