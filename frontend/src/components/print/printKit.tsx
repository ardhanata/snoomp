import React from 'react';

/**
 * Shared vocabulary for Snoomp's printed documents.
 *
 * Every print view composes from these rather than styling itself, so a report
 * emailed from the Executive view and one from the Dashboard read as the same
 * document family. Three rules hold it together:
 *
 *   Ink on white. No surfaces, no tints, no shadows — a printed page has no
 *   elevation, and background fills are the first thing a printer drops.
 *
 *   Status separates by luminance, not hue. GREEN/AMBER/RED are chosen so the
 *   report still parses in greyscale and for the ~8% of men with a red-green
 *   deficiency, which for an availability report is not a minor audience.
 *
 *   Millimetres, not pixels. Sizing against the page rather than the viewport
 *   is what stops the browser scaling the sheet to make it fit.
 */

export const INK = '#111418';
export const MUTED = '#57606a';
export const RULE = '#d8dee4';
export const ZEBRA = '#f6f8fa';
export const GREEN = '#1a7f37';
export const AMBER = '#9a6700';
export const RED = '#cf222e';
export const OFF = '#8c959f';

export const numberFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function statusColor(s: string): string {
  const v = (s || '').toLowerCase();
  if (v === 'up' || v === 'operational') return GREEN;
  if (v === 'down' || v === 'critical') return RED;
  if (v === 'warning' || v === 'warn' || v === 'degraded') return AMBER;
  return OFF;
}

export const th: React.CSSProperties = {
  textAlign: 'left', padding: '2mm 2mm 2mm 0', borderBottom: `1.5px solid ${INK}`,
  whiteSpace: 'nowrap', fontSize: '8pt', textTransform: 'uppercase', letterSpacing: '0.06em',
};

export const td: React.CSSProperties = {
  padding: '1.6mm 2mm 1.6mm 0', borderBottom: `1px solid ${RULE}`, verticalAlign: 'top',
};

export function Kpi({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div style={{ border: `1px solid ${RULE}`, borderRadius: '2mm', padding: '3mm 3.5mm' }}>
      <div style={{ fontSize: '7.5pt', textTransform: 'uppercase', letterSpacing: '0.08em', color: MUTED, marginBottom: '1.5mm' }}>
        {label}
      </div>
      <div style={{ fontSize: '15pt', fontWeight: 700, color: color || INK, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '7.5pt', color: MUTED, marginTop: '1mm' }}>{sub}</div>}
    </div>
  );
}

export function SectionTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <h2 style={{
      fontSize: '9pt', textTransform: 'uppercase', letterSpacing: '0.12em', color: MUTED,
      fontWeight: 700, margin: '0 0 2.5mm', paddingBottom: '1.5mm', borderBottom: `1px solid ${RULE}`,
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontFamily: 'inherit',
    }}>
      <span>{children}</span>
      {note && <span style={{ letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}>{note}</span>}
    </h2>
  );
}

/**
 * Page furniture: masthead, status pill, generation stamp, footer.
 *
 * `kind` is the document type ("Fleet Report"), `title` the subject. The status
 * pill is outlined rather than filled so it survives a printer with background
 * graphics turned off — a filled pill would print as white text on nothing.
 */
export function PrintDocument({ kind, title, subtitle, status, meta, footNote, children }: {
  kind: string;
  title: string;
  subtitle?: React.ReactNode;
  status?: { label: string; color: string };
  meta?: React.ReactNode;
  footNote?: React.ReactNode;
  children: React.ReactNode;
}) {
  const generatedAt = new Date();
  return (
    <div className="print-report-container" style={{ color: INK, fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '9pt', lineHeight: 1.45 }}>
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8mm',
        borderBottom: `2px solid ${INK}`, paddingBottom: '3mm', marginBottom: '5mm',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '7.5pt', textTransform: 'uppercase', letterSpacing: '0.16em', color: MUTED, fontWeight: 700 }}>
            Snoomp · {kind}
          </div>
          <h1 style={{ margin: '1mm 0 0', fontSize: '19pt', fontWeight: 800, letterSpacing: '-0.02em', overflowWrap: 'anywhere', color: INK }}>
            {title}
          </h1>
          {subtitle && <div style={{ color: MUTED, marginTop: '1mm' }}>{subtitle}</div>}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {status && (
            <div style={{
              display: 'inline-block', border: `1.5px solid ${status.color}`, color: status.color,
              borderRadius: '99px', padding: '1mm 3mm', fontSize: '8pt', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              {status.label}
            </div>
          )}
          {meta && <div style={{ fontSize: '8pt', color: MUTED, marginTop: '2mm' }}>{meta}</div>}
          <div style={{ fontSize: '8pt', color: MUTED }}>
            Generated {generatedAt.toLocaleString()}
          </div>
        </div>
      </header>

      {children}

      <footer style={{
        marginTop: '8mm', paddingTop: '2.5mm', borderTop: `1px solid ${RULE}`,
        fontSize: '7.5pt', color: MUTED, display: 'flex', justifyContent: 'space-between', gap: '6mm',
      }}>
        <span>Snoomp Enterprise · Health &amp; Resource Monitor</span>
        <span>{footNote}</span>
      </footer>
    </div>
  );
}

/** Proportional bar for a set of labelled counts. */
export function DistributionBar({ segments }: { segments: { n: number; c: string; label: string }[] }) {
  const shown = segments.filter(s => s.n > 0);
  const total = Math.max(1, shown.reduce((a, s) => a + s.n, 0));
  return (
    <div>
      <div style={{ display: 'flex', height: '7mm', borderRadius: '1mm', overflow: 'hidden', border: `1px solid ${RULE}` }}>
        {shown.map(s => <div key={s.label} style={{ width: `${(s.n / total) * 100}%`, background: s.c }} />)}
      </div>
      <div style={{ display: 'flex', gap: '5mm', marginTop: '2mm', fontSize: '8pt', flexWrap: 'wrap' }}>
        {shown.map(s => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '1.5mm' }}>
            <span style={{ width: '2.5mm', height: '2.5mm', background: s.c, borderRadius: '0.5mm', display: 'inline-block' }} />
            {s.label} · <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{s.n}</strong>
            <span style={{ color: MUTED }}>({((s.n / total) * 100).toFixed(1)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}
