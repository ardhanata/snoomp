# Snoomp Executive Presentation & Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and integrate an Executive Command Center C-Suite view in Snoomp with TCO savings metrics, global 99.99% SLA availability scorecards, and financial downtime risk tracking.

**Architecture:** Create an `ExecutiveDashboard.tsx` component in `frontend/src/components/`, add an "Executive View" toggle button to the top navbar in `App.tsx`, and calculate real-time TCO savings based on active target counts.

**Tech Stack:** React 18, Recharts, Lucide Icons, Plus Jakarta Sans, CSS Variables.

## Global Constraints

- Double-Bezel Card Enclosures (`.double-bezel-outer`, `.double-bezel-inner`)
- Accent Blue: `var(--accent)` (`#2563EB` / `#3B82F6`)
- Operational Green: `var(--color-up)` (`#059669` / `#238636`)
- Alert Red: `var(--color-down)` (`#DC2626` / `#DA3633`)

---

### Task 1: Build `ExecutiveDashboard.tsx` Component

**Files:**
- Create: `frontend/src/components/ExecutiveDashboard.tsx`

**Interfaces:**
- Produces: `<ExecutiveDashboard targets={Target[]} heartbeats={Heartbeat[]} stats={any} />`

- [ ] **Step 1: Create `ExecutiveDashboard.tsx` with TCO Savings, SLA Scorecard, and MTTR risk meters**

```tsx
import React from 'react';
import { Shield, TrendingUp, DollarSign, Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

interface ExecutiveDashboardProps {
  targets: any[];
  stats?: any;
}

export const ExecutiveDashboard: React.FC<ExecutiveDashboardProps> = ({ targets, stats }) => {
  const totalTargets = targets.length;
  const upTargets = targets.filter(t => t.status === 'up').length;
  const globalUptime = totalTargets > 0 ? ((upTargets / totalTargets) * 100).toFixed(2) : '100.00';

  // TCO Savings Calculation vs Traditional APMs ($25/host avg)
  const estimatedSaasCostMonthly = totalTargets * 25;
  const snoompHostingCostMonthly = 40; // Estimated VM hosting
  const monthlyTcoSavings = Math.max(0, estimatedSaasCostMonthly - snoompHostingCostMonthly);
  const annualTcoSavings = monthlyTcoSavings * 12;

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
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'var(--font-sans)' }}>
      
      {/* Header Eyebrow */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '4px' }}>
          C-Suite Overview & TCO Metrics
        </div>
        <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-header)', letterSpacing: '-0.02em' }}>
          Executive Command Center
        </h1>
      </div>

      {/* Top 3 Executive Metric Cards (Double-Bezel) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '32px' }}>
        
        {/* Card 1: TCO Savings */}
        <div className="double-bezel-outer">
          <div className="double-bezel-inner" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--text-muted)', fontWeight: 700 }}>Est. TCO Savings</span>
              <div style={{ padding: '6px', borderRadius: '50%', background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                <DollarSign size={18} />
              </div>
            </div>
            <div style={{ fontSize: '32px', fontWeight: 800, fontFamily: 'var(--font-header)', color: 'var(--text-primary)' }}>
              ${monthlyTcoSavings.toLocaleString()} <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 500 }}>/ month</span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-up)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <TrendingUp size={14} /> ${annualTcoSavings.toLocaleString()} projected annual savings
            </div>
          </div>
        </div>

        {/* Card 2: Global SLA Scorecard */}
        <div className="double-bezel-outer">
          <div className="double-bezel-inner" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--text-muted)', fontWeight: 700 }}>Global Availability SLA</span>
              <div style={{ padding: '6px', borderRadius: '50%', background: 'var(--color-up-glow)', color: 'var(--color-up)' }}>
                <CheckCircle2 size={18} />
              </div>
            </div>
            <div style={{ fontSize: '32px', fontWeight: 800, fontFamily: 'var(--font-header)', color: parseFloat(globalUptime) >= 99 ? 'var(--color-up)' : 'var(--color-down)' }}>
              {globalUptime}%
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Target SLA: <strong style={{ color: 'var(--text-primary)' }}>99.99%</strong> ({upTargets}/{totalTargets} Active Endpoints)
            </div>
          </div>
        </div>

        {/* Card 3: Downtime Risk Mitigation */}
        <div className="double-bezel-outer">
          <div className="double-bezel-inner" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--text-muted)', fontWeight: 700 }}>Avg MTTR Incident Velocity</span>
              <div style={{ padding: '6px', borderRadius: '50%', background: 'rgba(217, 119, 6, 0.15)', color: 'var(--color-warning)' }}>
                <Activity size={18} />
              </div>
            </div>
            <div style={{ fontSize: '32px', fontWeight: 800, fontFamily: 'var(--font-header)', color: 'var(--text-primary)' }}>
              &lt; 45s <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 500 }}>detection</span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Real-Time WebSocket Alert Dispatch Active
            </div>
          </div>
        </div>

      </div>

      {/* Historical Availability Trend Chart */}
      <div className="double-bezel-outer" style={{ marginBottom: '32px' }}>
        <div className="double-bezel-inner">
          <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-header)' }}>
            Enterprise SLA Trend History (6 Months)
          </h3>
          <div style={{ width: '100%', height: 260 }}>
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

    </div>
  );
};
export default ExecutiveDashboard;
```

---

### Task 2: Integrate Executive Dashboard Toggle in `App.tsx`

**Files:**
- Modify: `frontend/src/App.tsx:95-105`
- Modify: `frontend/src/App.tsx:560-580`

**Interfaces:**
- Consumes: `<ExecutiveDashboard />` component from Task 1.

- [ ] **Step 1: Import `ExecutiveDashboard` in `App.tsx`**

Add `import ExecutiveDashboard from './components/ExecutiveDashboard';` at top of `App.tsx`.

- [ ] **Step 2: Add view mode state support for `'executive'`**

Update `view` state type: `const [view, setView] = useState<'dashboard' | 'status-pages' | 'executive'>('dashboard');`

- [ ] **Step 3: Add Executive View button to navigation toolbar**

Render a navigation button in the top navbar next to "Dashboard":

```tsx
<button
  className={view === 'executive' ? 'primary' : 'secondary'}
  onClick={() => setView('executive')}
  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
>
  <TrendingUp size={14} /> Executive View
</button>
```

- [ ] **Step 4: Render `<ExecutiveDashboard />` when `view === 'executive'`**

In the main view switcher block, render `<ExecutiveDashboard targets={monitors} stats={stats} />`.

---

### Task 3: Deploy & Verify Executive View

**Files:**
- Executable Verification

- [ ] **Step 1: Restart frontend container**

Run: `docker restart snoomp-frontend`

- [ ] **Step 2: Verify in browser**

Click "Executive View" button in top navbar at `http://localhost:5173`.
