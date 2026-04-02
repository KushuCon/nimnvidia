import { requireSession, supabaseRest } from './_supabase.js';

function firstLineTitle(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return 'New Chat';
  return s.slice(0, 60);
}

async function getOwnedConversation(conversationId, userId) {
  const rows = await supabaseRest(
    `conversations?select=id,title,user_id&user_id=eq.${userId}&id=eq.${conversationId}&limit=1`
  );
  return rows && rows[0] ? rows[0] : null;
}

export default async function handler(req, res) {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    if (req.method === 'GET') {
      const conversationId = String(req.query.conversation_id || '');
      if (!conversationId) return res.status(400).json({ error: 'conversation_id is required' });

      const convo = await getOwnedConversation(conversationId, session.user_id);
      if (!convo) return res.status(404).json({ error: 'Conversation not found' });

      const rows = await supabaseRest(
        `messages?select=id,role,content,model_id,created_at&conversation_id=eq.${conversationId}&order=id.asc`
      );
      return res.status(200).json({ messages: rows || [] });
    }

    if (req.method === 'POST') {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const conversationId = String(payload.conversation_id || '');
      const role = String(payload.role || '');
      const content = String(payload.content || '').trim();
      const modelId = payload.model_id ? String(payload.model_id) : null;

      if (!conversationId) return res.status(400).json({ error: 'conversation_id is required' });
      if (!['user', 'assistant', 'system'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
      if (!content) return res.status(400).json({ error: 'content is required' });

      const convo = await getOwnedConversation(conversationId, session.user_id);
      if (!convo) return res.status(404).json({ error: 'Conversation not found' });

      const inserted = await supabaseRest('messages', {
        method: 'POST',
        body: [{ conversation_id: conversationId, role, content, model_id: modelId }],
      });

      await supabaseRest(`conversations?id=eq.${conversationId}`, {
        method: 'PATCH',
        body: { updated_at: new Date().toISOString() },
      });

      if (role === 'user' && (!convo.title || convo.title === 'New Chat')) {
        await supabaseRest(`conversations?id=eq.${conversationId}`, {
          method: 'PATCH',
          body: { title: firstLineTitle(content) },
        });
      }

      return res.status(200).json({ message: inserted[0] });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'Messages error',
      detail: err.data || null,
    });
  }
}
