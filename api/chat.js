// Vercel Serverless Function — /api/chat
// Yeh NVIDIA_API_KEY env variable se lega, browser ko expose nahi hogi
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'NVIDIA_API_KEY not set in environment variables' });
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(payload),
    });

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
