import { requireSession, supabaseRest } from './_supabase.js';

export default async function handler(req, res) {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    if (req.method === 'GET') {
      const rows = await supabaseRest(
        `conversations?select=id,title,created_at,updated_at&user_id=eq.${session.user_id}&order=updated_at.desc`
      );
      return res.status(200).json({ conversations: rows || [] });
    }

    if (req.method === 'POST') {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const title = String(payload.title || 'New Chat').trim().slice(0, 120) || 'New Chat';

      const rows = await supabaseRest('conversations', {
        method: 'POST',
        body: [{ user_id: session.user_id, title }],
      });

      return res.status(200).json({ conversation: rows[0] });
    }

    if (req.method === 'PATCH') {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const id = String(payload.id || '').trim();
      const title = String(payload.title || '').trim().slice(0, 120);

      if (!id) {
        return res.status(400).json({ error: 'Conversation id is required' });
      }
      if (!title) {
        return res.status(400).json({ error: 'Title is required' });
      }

      const owned = await supabaseRest(
        `conversations?select=id&user_id=eq.${session.user_id}&id=eq.${id}&limit=1`
      );
      if (!owned || !owned.length) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const rows = await supabaseRest(`conversations?id=eq.${id}`, {
        method: 'PATCH',
        body: { title, updated_at: new Date().toISOString() },
      });

      return res.status(200).json({ conversation: rows && rows[0] ? rows[0] : { id, title } });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'Conversation error',
      detail: err.data || null,
    });
  }
}
