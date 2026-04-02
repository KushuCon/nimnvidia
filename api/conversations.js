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

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'Conversation error',
      detail: err.data || null,
    });
  }
}
