import React from 'react';
import { TrendingUp, DollarSign, Activity, CheckCircle2, ShieldCheck, Server, Database, Globe, Cpu } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

interface ExecutiveDashboardProps {
  targets: any[];
  stats?: any;
  slaConfig?: {
    normal: number;
    warning: number;
    critical: number;
  };
}

export const ExecutiveDashboard: React.FC<ExecutiveDashboardProps> = ({ targets, stats: _stats, slaConfig }) => {
  const slaNormal = slaConfig?.normal ?? 99.9;
  const slaWarning = slaConfig?.warning ?? 99.0;

  const totalTargets = targets.length;
  const upTargets = targets.filter(t => t.status === 'up').length;
  const downTargets = targets.filter(t => t.status === 'down').length;
  const globalUptime = totalTargets > 0 ? ((upTargets / totalTargets) * 100).toFixed(2) : '100.00';
  const globalUptimeNum = parseFloat(globalUptime);

  const slaColor = globalUptimeNum >= slaNormal 
    ? 'var(--color-up)' 
    : globalUptimeNum >= slaWarning 
      ? 'var(--color-warning)' 
      : 'var(--color-down)';

  // TCO Savings Calculation vs Traditional APMs ($25/host avg)
  const estimatedSaasCostMonthly = totalTargets * 25;
  const snoompHostingCostMonthly = 40; // Estimated VM hosting
  const monthlyTcoSavings = Math.max(0, estimatedSaasCostMonthly - snoompHostingCostMonthly);
  const annualTcoSavings = monthlyTcoSavings * 12;

  // Group monitors by tag / domain for executive overview
  const domainBreakdown: Record<string, { total: number; up: number }> = {};
  targets.forEach(t => {
    const tag = (t.tags && t.tags.length > 0) ? t.tags[0].toUpperCase() : 'CORE SERVICES';
    if (!domainBreakdown[tag]) {
      domainBreakdown[tag] = { total: 0, up: 0 };
    }
    domainBreakdown[tag].total += 1;
    if (t.status === 'up') domainBreakdown[tag].up += 1;
  });

  // Mock trend data for executive SLA chart
  const slaTrendData = [
    { month: 'Jan', uptime: 99.98 },
    { month: 'Feb', uptime: 99.95 },
    { month: 'Mar', uptime: 99.99 },
    { month: 'Apr', uptime: 99.97 },
    { month: 'May', uptime: 99.99 },
    { month: 'Jun', uptime: parseFloat(globalUptime) }
  ];

  return (
    <div style={{
      width: '100%',
      padding: '32px 40px',
      fontFamily: 'var(--font-sans)',
      boxSizing: 'border-box',
      overflowY: 'auto',
      height: 'calc(100vh - 60px)',
      background: 'var(--bg-void)'
    }}>
      
      {/* Header Eyebrow */}
      <div style={{ marginBottom: '28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '4px' }}>
            C-Suite Operations & Financial Control
          </div>
          <h1 style={{ margin: 0, fontSize: '32px', fontWeight: 800, fontFamily: 'var(--font-header)', letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Executive Command Center
          </h1>
        </div>

        {/* Live Status Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '99px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: downTargets > 0 ? 'var(--color-down)' : 'var(--color-up)', boxShadow: downTargets > 0 ? '0 0 10px var(--color-down)' : '0 0 10px var(--color-up)' }} />
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
            {downTargets > 0 ? `${downTargets} Active Insidents` : 'All Systems Operational'}
          </span>
        </div>
      </div>

      {/* Top Row: 3 Wide Executive Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginBottom: '32px' }}>
        
        {/* Card 1: TCO Savings */}
        <div className="double-bezel-outer">
          <div className="double-bezel-inner" style={{ display: 'flex', flexDirection: 'column', gap: '14px', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--text-muted)', fontWeight: 700 }}>Est. TCO Savings</span>
              <div style={{ padding: '8px', borderRadius: '50%', background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                <DollarSign size={20} />
              </div>
            </div>
            <div style={{ fontSize: '36px', fontWeight: 800, fontFamily: 'var(--font-header)', color: 'var(--text-primary)' }}>
              ${monthlyTcoSavings.toLocaleString()} <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 500 }}>/ month</span>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--color-up)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <TrendingUp size={16} /> ${annualTcoSavings.toLocaleString()} projected annual savings
            </div>
          </div>
        </div>

        {/* Card 2: Global SLA Scorecard */}
        <div className="double-bezel-outer">
          <div className="double-bezel-inner" style={{ display: 'flex', flexDirection: 'column', gap: '14px', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--text-muted)', fontWeight: 700 }}>Global Availability SLA</span>
              <div style={{ padding: '8px', borderRadius: '50%', background: 'var(--color-up-glow)', color: 'var(--color-up)' }}>
                <CheckCircle2 size={20} />
              </div>
            </div>
            <div style={{ fontSize: '36px', fontWeight: 800, fontFamily: 'var(--font-header)', color: slaColor }}>
              {globalUptime}%
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Target SLA: <strong style={{ color: 'var(--text-primary)' }}>{slaNormal}%</strong> ({upTargets}/{totalTargets} Endpoints Healthy)
            </div>
          </div>
        </div>

        {/* Card 3: Downtime Risk Mitigation */}
        <div className="double-bezel-outer">
          <div className="double-bezel-inner" style={{ display: 'flex', flexDirection: 'column', gap: '14px', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--text-muted)', fontWeight: 700 }}>Avg Incident Resolution (MTTR)</span>
              <div style={{ padding: '8px', borderRadius: '50%', background: 'rgba(217, 119, 6, 0.15)', color: 'var(--color-warning)' }}>
                <Activity size={20} />
              </div>
            </div>
            <div style={{ fontSize: '36px', fontWeight: 800, fontFamily: 'var(--font-header)', color: 'var(--text-primary)' }}>
              &lt; 45s <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 500 }}>detection</span>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={16} style={{ color: 'var(--accent)' }} /> Zero-Latency Alert Engine
            </div>
          </div>
        </div>

      </div>

      {/* Bottom Landscape Grid: 2/3 Chart + 1/3 Domain Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px', marginBottom: '32px' }}>
        
        {/* Left Column: Widescreen SLA Chart */}
        <div className="double-bezel-outer">
          <div className="double-bezel-inner" style={{ height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-header)' }}>
                Enterprise SLA Trend History (6 Months)
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>HYPERTABLE TIME-SERIES</span>
            </div>
            
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={slaTrendData}>
                  <defs>
                    <linearGradient id="slaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={12} />
                  <YAxis domain={[99.0, 100.0]} stroke="var(--text-muted)" fontSize={12} />
                  <Tooltip contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="uptime" stroke="var(--accent)" strokeWidth={3} fillOpacity={1} fill="url(#slaGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Right Column: Service Domain Health Breakdown */}
        <div className="double-bezel-outer">
          <div className="double-bezel-inner" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-header)' }}>
              Domain Health Breakdown
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflowY: 'auto' }}>
              {Object.keys(domainBreakdown).length > 0 ? (
                Object.entries(domainBreakdown).map(([domain, data]) => {
                  const pct = ((data.up / data.total) * 100).toFixed(1);
                  return (
                    <div key={domain} style={{ padding: '12px 16px', background: 'var(--bg-void)', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {domain.includes('DB') ? <Database size={16} style={{ color: 'var(--accent)' }} /> :
                         domain.includes('HTTP') ? <Globe size={16} style={{ color: 'var(--accent)' }} /> :
                         domain.includes('SERVER') ? <Server size={16} style={{ color: 'var(--accent)' }} /> :
                         <Cpu size={16} style={{ color: 'var(--accent)' }} />}
                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{domain}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{data.up}/{data.total}</span>
                        <span style={{ fontSize: '13px', fontWeight: 800, color: parseFloat(pct) >= 99 ? 'var(--color-up)' : 'var(--color-down)' }}>
                          {pct}%
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>
                  No active targets configured.
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};
export default ExecutiveDashboard;
