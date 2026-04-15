// import { supabaseRest } from './_supabase.js';

// function getNvidiaApiKey() {
//   const key = process.env.NVIDIA_API_KEY;
//   if (!key) throw new Error('NVIDIA_API_KEY not set');
//   return key;
// }

// function getEmbeddingModel() {
//   return process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/llama-3_2-nv-embedqa-1b-v2';
// }

// function normalizeSpaces(text) {
//   return String(text || '').replace(/\s+/g, ' ').trim();
// }

// function getMaxMemoryChunks() {
//   const n = Number(process.env.MEMORY_MAX_CHUNKS || 12);
//   return Number.isFinite(n) ? Math.max(1, Math.min(Math.floor(n), 32)) : 12;
// }

// function logRecoverable(scope, err) {
//   const msg = err && err.message ? err.message : String(err || 'unknown error');
//   console.warn(`[memory] ${scope}: ${msg}`);
// }

// export function toVectorLiteral(embedding) {
//   return `[${embedding.join(',')}]`;
// }

// export async function fetchEmbedding(text) {
//   const input = normalizeSpaces(text);
//   if (!input) return null;

//   const res = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: `Bearer ${getNvidiaApiKey()}`,
//     },
//     body: JSON.stringify({
//       model: getEmbeddingModel(),
//       input: [input],
//       encoding_format: 'float',
//     }),
//   });

//   const raw = await res.text();
//   let data = null;
//   try {
//     data = raw ? JSON.parse(raw) : null;
//   } catch (err) {
//     logRecoverable('fetchEmbedding.parse', err);
//     data = null;
//   }

//   if (!res.ok || !data || !data.data || !data.data[0] || !Array.isArray(data.data[0].embedding)) {
//     throw new Error((data && (data.error || data.message)) || `Embedding error ${res.status}`);
//   }

//   return data.data[0].embedding;
// }

// export function splitIntoChunks(text, role = 'user') {
//   const chunkSize = role === 'assistant' ? 800 : 400;
//   const overlap = role === 'assistant' ? 150 : 80;
//   const clean = normalizeSpaces(text);
//   if (!clean) return [];

//   const out = [];
//   let i = 0;
//   while (i < clean.length) {
//     let end = Math.min(i + chunkSize, clean.length);
//     if (end < clean.length) {
//       const boundary = clean.lastIndexOf('. ', end);
//       if (boundary > i + 200) end = boundary + 1;
//     }

//     const piece = clean.slice(i, end).trim();
//     if (piece) out.push(piece);
//     if (end >= clean.length) break;
//     i = Math.max(end - overlap, i + 1);
//   }

//   return out.slice(0, getMaxMemoryChunks());
// }

// async function summarizeWithNvidia(conversationMessages) {
//   const apiKey = getNvidiaApiKey();
//   const lines = (conversationMessages || [])
//     .map((m) => `${m.role}: ${normalizeSpaces(m.content)}`)
//     .slice(0, 28)
//     .join('\n');

//   if (!lines) return null;

//   const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: `Bearer ${apiKey}`,
//     },
//     body: JSON.stringify({
//       model: process.env.NVIDIA_SUMMARY_MODEL || 'mistralai/mistral-small-3.1-24b-instruct-2503',
//       messages: [
//         {
//           role: 'system',
//           content:
//             'Summarize the chat memory in concise bullet points. Keep stable facts, preferences, long-term goals, unresolved threads, and user constraints. Avoid fluff.',
//         },
//         {
//           role: 'user',
//           content: lines,
//         },
//       ],
//       max_tokens: 260,
//       temperature: 0.2,
//       stream: false,
//     }),
//   });

//   const raw = await res.text();
//   let data = null;
//   try {
//     data = raw ? JSON.parse(raw) : null;
//   } catch (err) {
//     logRecoverable('summarizeWithNvidia.parse', err);
//     data = null;
//   }

//   if (!res.ok || !data || !data.choices || !data.choices[0] || !data.choices[0].message) {
//     throw new Error((data && (data.error || data.message)) || `Summary error ${res.status}`);
//   }

//   return normalizeSpaces(data.choices[0].message.content || '');
// }

// export async function indexMessageForMemory({ userId, conversationId, messageId, role, content }) {
//   const text = normalizeSpaces(content);
//   if (!text || !messageId || !userId || !conversationId) return;
//   if (!['user', 'assistant', 'system'].includes(role)) return;

//   const chunks = splitIntoChunks(text, role);
//   if (!chunks.length) return;

//   await supabaseRest(`memory_chunks?message_id=eq.${messageId}`, { method: 'DELETE' });

//   const records = [];
//   for (const chunkText of chunks) {
//     try {
//       const emb = await fetchEmbedding(chunkText);
//       if (!emb) continue;
//       records.push({
//         user_id: userId,
//         conversation_id: conversationId,
//         message_id: messageId,
//         role,
//         chunk_text: chunkText,
//         embedding: toVectorLiteral(emb),
//       });
//     } catch (err) {
//       logRecoverable('indexMessageForMemory.chunk', err);
//     }
//   }

//   if (records.length) {
//     await supabaseRest('memory_chunks', {
//       method: 'POST',
//       body: records,
//     });
//   }
// }

// export async function maybeCreateSummarySnapshot({ userId, conversationId }) {
//   if (!userId || !conversationId) return;

//   const countRows = await supabaseRest(
//     `messages?select=id&conversation_id=eq.${conversationId}`
//   );
//   const messageCount = Array.isArray(countRows) ? countRows.length : 0;
//   if (messageCount < 10 || messageCount % 10 !== 0) return;

//   const latest = await supabaseRest(
//     `messages?select=id,role,content,created_at&conversation_id=eq.${conversationId}&order=id.desc&limit=24`
//   );
//   if (!latest || latest.length < 14) return;

//   const existing = await supabaseRest(
//     `memory_summaries?select=id,upto_message_id&conversation_id=eq.${conversationId}&order=created_at.desc&limit=1`
//   );
//   const newestId = Number(latest[0].id || 0);
//   if (!newestId) return;
//   if (existing && existing[0] && Number(existing[0].upto_message_id || 0) >= newestId) return;

//   const chron = [...latest].reverse();
//   let summaryText = null;
//   try {
//     summaryText = await summarizeWithNvidia(chron);
//   } catch (err) {
//     logRecoverable('maybeCreateSummarySnapshot.summarize', err);
//     return;
//   }
//   if (!summaryText) return;

//   let summaryEmb = null;
//   try {
//     summaryEmb = await fetchEmbedding(summaryText);
//   } catch (err) {
//     logRecoverable('maybeCreateSummarySnapshot.embed', err);
//     summaryEmb = null;
//   }

//   await supabaseRest('memory_summaries', {
//     method: 'POST',
//     body: [
//       {
//         user_id: userId,
//         conversation_id: conversationId,
//         upto_message_id: newestId,
//         summary_text: summaryText,
//         embedding: summaryEmb ? toVectorLiteral(summaryEmb) : null,
//       },
//     ],
//   });
// }




import { supabaseRest } from './_supabase.js';

function getNvidiaApiKey() {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error('NVIDIA_API_KEY not set');
  return key;
}

function getEmbeddingModel() {
  return process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/llama-3_2-nv-embedqa-1b-v2';
}

function normalizeSpaces(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function getMaxMemoryChunks() {
  const n = Number(process.env.MEMORY_MAX_CHUNKS || 12);
  return Number.isFinite(n) ? Math.max(1, Math.min(Math.floor(n), 32)) : 12;
}

function logRecoverable(scope, err) {
  const msg = err && err.message ? err.message : String(err || 'unknown error');
  console.warn(`[memory] ${scope}: ${msg}`);
}

export function toVectorLiteral(embedding) {
  return `[${embedding.join(',')}]`;
}

export async function fetchEmbedding(text) {
  const input = normalizeSpaces(text);
  if (!input) return null;

  const res = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getNvidiaApiKey()}`,
    },
    body: JSON.stringify({
      model: getEmbeddingModel(),
      input: [input],
      encoding_format: 'float',
    }),
  });

  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (err) {
    logRecoverable('fetchEmbedding.parse', err);
    data = null;
  }

  if (!res.ok || !data || !data.data || !data.data[0] || !Array.isArray(data.data[0].embedding)) {
    throw new Error((data && (data.error || data.message)) || `Embedding error ${res.status}`);
  }

  return data.data[0].embedding;
}

export function splitIntoChunks(text, role = 'user') {
  const chunkSize = role === 'assistant' ? 800 : 400;
  const overlap = role === 'assistant' ? 150 : 80;
  const clean = normalizeSpaces(text);
  if (!clean) return [];

  const out = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + chunkSize, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf('. ', end);
      if (boundary > i + 200) end = boundary + 1;
    }

    const piece = clean.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    i = Math.max(end - overlap, i + 1);
  }

  return out.slice(0, getMaxMemoryChunks());
}

// ---------------------------------------------------------------------------
// Entity extraction
// ---------------------------------------------------------------------------
// Extracts structured named entities from a message so cross-chat retrieval
// can resolve vague references ("exam", "the project", "my trip") back to the
// specific thing the user discussed in a prior conversation.
//
// Entity kinds:
//   exam     – GATE, JEE, UPSC, CAT, IELTS, boards, etc.
//   subject  – Mathematics, Physics, Data Structures, etc.
//   event    – interview, presentation, contest, deadline, etc.
//   person   – names of people mentioned
//   place    – cities, colleges, companies, institutions
//   project  – side projects, work assignments, course projects
//   date_ref – "next Monday", "15 April", "semester 3"
//
// Returns an array like:
//   [{ kind: "exam", value: "GATE", aliases: ["gate", "gate exam", "gate 2025"] }, ...]
// ---------------------------------------------------------------------------

const ENTITY_SYSTEM_PROMPT = `You extract named entities from a chat message for a memory system.
Return ONLY a JSON array. Each element has:
  "kind"    - one of: exam, subject, event, person, place, project, date_ref
  "value"   - canonical name, title-cased, e.g. "GATE", "JEE Mains", "Data Structures"
  "aliases" - array of common short references a user might say later, e.g. ["gate", "gate exam"]

Rules:
- Only extract concrete, specific entities (not generic words like "test" or "study").
- For exams: always include the full name AND common abbreviation as aliases.
- Maximum 6 entities per message.
- If nothing specific is found, return [].
- Return raw JSON only, no markdown, no explanation.`;

export async function extractEntities(text) {
  const clean = normalizeSpaces(text);
  if (!clean || clean.length < 12) return [];

  const apiKey = getNvidiaApiKey();

  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.NVIDIA_ENTITY_MODEL || 'microsoft/phi-4-mini-instruct',
        messages: [
          { role: 'system', content: ENTITY_SYSTEM_PROMPT },
          { role: 'user', content: clean.slice(0, 800) },
        ],
        max_tokens: 256,
        temperature: 0.0,
        stream: false,
      }),
    });

    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }

    const content = (data && data.choices && data.choices[0] && data.choices[0].message)
      ? data.choices[0].message.content : '';

    // Strip markdown code fences if model wrapped output anyway
    const jsonStr = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

    let entities = [];
    try { entities = JSON.parse(jsonStr); } catch { return []; }
    if (!Array.isArray(entities)) return [];

    const VALID_KINDS = new Set(['exam','subject','event','person','place','project','date_ref']);
    return entities
      .filter(e => e && typeof e.value === 'string' && VALID_KINDS.has(e.kind))
      .map(e => ({
        kind: String(e.kind),
        value: String(e.value).trim().slice(0, 80),
        aliases: Array.isArray(e.aliases)
          ? e.aliases.map(a => String(a).toLowerCase().trim()).filter(Boolean).slice(0, 8)
          : [],
      }))
      .slice(0, 6);
  } catch (err) {
    logRecoverable('extractEntities', err);
    return [];
  }
}

// Persist extracted entities into the entity_tags table.
export async function indexEntitiesForMessage({ userId, conversationId, messageId, entities }) {
  if (!entities || !entities.length) return;
  if (!userId || !conversationId || !messageId) return;

  // Delete stale tags for this message first (makes re-indexing idempotent).
  try {
    await supabaseRest(`entity_tags?message_id=eq.${messageId}`, { method: 'DELETE' });
  } catch (err) {
    logRecoverable('indexEntitiesForMessage.delete', err);
  }

  const records = entities.map(e => ({
    user_id: userId,
    conversation_id: conversationId,
    message_id: messageId,
    kind: e.kind,
    value: e.value,
    aliases: e.aliases,
  }));

  try {
    await supabaseRest('entity_tags', { method: 'POST', body: records });
  } catch (err) {
    logRecoverable('indexEntitiesForMessage.insert', err);
  }
}

// ---------------------------------------------------------------------------

async function summarizeWithNvidia(conversationMessages) {
  const apiKey = getNvidiaApiKey();
  const lines = (conversationMessages || [])
    .map((m) => `${m.role}: ${normalizeSpaces(m.content)}`)
    .slice(0, 28)
    .join('\n');

  if (!lines) return null;

  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.NVIDIA_SUMMARY_MODEL || 'mistralai/mistral-small-3.1-24b-instruct-2503',
      messages: [
        {
          role: 'system',
          content:
            'Summarize the chat memory in concise bullet points. Keep stable facts, preferences, long-term goals, unresolved threads, and user constraints. Avoid fluff.',
        },
        {
          role: 'user',
          content: lines,
        },
      ],
      max_tokens: 260,
      temperature: 0.2,
      stream: false,
    }),
  });

  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (err) {
    logRecoverable('summarizeWithNvidia.parse', err);
    data = null;
  }

  if (!res.ok || !data || !data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error((data && (data.error || data.message)) || `Summary error ${res.status}`);
  }

  return normalizeSpaces(data.choices[0].message.content || '');
}

export async function indexMessageForMemory({ userId, conversationId, messageId, role, content }) {
  const text = normalizeSpaces(content);
  if (!text || !messageId || !userId || !conversationId) return;
  if (!['user', 'assistant', 'system'].includes(role)) return;

  const chunks = splitIntoChunks(text, role);
  if (!chunks.length) return;

  await supabaseRest(`memory_chunks?message_id=eq.${messageId}`, { method: 'DELETE' });

  const records = [];
  for (const chunkText of chunks) {
    try {
      const emb = await fetchEmbedding(chunkText);
      if (!emb) continue;
      records.push({
        user_id: userId,
        conversation_id: conversationId,
        message_id: messageId,
        role,
        chunk_text: chunkText,
        embedding: toVectorLiteral(emb),
      });
    } catch (err) {
      logRecoverable('indexMessageForMemory.chunk', err);
    }
  }

  if (records.length) {
    await supabaseRest('memory_chunks', {
      method: 'POST',
      body: records,
    });
  }

  // Entity extraction: only on user messages (they introduce named entities;
  // assistant messages mostly echo them back).
  if (role === 'user') {
    try {
      const entities = await extractEntities(text);
      await indexEntitiesForMessage({ userId, conversationId, messageId, entities });
    } catch (err) {
      logRecoverable('indexMessageForMemory.entities', err);
    }
  }
}

export async function maybeCreateSummarySnapshot({ userId, conversationId }) {
  if (!userId || !conversationId) return;

  const countRows = await supabaseRest(
    `messages?select=id&conversation_id=eq.${conversationId}`
  );
  const messageCount = Array.isArray(countRows) ? countRows.length : 0;
  if (messageCount < 10 || messageCount % 10 !== 0) return;

  const latest = await supabaseRest(
    `messages?select=id,role,content,created_at&conversation_id=eq.${conversationId}&order=id.desc&limit=24`
  );
  if (!latest || latest.length < 14) return;

  const existing = await supabaseRest(
    `memory_summaries?select=id,upto_message_id&conversation_id=eq.${conversationId}&order=created_at.desc&limit=1`
  );
  const newestId = Number(latest[0].id || 0);
  if (!newestId) return;
  if (existing && existing[0] && Number(existing[0].upto_message_id || 0) >= newestId) return;

  const chron = [...latest].reverse();
  let summaryText = null;
  try {
    summaryText = await summarizeWithNvidia(chron);
  } catch (err) {
    logRecoverable('maybeCreateSummarySnapshot.summarize', err);
    return;
  }
  if (!summaryText) return;

  let summaryEmb = null;
  try {
    summaryEmb = await fetchEmbedding(summaryText);
  } catch (err) {
    logRecoverable('maybeCreateSummarySnapshot.embed', err);
    summaryEmb = null;
  }

  await supabaseRest('memory_summaries', {
    method: 'POST',
    body: [
      {
        user_id: userId,
        conversation_id: conversationId,
        upto_message_id: newestId,
        summary_text: summaryText,
        embedding: summaryEmb ? toVectorLiteral(summaryEmb) : null,
      },
    ],
  });
}