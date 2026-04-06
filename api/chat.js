// Vercel Serverless Function — /api/chat
// Routes to NVIDIA or GitHub Models based on the selected model id.
const GITHUB_MODEL_IDS = [
  'openai/gpt-5',
  'openai/gpt-4o',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-4o-mini',
  'openai/gpt-5-chat',
  'openai/gpt-5-mini',
  'openai/gpt-5-nano',
  'openai/gpt-4.1-nano',
  'openai/o1-mini',
  'openai/o3-mini',
  'openai/o1',
  'openai/o3',
  'deepseek-ai/deepseek-v3-0324',
  'deepseek-ai/deepseek-r1',
  'xai/grok-3',
  'xai/grok-3-mini',
  'microsoft/phi-4-reasoning',
  'microsoft/phi-4',
  'microsoft/mai-ds-r1',
  'microsoft/phi-4-mini-instruct',
  'microsoft/phi-4-mini-reasoning',
  'microsoft/phi-4-multimodal-instruct',
  'cohere/command-r-08-2024',
  'cohere/command-a',
  'ai21/jamba-1.5-large',
  'meta/llama-4-maverick-17b-128e-instruct-fp8',
  'meta/llama-3.2-90b-vision-instruct',
  'meta/llama-3.1-405b-instruct',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.2-11b-vision-instruct',
  'mistralai/mistral-medium-3-25.05',
  'mistralai/ministral-3b',
];

function usesGitHubModels(modelId) {
  const id = String(modelId || '').toLowerCase();
  return GITHUB_MODEL_IDS.includes(id);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const modelId = String(payload && payload.model || '').trim();
    const useGitHubModels = usesGitHubModels(modelId);
    const endpoint = useGitHubModels
      ? 'https://models.github.ai/inference/chat/completions?api-version=2024-12-01-preview'
      : 'https://integrate.api.nvidia.com/v1/chat/completions';
    const apiKey = useGitHubModels
      ? process.env.GITHUB_API_MODEL_KEY
      : process.env.NVIDIA_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: useGitHubModels
          ? 'GITHUB_API_MODEL_KEY not set in environment variables'
          : 'NVIDIA_API_KEY not set in environment variables',
      });
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    };
    if (useGitHubModels) {
      headers['X-GitHub-Api-Version'] = '2022-11-28';
      headers['Accept'] = payload && payload.stream === true ? 'text/event-stream' : 'application/json';
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (payload && payload.stream === true) {
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
