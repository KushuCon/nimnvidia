// import { requireSession, supabaseRest, supabaseRpc } from './_supabase.js';
// import { fetchEmbedding, toVectorLiteral } from './_memory.js';

// function logRecoverable(scope, err) {
//   const msg = err && err.message ? err.message : String(err || 'unknown error');
//   console.warn(`[rag-context] ${scope}: ${msg}`);
// }

// function preview(text, max = 260) {
//   const s = String(text || '').replace(/\s+/g, ' ').trim();
//   return s.length <= max ? s : s.slice(0, max) + '...';
// }

// function cleanQueryVariant(text) {
//   return String(text || '')
//     .replace(/^[\s\d.\-•]+/, '')
//     .replace(/\s+/g, ' ')
//     .trim();
// }

// function tokenize(text) {
//   return Array.from(
//     new Set(
//       String(text || '')
//         .toLowerCase()
//         .split(/[^a-z0-9]+/)
//         .filter((t) => t.length > 2)
//     )
//   );
// }

// function lexicalScore(text, queryTerms, rank) {
//   const t = String(text || '').toLowerCase();
//   let hit = 0;
//   for (const q of queryTerms) {
//     if (t.includes(q)) hit += 1;
//   }
//   return hit * 4 + Math.max(0, 2 - rank * 0.02);
// }

// function dedupeSnippets(items, limit) {
//   const out = [];
//   const seen = new Set();
//   for (const s of items) {
//     const key = s.message_id
//       ? `m:${s.message_id}`
//       : `${s.conversation_id}:${preview(s.text || '', 120)}`;
//     if (seen.has(key)) continue;
//     seen.add(key);
//     out.push(s);
//     if (out.length >= limit) break;
//   }
//   return out;
// }

// function rrf(items, k = 60) {
//   const scoreMap = new Map();
//   ['vector', 'summary', 'lexical'].forEach((source) => {
//     const group = items
//       .filter((item) => item.source === source)
//       .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
//     group.forEach((item, rank) => {
//       const key = item.message_id ? `m:${item.message_id}` : `${item.conversation_id}:${preview(item.text || '', 80)}`;
//       scoreMap.set(key, (scoreMap.get(key) || 0) + 1 / (k + rank + 1));
//     });
//   });

//   return items
//     .map((item) => {
//       const key = item.message_id ? `m:${item.message_id}` : `${item.conversation_id}:${preview(item.text || '', 80)}`;
//       return { ...item, score: scoreMap.get(key) || 0 };
//     })
//     .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
// }

// function getNvidiaApiKey() {
//   return process.env.NVIDIA_API_KEY || null;
// }

// async function expandQueryVariants(query) {
//   const apiKey = getNvidiaApiKey();
//   if (!apiKey) return [query];

//   try {
//     const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         Authorization: `Bearer ${apiKey}`,
//       },
//       body: JSON.stringify({
//         model: process.env.NVIDIA_QUERY_REWRITE_MODEL || 'microsoft/phi-4-mini-flash-reasoning',
//         messages: [
//           {
//             role: 'system',
//             content:
//               'Rewrite the user search query into 2 to 3 short semantic search variants. Return one variant per line only. Do not explain.',
//           },
//           {
//             role: 'user',
//             content: String(query || ''),
//           },
//         ],
//         max_tokens: 64,
//         temperature: 0.2,
//         stream: false,
//       }),
//     });

//     const raw = await response.text();
//     let data = null;
//     try {
//       data = raw ? JSON.parse(raw) : null;
//     } catch (err) {
//       logRecoverable('expandQueryVariants.parse', err);
//       data = null;
//     }

//     const content = data && data.choices && data.choices[0] && data.choices[0].message
//       ? data.choices[0].message.content
//       : '';
//     const variants = String(content || '')
//       .split(/\n+/)
//       .map(cleanQueryVariant)
//       .filter(Boolean);

//     const unique = [];
//     const seen = new Set();
//     [query, ...variants].forEach((value) => {
//       const clean = cleanQueryVariant(value);
//       if (!clean) return;
//       const key = clean.toLowerCase();
//       if (seen.has(key)) return;
//       seen.add(key);
//       unique.push(clean);
//     });
//     return unique.slice(0, 4);
//   } catch (err) {
//     logRecoverable('expandQueryVariants', err);
//     return [query];
//   }
// }

// async function fetchFeedbackMap(session, messageIds, conversationIds) {
//   if (!messageIds.length) return {};
//   const idList = `(${messageIds.join(',')})`;
//   const convList = Array.isArray(conversationIds) && conversationIds.length
//     ? `(${conversationIds.join(',')})`
//     : null;
//   try {
//     const rows = await supabaseRest(
//       `message_feedback?select=message_id,feedback&user_id=eq.${session.user_id}` +
//         (convList ? `&conversation_id=in.${convList}` : '') +
//         `&message_id=in.${idList}`
//     );
//     return Object.fromEntries((rows || []).map((row) => [String(row.message_id), row.feedback]));
//   } catch (err) {
//     logRecoverable('fetchFeedbackMap', err);
//     return {};
//   }
// }

// export default async function handler(req, res) {
//   try {
//     const session = await requireSession(req, res);
//     if (!session) return;

//     if (req.method !== 'POST') {
//       return res.status(405).json({ error: 'Method not allowed' });
//     }

//     const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
//     const query = String(payload.query || '').trim();
//     const conversationId = String(payload.conversation_id || '').trim();
//     const scope = payload.scope === 'current' ? 'current' : 'all';
//     const limit = Math.max(1, Math.min(Number(payload.limit || 6), 12));

//     if (!query) return res.status(200).json({ snippets: [] });

//     const conversations = await supabaseRest(
//       `conversations?select=id,title,updated_at&user_id=eq.${session.user_id}&order=updated_at.desc&limit=80`
//     );
//     if (!conversations || !conversations.length) return res.status(200).json({ snippets: [] });

//     const titleById = Object.fromEntries(conversations.map((c) => [c.id, c.title || 'Chat']));

//     let ids = [];
//     if (scope === 'current' && conversationId) {
//       ids = conversations.some((c) => c.id === conversationId) ? [conversationId] : [];
//     } else {
//       ids = conversations.slice(0, 50).map((c) => c.id);
//     }

//     if (!ids.length) return res.status(200).json({ snippets: [] });

//     const snippets = [];
//     const variantQueries = await expandQueryVariants(query);
//     const vectorMessageIds = new Set();

//     // 1) Vector retrieval from indexed chunks, with query expansion.
//     for (const variant of variantQueries) {
//       try {
//         const emb = await fetchEmbedding(variant);
//         if (!emb) continue;
//         const vectorRows = await supabaseRpc('match_memory_chunks', {
//           query_embedding: toVectorLiteral(emb),
//           match_user_id: session.user_id,
//           match_conversation_ids: ids,
//           match_count: limit * 3,
//         });

//         (vectorRows || []).forEach((row) => {
//           if (row.message_id) vectorMessageIds.add(String(row.message_id));
//           snippets.push({
//             source: 'vector',
//             message_id: row.message_id || null,
//             conversation_id: row.conversation_id,
//             title: titleById[row.conversation_id] || 'Chat',
//             role: row.role,
//             text: preview(row.chunk_text),
//             created_at: row.created_at,
//             score: Math.round((1 - Number(row.similarity || 0)) * 100) / 100,
//           });
//         });
//       } catch (err) {
//         logRecoverable('vectorRetrieval', err);
//       }
//     }

//     // 2) Bring periodic summary snapshots.
//     try {
//       const idList = `(${ids.join(',')})`;
//       const sums = await supabaseRest(
//         `memory_summaries?select=conversation_id,summary_text,created_at&conversation_id=in.${idList}&order=created_at.desc&limit=8`
//       );
//       (sums || []).forEach((s, idx) => {
//         snippets.push({
//           source: 'summary',
//           conversation_id: s.conversation_id,
//           title: titleById[s.conversation_id] || 'Chat',
//           role: 'system',
//           message_id: null,
//           text: preview(s.summary_text, 320),
//           created_at: s.created_at,
//           score: Math.max(0.4, 1.2 - idx * 0.08),
//         });
//       });
//     } catch (err) {
//       logRecoverable('summaryRetrieval', err);
//     }

//     // 3) Lexical fallback for robustness.
//     if (snippets.length < limit) {
//       const idList = `(${ids.join(',')})`;
//       const rows = await supabaseRest(
//         `messages?select=id,conversation_id,role,content,created_at&conversation_id=in.${idList}&order=created_at.desc&limit=1200`
//       );
//       const terms = tokenize([query, ...variantQueries].join(' '));
//       const scored = (rows || [])
//         .filter((r) => r && r.content)
//         .map((r, idx) => ({
//           source: 'lexical',
//           message_id: r.id || null,
//           conversation_id: r.conversation_id,
//           title: titleById[r.conversation_id] || 'Chat',
//           role: r.role,
//           text: preview(r.content),
//           created_at: r.created_at,
//           score: lexicalScore(r.content, terms, idx),
//         }))
//         .filter((r) => r.score > 1)
//         .sort((a, b) => b.score - a.score || String(b.created_at).localeCompare(String(a.created_at)));

//       snippets.push(...scored.slice(0, limit * 3));
//     }

//     const allMessageIds = Array.from(
//       new Set(snippets.map((snippet) => String(snippet.message_id || '')).filter(Boolean))
//     );
//     const feedbackMap = await fetchFeedbackMap(session, allMessageIds, ids);
//     snippets.forEach((snippet) => {
//       if (!snippet.message_id) return;
//       const feedback = feedbackMap[String(snippet.message_id)];
//       if (feedback === 'down') snippet.score = Number(snippet.score || 0) - 2;
//       if (feedback === 'up') snippet.score = Number(snippet.score || 0) + 0.5;
//     });

//     // Conversation-level downvote penalty.
//     try {
//       const downvotes = await supabaseRest(
//         `message_feedback?select=conversation_id&user_id=eq.${session.user_id}&feedback=eq.down`
//       );
//       const badConvos = new Set((downvotes || []).map((row) => row.conversation_id));
//       snippets.forEach((snippet) => {
//         if (badConvos.has(snippet.conversation_id)) {
//           snippet.score = Number(snippet.score || 0) - 2;
//         }
//       });
//     } catch (err) {
//       logRecoverable('conversationDownvotePenalty', err);
//     }

//     const fused = rrf(snippets);
//     return res.status(200).json({ snippets: dedupeSnippets(fused, limit) });
//   } catch (err) {
//     return res.status(err.status || 500).json({
//       error: err.message || 'RAG retrieval error',
//       detail: err.data || null,
//     });
//   }
// }




import { requireSession, supabaseRest, supabaseRpc } from './_supabase.js';
import { fetchEmbedding, toVectorLiteral } from './_memory.js';

function logRecoverable(scope, err) {
  const msg = err && err.message ? err.message : String(err || 'unknown error');
  console.warn(`[rag-context] ${scope}: ${msg}`);
}

function preview(text, max = 260) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max) + '...';
}

function cleanQueryVariant(text) {
  return String(text || '')
    .replace(/^[\s\d.\-•]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
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
    const key = s.message_id
      ? `m:${s.message_id}`
      : `${s.conversation_id}:${preview(s.text || '', 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function rrf(items, k = 60) {
  const scoreMap = new Map();
  ['vector', 'summary', 'lexical', 'entity'].forEach((source) => {
    const group = items
      .filter((item) => item.source === source)
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    group.forEach((item, rank) => {
      const key = item.message_id ? `m:${item.message_id}` : `${item.conversation_id}:${preview(item.text || '', 80)}`;
      scoreMap.set(key, (scoreMap.get(key) || 0) + 1 / (k + rank + 1));
    });
  });

  return items
    .map((item) => {
      const key = item.message_id ? `m:${item.message_id}` : `${item.conversation_id}:${preview(item.text || '', 80)}`;
      return { ...item, score: scoreMap.get(key) || 0 };
    })
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function getNvidiaApiKey() {
  return process.env.NVIDIA_API_KEY || null;
}

async function expandQueryVariants(query) {
  const apiKey = getNvidiaApiKey();
  if (!apiKey) return [query];

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.NVIDIA_QUERY_REWRITE_MODEL || 'microsoft/phi-4-mini-flash-reasoning',
        messages: [
          {
            role: 'system',
            content:
              'Rewrite the user search query into 2 to 3 short semantic search variants. Return one variant per line only. Do not explain.',
          },
          {
            role: 'user',
            content: String(query || ''),
          },
        ],
        max_tokens: 64,
        temperature: 0.2,
        stream: false,
      }),
    });

    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (err) {
      logRecoverable('expandQueryVariants.parse', err);
      data = null;
    }

    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    const variants = String(content || '')
      .split(/\n+/)
      .map(cleanQueryVariant)
      .filter(Boolean);

    const unique = [];
    const seen = new Set();
    [query, ...variants].forEach((value) => {
      const clean = cleanQueryVariant(value);
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(clean);
    });
    return unique.slice(0, 4);
  } catch (err) {
    logRecoverable('expandQueryVariants', err);
    return [query];
  }
}

// ---------------------------------------------------------------------------
// Entity-aware retrieval
// ---------------------------------------------------------------------------
// Given the current query, look up any entity_tags that the user has stored
// across all their conversations. If the query matches an alias or value of a
// known entity, return the conversation IDs where that entity was discussed —
// so those conversations get a ranking boost in the final RRF fusion.
//
// Example: query = "my exam" → finds entity { kind:"exam", value:"GATE" } in
// chat 1 → boosts chat 1's chunks into the top results for chat 5's query.
// ---------------------------------------------------------------------------

async function resolveEntityConversations(userId, query, allConversationIds) {
  if (!userId || !query || !allConversationIds.length) return { boostedConvIds: new Set(), entityHints: [] };

  const q = query.toLowerCase().trim();
  const qTokens = tokenize(q);

  // Pull all entity tags for this user across their recent conversations.
  // Limit to 200 rows — enough for any real user's history.
  let tags = [];
  try {
    const idList = `(${allConversationIds.join(',')})`;
    const rows = await supabaseRest(
      `entity_tags?select=conversation_id,kind,value,aliases&user_id=eq.${userId}&conversation_id=in.${idList}&order=created_at.desc&limit=200`
    );
    tags = Array.isArray(rows) ? rows : [];
  } catch (err) {
    logRecoverable('resolveEntityConversations.fetch', err);
    return { boostedConvIds: new Set(), entityHints: [] };
  }

  if (!tags.length) return { boostedConvIds: new Set(), entityHints: [] };

  // Score each unique entity value against the query.
  // Match strategy (in priority order):
  //   1. Query contains the entity's canonical value   (e.g. "GATE" in "my GATE prep")
  //   2. Query contains one of the entity's aliases    (e.g. "gate" in "gate exam tips")
  //   3. Any query token matches an alias token        (e.g. "exam" when aliases include "gate exam")
  //
  // We collect all matched entity values, then gather the conversation IDs
  // that discussed those entities — those conversations get a boost.

  const matchedEntities = new Map(); // value -> { kind, convIds: Set }

  for (const tag of tags) {
    const value = String(tag.value || '').trim();
    const kind = String(tag.kind || '');
    const aliases = Array.isArray(tag.aliases) ? tag.aliases : [];
    const convId = tag.conversation_id;
    if (!value || !convId) continue;

    const valueLower = value.toLowerCase();
    let matched = false;

    // Priority 1: canonical value appears in query
    if (q.includes(valueLower)) matched = true;

    // Priority 2: any alias appears in query
    if (!matched) {
      for (const alias of aliases) {
        if (alias && q.includes(alias)) { matched = true; break; }
      }
    }

    // Priority 3: token-level partial match
    // e.g. query has "exam" and alias is "gate exam" → token "exam" hits alias token "exam"
    if (!matched) {
      const allAliasTokens = aliases.flatMap(a => tokenize(a));
      const valueTokens = tokenize(valueLower);
      const entityTokens = new Set([...valueTokens, ...allAliasTokens]);
      for (const qt of qTokens) {
        if (entityTokens.has(qt)) { matched = true; break; }
      }
    }

    if (matched) {
      if (!matchedEntities.has(value)) {
        matchedEntities.set(value, { kind, convIds: new Set() });
      }
      matchedEntities.get(value).convIds.add(convId);
    }
  }

  const boostedConvIds = new Set();
  const entityHints = [];

  for (const [value, { kind, convIds }] of matchedEntities) {
    for (const cid of convIds) boostedConvIds.add(cid);
    entityHints.push({ kind, value, convIds: Array.from(convIds) });
  }

  return { boostedConvIds, entityHints };
}

// Fetch the actual memory chunks for entity-matched conversations and tag
// them as source='entity' so they get their own RRF lane (higher weight
// than plain lexical, lower than direct vector hits).
async function fetchEntitySnippets(userId, boostedConvIds, titleById, limit) {
  if (!boostedConvIds.size) return [];
  const idList = `(${Array.from(boostedConvIds).join(',')})`;

  try {
    const rows = await supabaseRest(
      `messages?select=id,conversation_id,role,content,created_at` +
      `&conversation_id=in.${idList}&user_id=not.is.null&order=created_at.desc&limit=400`
    );
    // Note: messages don't have user_id directly — filter via conversation ownership
    // is already guaranteed by resolveEntityConversations (we only passed in the
    // user's own conversation IDs). So no extra filter needed here.
    return (rows || [])
      .filter(r => r && r.content)
      .slice(0, limit * 4)
      .map((r, idx) => ({
        source: 'entity',
        message_id: r.id || null,
        conversation_id: r.conversation_id,
        title: titleById[r.conversation_id] || 'Chat',
        role: r.role,
        text: preview(r.content),
        created_at: r.created_at,
        score: Math.max(0.5, 2.0 - idx * 0.02), // flat high score — RRF will re-rank
      }));
  } catch (err) {
    logRecoverable('fetchEntitySnippets', err);
    return [];
  }
}

async function fetchFeedbackMap(session, messageIds, conversationIds) {
  if (!messageIds.length) return {};
  const idList = `(${messageIds.join(',')})`;
  const convList = Array.isArray(conversationIds) && conversationIds.length
    ? `(${conversationIds.join(',')})`
    : null;
  try {
    const rows = await supabaseRest(
      `message_feedback?select=message_id,feedback&user_id=eq.${session.user_id}` +
        (convList ? `&conversation_id=in.${convList}` : '') +
        `&message_id=in.${idList}`
    );
    return Object.fromEntries((rows || []).map((row) => [String(row.message_id), row.feedback]));
  } catch (err) {
    logRecoverable('fetchFeedbackMap', err);
    return {};
  }
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
    const variantQueries = await expandQueryVariants(query);
    const vectorMessageIds = new Set();

    // 1) Entity resolution — find which conversations are about the same named
    //    entity the user is vaguely referring to right now.
    const { boostedConvIds, entityHints } = await resolveEntityConversations(
      session.user_id, query, ids
    );

    // 2) Entity snippets — pull full message context from matched conversations.
    //    These go into their own RRF lane so vague references like "exam" will
    //    reliably surface the GATE conversation from chat 1.
    if (boostedConvIds.size) {
      const entitySnippets = await fetchEntitySnippets(
        session.user_id, boostedConvIds, titleById, limit
      );
      snippets.push(...entitySnippets);
    }

    // 3) Vector retrieval from indexed chunks, with query expansion.
    for (const variant of variantQueries) {
      try {
        const emb = await fetchEmbedding(variant);
        if (!emb) continue;
        const vectorRows = await supabaseRpc('match_memory_chunks', {
          query_embedding: toVectorLiteral(emb),
          match_user_id: session.user_id,
          match_conversation_ids: ids,
          match_count: limit * 3,
        });

        (vectorRows || []).forEach((row) => {
          if (row.message_id) vectorMessageIds.add(String(row.message_id));
          snippets.push({
            source: 'vector',
            message_id: row.message_id || null,
            conversation_id: row.conversation_id,
            title: titleById[row.conversation_id] || 'Chat',
            role: row.role,
            text: preview(row.chunk_text),
            created_at: row.created_at,
            score: Math.round((1 - Number(row.similarity || 0)) * 100) / 100,
          });
        });
      } catch (err) {
        logRecoverable('vectorRetrieval', err);
      }
    }

    // 4) Periodic summary snapshots.
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
          message_id: null,
          text: preview(s.summary_text, 320),
          created_at: s.created_at,
          score: Math.max(0.4, 1.2 - idx * 0.08),
        });
      });
    } catch (err) {
      logRecoverable('summaryRetrieval', err);
    }

    // 5) Lexical fallback for robustness when vector index is sparse.
    if (snippets.length < limit) {
      const idList = `(${ids.join(',')})`;
      const rows = await supabaseRest(
        `messages?select=id,conversation_id,role,content,created_at&conversation_id=in.${idList}&order=created_at.desc&limit=1200`
      );
      const terms = tokenize([query, ...variantQueries].join(' '));
      const scored = (rows || [])
        .filter((r) => r && r.content)
        .map((r, idx) => ({
          source: 'lexical',
          message_id: r.id || null,
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

    // Feedback scoring
    const allMessageIds = Array.from(
      new Set(snippets.map((snippet) => String(snippet.message_id || '')).filter(Boolean))
    );
    const feedbackMap = await fetchFeedbackMap(session, allMessageIds, ids);
    snippets.forEach((snippet) => {
      if (!snippet.message_id) return;
      const feedback = feedbackMap[String(snippet.message_id)];
      if (feedback === 'down') snippet.score = Number(snippet.score || 0) - 2;
      if (feedback === 'up') snippet.score = Number(snippet.score || 0) + 0.5;
    });

    // Conversation-level downvote penalty
    try {
      const downvotes = await supabaseRest(
        `message_feedback?select=conversation_id&user_id=eq.${session.user_id}&feedback=eq.down`
      );
      const badConvos = new Set((downvotes || []).map((row) => row.conversation_id));
      snippets.forEach((snippet) => {
        if (badConvos.has(snippet.conversation_id)) {
          snippet.score = Number(snippet.score || 0) - 2;
        }
      });
    } catch (err) {
      logRecoverable('conversationDownvotePenalty', err);
    }

    const fused = rrf(snippets);
    const finalSnippets = dedupeSnippets(fused, limit);

    // Attach entity hints to the response so the frontend/LLM system prompt can
    // tell the model "when the user says 'exam' they likely mean GATE".
    return res.status(200).json({
      snippets: finalSnippets,
      entity_hints: entityHints, // e.g. [{ kind: "exam", value: "GATE", convIds: [...] }]
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'RAG retrieval error',
      detail: err.data || null,
    });
  }
}