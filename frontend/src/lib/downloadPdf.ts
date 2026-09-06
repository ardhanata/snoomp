/**
 * Download a server-generated PDF report.
 *
 * The reports are behind auth, so a plain <a href> or window.open cannot fetch
 * them — the token lives in memory/localStorage and never travels as a cookie.
 * Fetching as a blob and clicking a synthetic link is the only way to get an
 * authenticated download *and* control the filename.
 *
 * The filename comes from the server's Content-Disposition so the document and
 * its file agree; the fallback only applies if a proxy strips the header.
 */

export interface DownloadResult {
  ok: boolean;
  filename?: string;
  error?: string;
}

function filenameFrom(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match ? decodeURIComponent(match[1]) : fallback;
}

export async function downloadPdf(
  url: string,
  token: string | null,
  fallbackName = 'snoomp-report.pdf',
): Promise<DownloadResult> {
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) {
      if (res.status === 401) return { ok: false, error: 'Your session expired. Sign in and try again.' };
      if (res.status === 404) return { ok: false, error: 'That monitor no longer exists.' };
      return { ok: false, error: `The server could not build the report (HTTP ${res.status}).` };
    }

    const blob = await res.blob();
    const filename = filenameFrom(res.headers.get('Content-Disposition'), fallbackName);

    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking immediately can cancel the download in some browsers; one turn
    // of the event loop is enough for the click to be consumed.
    setTimeout(() => URL.revokeObjectURL(href), 10_000);

    return { ok: true, filename };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Could not reach the server.' };
  }
}
