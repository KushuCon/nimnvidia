import { requireSession, supabaseRpc } from './_supabase.js';

function decodeHtml(input) {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function stripTags(html) {
  return decodeHtml(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function preview(text, max = 900) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max) + '...';
}

function normalizeUrl(raw) {
  const u = String(raw || '').trim();
  if (!u) return null;
  try {
    const parsed = new URL(u);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function searchDuckDuckGo(query, limit) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
  });
  const html = await res.text();

  const out = [];
  const seen = new Set();
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < limit * 3) {
    const href = decodeHtml(m[1]);
    const title = stripTags(m[2]);
    const normalized = normalizeUrl(href);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ title: title || normalized, url: normalized, source: 'duckduckgo' });
  }
  return out.slice(0, limit * 2);
}

async function searchTavily(query, limit) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];

  try {
    await supabaseRpc('increment_tavily_call', {});
  } catch {
    // Non-fatal for retrieval; do not block search if stats increment fails.
  }

  const res = await fetchWithTimeout('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: key,
      query,
      topic: 'general',
      search_depth: 'basic',
      include_answer: false,
      include_images: false,
      include_raw_content: false,
      max_results: Math.max(4, Math.min(limit * 2, 8)),
    }),
  });

  const data = await res.json();
  const rows = Array.isArray(data && data.results) ? data.results : [];
  return rows
    .map((r) => ({
      title: String(r && r.title ? r.title : '').trim(),
      url: normalizeUrl(r && r.url),
      text: preview(r && r.content ? r.content : '', 1300),
      source: 'tavily',
    }))
    .filter((r) => r.url)
    .slice(0, limit * 2);
}

async function extractUrlText(url) {
  const readerUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`;
  const res = await fetchWithTimeout(readerUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
  }, 12000);
  const text = await res.text();
  return preview(text, 1300);
}

function scoreSnippet(text, query) {
  const t = String(text || '').toLowerCase();
  const qTerms = Array.from(
    new Set(
      String(query || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((x) => x.length > 2)
    )
  );

  let hits = 0;
  for (const term of qTerms) {
    if (t.includes(term)) hits += 1;
  }
  return hits;
}

export default async function handler(req, res) {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const query = String(payload.query || '').trim();
    const limit = Math.max(1, Math.min(Number(payload.limit || 4), 8));

    if (!query) return res.status(200).json({ snippets: [] });

    let candidates = await searchTavily(query, limit);
    if (!candidates.length) {
      candidates = await searchDuckDuckGo(query, limit);
    }

    const snippets = [];
    for (const item of candidates.slice(0, limit * 2)) {
      try {
        const text = item.text || (await extractUrlText(item.url));
        if (!text) continue;
        snippets.push({
          title: item.title,
          url: item.url,
          source: item.source,
          text,
          score: scoreSnippet(text, query),
        });
      } catch {
        // ignore source failures and continue with others
      }
      if (snippets.length >= limit) break;
    }

    snippets.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    return res.status(200).json({ snippets: snippets.slice(0, limit) });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'Web retrieval error',
      detail: err.data || null,
    });
  }
}
