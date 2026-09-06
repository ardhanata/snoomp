
import {
  MUTED, ZEBRA, GREEN, AMBER, RED, OFF,
  numberFmt, th, td, Kpi, SectionTitle, PrintDocument, DistributionBar, statusColor,
} from './printKit';

/**
 * Status page inventory for print.
 *
 * The audience here is different again: this is the document you take to a
 * review to answer "what have we published, to whom, and is any of it
 * currently showing a problem to the outside world". So each page is listed
 * with its public URL and the live state of the monitors behind it — a page
 * that is green internally but exposes a down service is the thing worth
 * catching, and that is not visible from the page list on screen.
 */

interface StatusPageLike {
  id: string;
  name: string;
  slug: string;
  description?: string;
  monitor_ids: string[];
  is_public: boolean;
}

interface Props {
  pages: StatusPageLike[];
  monitors: any[];
  origin?: string;
}

export default function PrintStatusPagesReport({ pages, monitors, origin }: Props) {
  const list = Array.isArray(pages) ? pages : [];
  const allMonitors = Array.isArray(monitors) ? monitors : [];
  const byId = new Map(allMonitors.map(m => [m?.id, m]));
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');

  const rows = list.map(p => {
    const linked = (p.monitor_ids || []).map(id => byId.get(id)).filter(Boolean);
    const up = linked.filter(m => (m.status || '').toLowerCase() === 'up').length;
    const down = linked.filter(m => ['down', 'critical'].includes((m.status || '').toLowerCase())).length;
    const warn = linked.filter(m => ['warning', 'warn'].includes((m.status || '').toLowerCase())).length;
    const missing = (p.monitor_ids || []).length - linked.length;
    return { page: p, linked, up, down, warn, missing };
  });

  const publicCount = list.filter(p => p.is_public).length;
  const exposedDown = rows.filter(r => r.page.is_public && r.down > 0).length;
  const orphaned = rows.filter(r => r.missing > 0);
  const empty = rows.filter(r => (r.page.monitor_ids || []).length === 0);

  return (
    <PrintDocument
      kind="Status Page Inventory"
      title="Published Status Pages"
      subtitle={`${list.length} ${list.length === 1 ? 'page' : 'pages'} · ${publicCount} public`}
      status={
        exposedDown > 0
          ? { label: `${exposedDown} showing an outage`, color: RED }
          : { label: 'All published pages green', color: GREEN }
      }
      footNote={`${list.length} pages · ${publicCount} public`}
    >
      <section style={{ marginBottom: '6mm', breakInside: 'avoid' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3mm' }}>
          <Kpi label="Status Pages" value={numberFmt.format(list.length)} sub={`${publicCount} public · ${list.length - publicCount} private`} />
          <Kpi
            label="Publicly Showing Down"
            value={numberFmt.format(exposedDown)}
            sub={exposedDown > 0 ? 'Visible to anyone with the URL' : 'No outages exposed'}
            color={exposedDown > 0 ? RED : undefined}
          />
          <Kpi
            label="Pages Without Monitors"
            value={numberFmt.format(empty.length)}
            sub={empty.length ? 'Publish nothing to visitors' : 'All pages populated'}
            color={empty.length ? AMBER : undefined}
          />
          <Kpi
            label="Broken References"
            value={numberFmt.format(orphaned.reduce((a, r) => a + r.missing, 0))}
            sub={orphaned.length ? `Across ${orphaned.length} pages` : 'All references resolve'}
            color={orphaned.length ? AMBER : undefined}
          />
        </div>
      </section>

      {list.length > 0 && (
        <section style={{ marginBottom: '6mm', breakInside: 'avoid' }}>
          <SectionTitle>Visibility</SectionTitle>
          <DistributionBar segments={[
            { n: publicCount, c: GREEN, label: 'Public' },
            { n: list.length - publicCount, c: OFF, label: 'Private' },
          ]} />
        </section>
      )}

      <section>
        <SectionTitle note={list.length ? 'Outages first' : undefined}>Pages</SectionTitle>
        {list.length === 0 ? (
          <p style={{ color: MUTED, margin: 0 }}>
            No status pages created yet.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' }}>
            <thead style={{ display: 'table-header-group' }}>
              <tr>
                <th scope="col" style={th}>Page</th>
                <th scope="col" style={th}>Public URL</th>
                <th scope="col" style={th}>Visibility</th>
                <th scope="col" style={{ ...th, textAlign: 'right' }}>Monitors</th>
                <th scope="col" style={{ ...th, textAlign: 'right', paddingRight: 0 }}>Current State</th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => (b.down - a.down) || (b.warn - a.warn) || a.page.name.localeCompare(b.page.name))
                .map((r, i) => {
                  const state = r.down > 0 ? `${r.down} down` : r.warn > 0 ? `${r.warn} degraded` : r.linked.length ? 'All up' : 'No monitors';
                  const color = r.down > 0 ? RED : r.warn > 0 ? AMBER : r.linked.length ? GREEN : OFF;
                  return (
                    <tr key={r.page.id || i} style={{ breakInside: 'avoid', background: i % 2 ? ZEBRA : 'transparent' }}>
                      <td style={{ ...td, fontWeight: 600 }}>
                        {r.page.name}
                        {r.page.description && (
                          <div style={{ fontWeight: 400, color: MUTED, fontSize: '8pt', marginTop: '0.5mm' }}>
                            {r.page.description}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, color: MUTED, overflowWrap: 'anywhere', fontSize: '8pt' }}>
                        {base}/status/{r.page.slug}
                      </td>
                      <td style={{ ...td, color: r.page.is_public ? GREEN : MUTED, fontWeight: r.page.is_public ? 700 : 400 }}>
                        {r.page.is_public ? 'PUBLIC' : 'Private'}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {r.linked.length}
                        {r.missing > 0 && <span style={{ color: AMBER }}> (+{r.missing} missing)</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', paddingRight: 0, fontWeight: 700, color }}>
                        {state}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </section>

      {rows.some(r => r.linked.length > 0) && (
        <section style={{ marginTop: '6mm' }}>
          <SectionTitle>Monitors Behind Each Page</SectionTitle>
          {rows.filter(r => r.linked.length > 0).map(r => (
            <div key={r.page.id} style={{ marginBottom: '4mm', breakInside: 'avoid' }}>
              <div style={{ fontWeight: 700, marginBottom: '1.5mm' }}>
                {r.page.name}
                <span style={{ color: MUTED, fontWeight: 400 }}> · /status/{r.page.slug}</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' }}>
                <tbody>
                  {r.linked.map((m: any, j: number) => (
                    <tr key={m.id || j} style={{ breakInside: 'avoid', background: j % 2 ? ZEBRA : 'transparent' }}>
                      <td style={{ ...td, width: '45%' }}>{m.name}</td>
                      <td style={{ ...td, color: MUTED, overflowWrap: 'anywhere' }}>{m.host}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {typeof m.uptime_24h === 'number' ? `${m.uptime_24h.toFixed(2)}%` : '—'}
                      </td>
                      <td style={{ ...td, textAlign: 'right', paddingRight: 0, fontWeight: 700, color: statusColor(m.status) }}>
                        {(m.status || 'unknown').toUpperCase()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}
    </PrintDocument>
  );
}
