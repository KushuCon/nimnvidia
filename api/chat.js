// // Vercel Serverless Function — /api/chat
// // Routes chat requests to the right upstream provider by model id.
// const GITHUB_CHAT_MODEL_IDS = new Set([
//   'xai/grok-3-mini',
//   'openai/gpt-5',
//   'openai/gpt-4.1',
//   'openai/gpt-4.1-mini',
//   'openai/gpt-4.1-nano',
//   'openai/gpt-4o',
//   'openai/gpt-4o-mini',
//   'openai/o3',
//   'openai/o3-mini',
//   'openai/o4-mini',
//   'deepseek/deepseek-v3-0324',
//   'deepseek/deepseek-r1',
//   'deepseek/deepseek-r1-0528',
//   'meta/meta-llama-3.1-8b-instruct',
//   'meta/meta-llama-3.1-405b-instruct',
//   'meta/llama-3.2-11b-vision-instruct',
//   'meta/llama-3.2-90b-vision-instruct',
//   'meta/llama-3.3-70b-instruct',
//   'microsoft/mai-ds-r1',
//   'microsoft/phi-4',
//   'microsoft/phi-4-mini-instruct',
//   'microsoft/phi-4-mini-reasoning',
//   'microsoft/phi-4-reasoning',
//   'cohere/cohere-command-r-08-2024',
//   'cohere/cohere-command-r-plus-08-2024',
//   'cohere/cohere-command-a',
//   'mistral-ai/codestral-2501',
//   'mistral-ai/ministral-3b',
//   'xai/grok-3',
//   'ai21/jamba-1.5-large'
// ]);

// export default async function handler(req, res) {
//   if (req.method !== 'POST') {
//     return res.status(405).json({ error: 'Method not allowed' });
//   }

//   try {
//     const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
//     const modelId = String((payload && payload.model) || '');
//     const modelKey = modelId.toLowerCase();
//     const useGithubModels = GITHUB_CHAT_MODEL_IDS.has(modelKey);

//     const endpoint = useGithubModels
//       ? (process.env.GITHUB_API_ENDPOINT || 'https://models.github.ai/inference').replace(/\/$/, '') + '/chat/completions'
//       : 'https://integrate.api.nvidia.com/v1/chat/completions';

//     const apiKey = useGithubModels
//       ? process.env.GITHUB_API_MODEL_KEY
//       : process.env.NVIDIA_API_KEY;

//     if (!apiKey) {
//       return res.status(500).json({
//         error: useGithubModels
//           ? 'GITHUB_API_MODEL_KEY not set in environment variables'
//           : 'NVIDIA_API_KEY not set in environment variables',
//       });
//     }

//     const response = await fetch(endpoint, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         'Authorization': 'Bearer ' + apiKey,
//       },
//       body: JSON.stringify(payload),
//     });

//     if (payload && payload.stream === true) {
//       if (!response.ok) {
//         const rawErr = await response.text();
//         let dataErr = null;
//         try {
//           dataErr = rawErr ? JSON.parse(rawErr) : null;
//         } catch {
//           dataErr = null;
//         }
//         return res.status(response.status).json(
//           dataErr || {
//             error: 'Streaming upstream error',
//             status: response.status,
//             body: String(rawErr || '').slice(0, 1200),
//           }
//         );
//       }

//       res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
//       res.setHeader('Cache-Control', 'no-cache, no-transform');
//       res.setHeader('Connection', 'keep-alive');

//       if (!response.body || !response.body.getReader) {
//         res.write('data: [DONE]\n\n');
//         return res.end();
//       }

//       const reader = response.body.getReader();
//       while (true) {
//         const { done, value } = await reader.read();
//         if (done) break;
//         res.write(Buffer.from(value));
//       }
//       return res.end();
//     }

//     const raw = await response.text();
//     try {
//       const data = JSON.parse(raw);
//       return res.status(response.status).json(data);
//     } catch (_) {
//       return res.status(response.status).json({
//         error: 'Upstream returned non-JSON response',
//         status: response.status,
//         body: raw.slice(0, 1200),
//       });
//     }
//   } catch (err) {
//     return res.status(500).json({ error: 'Proxy error: ' + err.message });
//   }
// }


// Vercel Serverless Function — /api/chat
// Routes chat requests to the right upstream provider by model id.
const GITHUB_CHAT_MODEL_IDS = new Set([
  'xai/grok-3-mini',
  'xai/grok-3',
  'openai/gpt-5',
  'openai/gpt-5.4',
  'openai/gpt-5.4-mini',
  'openai/gpt-5.4-nano',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1-nano',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/o3',
  'openai/o3-mini',
  'openai/o4-mini',
  'deepseek/deepseek-v3-0324',
  'deepseek/deepseek-r1',
  'deepseek/deepseek-r1-0528',
  'meta/meta-llama-3.1-8b-instruct',
  'meta/meta-llama-3.1-405b-instruct',
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-90b-vision-instruct',
  'meta/llama-3.3-70b-instruct',
  'microsoft/mai-ds-r1',
  'microsoft/phi-4',
  'microsoft/phi-4-mini-instruct',
  'microsoft/phi-4-mini-reasoning',
  'microsoft/phi-4-reasoning',
  'cohere/cohere-command-r-08-2024',
  'cohere/cohere-command-r-plus-08-2024',
  'cohere/cohere-command-a',
  'mistral-ai/codestral-2501',
  'mistral-ai/ministral-3b',
  'ai21/jamba-1.5-large'
]);

// OpenAI reasoning/GPT-5 models require max_completion_tokens instead of max_tokens.
// Sending max_tokens to these models causes a 400 error.
const OPENAI_COMPLETION_TOKENS_MODELS = new Set([
  'openai/o3',
  'openai/o3-mini',
  'openai/o4-mini',
  'openai/gpt-5',
  'openai/gpt-5.4',
  'openai/gpt-5.4-mini',
  'openai/gpt-5.4-nano',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const modelId = String((payload && payload.model) || '');
    const modelKey = modelId.toLowerCase();
    const useGithubModels = GITHUB_CHAT_MODEL_IDS.has(modelKey);

    const endpoint = useGithubModels
      ? (process.env.GITHUB_API_ENDPOINT || 'https://models.github.ai/inference').replace(/\/$/, '') + '/chat/completions'
      : 'https://integrate.api.nvidia.com/v1/chat/completions';

    const apiKey = useGithubModels
      ? process.env.GITHUB_API_MODEL_KEY
      : process.env.NVIDIA_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: useGithubModels
          ? 'GITHUB_API_MODEL_KEY not set in environment variables'
          : 'NVIDIA_API_KEY not set in environment variables',
      });
    }

    // Rewrite max_tokens -> max_completion_tokens for OpenAI models that require it.
    let outPayload = payload;
    if (OPENAI_COMPLETION_TOKENS_MODELS.has(modelKey) && outPayload && outPayload.max_tokens != null) {
      const { max_tokens, ...rest } = outPayload;
      outPayload = { ...rest, max_completion_tokens: max_tokens };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(outPayload),
    });

    if (outPayload && outPayload.stream === true) {
      if (!response.ok) {
        const rawErr = await response.text();
        let dataErr = null;
        try {
          dataErr = rawErr ? JSON.parse(rawErr) : null;
        } catch {
          dataErr = null;
        }
        return res.status(response.status).json(
          dataErr || {
            error: 'Streaming upstream error',
            status: response.status,
            body: String(rawErr || '').slice(0, 1200),
          }
        );
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

      if (!response.body || !response.body.getReader) {
        res.write('data: [DONE]\n\n');
        return res.end();
      }

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    }

    const raw = await response.text();
    try {
      const data = JSON.parse(raw);
      return res.status(response.status).json(data);
    } catch (_) {
      return res.status(response.status).json({
        error: 'Upstream returned non-JSON response',
        status: response.status,
        body: raw.slice(0, 1200),
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Proxy error: ' + err.message });
  }
}