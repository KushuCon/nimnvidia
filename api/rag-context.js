import { requireSession, supabaseRest, supabaseRpc } from './_supabase.js';
import { fetchEmbedding, toVectorLiteral } from './_memory.js';

function preview(text, max = 260) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max) + '...';
}

function tokenize(text) {
  return Array.from(
    new Set(
      String(text || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2)
    )
  );
}

function lexicalScore(text, queryTerms, rank) {
  const t = String(text || '').toLowerCase();
  let hit = 0;
  for (const q of queryTerms) {
    if (t.includes(q)) hit += 1;
  }
  return hit * 4 + Math.max(0, 2 - rank * 0.02);
}

function dedupeSnippets(items, limit) {
  const out = [];
  const seen = new Set();
  for (const s of items) {
    const key = `${s.conversation_id}:${preview(s.text || '', 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
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
    const conversationId = String(payload.conversation_id || '').trim();
    const scope = payload.scope === 'current' ? 'current' : 'all';
    const limit = Math.max(1, Math.min(Number(payload.limit || 6), 12));

    if (!query) return res.status(200).json({ snippets: [] });

    const conversations = await supabaseRest(
      `conversations?select=id,title,updated_at&user_id=eq.${session.user_id}&order=updated_at.desc&limit=80`
    );
    if (!conversations || !conversations.length) return res.status(200).json({ snippets: [] });

    const titleById = Object.fromEntries(conversations.map((c) => [c.id, c.title || 'Chat']));

    let ids = [];
    if (scope === 'current' && conversationId) {
      ids = conversations.some((c) => c.id === conversationId) ? [conversationId] : [];
    } else {
      ids = conversations.slice(0, 50).map((c) => c.id);
    }
    if (!ids.length) return res.status(200).json({ snippets: [] });

    const snippets = [];

    // 1) Vector retrieval from indexed chunks.
    try {
      const emb = await fetchEmbedding(query);
      if (emb) {
        const vectorRows = await supabaseRpc('match_memory_chunks', {
          query_embedding: toVectorLiteral(emb),
          match_user_id: session.user_id,
          match_conversation_ids: ids,
          match_count: limit * 3,
        });

        (vectorRows || []).forEach((r) => {
          snippets.push({
            source: 'vector',
            conversation_id: r.conversation_id,
            title: titleById[r.conversation_id] || 'Chat',
            role: r.role,
            text: preview(r.chunk_text),
            created_at: r.created_at,
            score: Math.round((1 - Number(r.similarity || 0)) * 100) / 100,
          });
        });
      }
    } catch {
      // If vector stack is unavailable, fallback layers below still work.
    }

    // 2) Bring periodic summary snapshots.
    try {
      const idList = `(${ids.join(',')})`;
      const sums = await supabaseRest(
        `memory_summaries?select=conversation_id,summary_text,created_at&conversation_id=in.${idList}&order=created_at.desc&limit=8`
      );
      (sums || []).forEach((s, idx) => {
        snippets.push({
          source: 'summary',
          conversation_id: s.conversation_id,
          title: titleById[s.conversation_id] || 'Chat',
          role: 'system',
          text: preview(s.summary_text, 320),
          created_at: s.created_at,
          score: Math.max(0.4, 1.2 - idx * 0.08),
        });
      });
    } catch {
      // Summary table may not exist yet before migration.
    }

    // 3) Lexical fallback for robustness.
    if (snippets.length < limit) {
      const idList = `(${ids.join(',')})`;
      const rows = await supabaseRest(
        `messages?select=conversation_id,role,content,created_at&conversation_id=in.${idList}&order=created_at.desc&limit=1200`
      );
      const terms = tokenize(query);
      const scored = (rows || [])
        .filter((r) => r && r.content)
        .map((r, idx) => ({
          source: 'lexical',
          conversation_id: r.conversation_id,
          title: titleById[r.conversation_id] || 'Chat',
          role: r.role,
          text: preview(r.content),
          created_at: r.created_at,
          score: lexicalScore(r.content, terms, idx),
        }))
        .filter((r) => r.score > 1)
        .sort((a, b) => b.score - a.score || String(b.created_at).localeCompare(String(a.created_at)));

      snippets.push(...scored.slice(0, limit * 3));
    }

    snippets.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    return res.status(200).json({ snippets: dedupeSnippets(snippets, limit) });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'RAG retrieval error',
      detail: err.data || null,
    });
  }
}