/**
 * When a saved link is a YouTube video, read what is said in it (founder,
 * 20 Oct), through a transcript service (Supadata) rather than scraping
 * YouTube. Captions only (mode=native: one credit a video, no AI
 * transcription); long videos come back as a job, waited on briefly. Off
 * until SUPADATA_API_KEY is set; without it, links are read as before.
 */

const API = 'https://api.supadata.ai/v1/transcript';

/** The canonical watch URL for any YouTube video link, or null. Pure. */
export function youtubeVideoUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com') id = u.searchParams.get('v') ?? (u.pathname.match(/^\/(shorts|live|embed)\/([A-Za-z0-9_-]{6,})/)?.[2] ?? null);
  return id && /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

export async function fetchTranscript(videoUrl: string, options: { key?: string; fetcher?: typeof fetch; waitMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<string | null> {
  const key = options.key ?? process.env.SUPADATA_API_KEY;
  if (!key) return null;
  const f = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const headers = { 'x-api-key': key };
  const res = await f(`${API}?url=${encodeURIComponent(videoUrl)}&text=true&mode=native`, { headers, signal: AbortSignal.timeout(15_000) });
  if (res.status === 200) return String(((await res.json()) as { content?: unknown }).content ?? '') || null;
  if (res.status !== 202) return null;                       // 206 no captions · 403 restricted · 404 private or gone
  const { jobId } = (await res.json()) as { jobId?: string };
  if (!jobId) return null;
  for (let waited = 0; waited < (options.waitMs ?? 30_000); waited += 1000) {
    await sleep(1000);
    const j = await f(`${API}/${jobId}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (j.status !== 200) return null;
    const body = (await j.json()) as { status?: string; content?: unknown };
    if (body.status === 'completed') return String(body.content ?? '') || null;
    if (body.status === 'failed') return null;
  }
  return null;                                               // still running: read the page as before, try again never
}
