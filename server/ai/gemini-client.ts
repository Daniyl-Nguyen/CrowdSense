import { GoogleAuth } from 'google-auth-library';
import { config } from '../config.ts';

const auth = new GoogleAuth({
  keyFilename: config.googleCredentials,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

export function geminiConfigured(): boolean {
  if (config.geminiBackend === 'vertex') return !!config.vertexProject;
  return config.geminiBackend === 'developer' && !!config.geminiKey;
}

// Explicit routing prevents a Cloud credential failure from charging AI Studio.
export async function geminiGenerate(model: string, body: unknown, timeoutMs: number): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url: string;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.geminiBackend === 'vertex') {
    if (!config.vertexProject) throw new Error('Google Cloud project is not configured.');
    const location = config.vertexLocation;
    if (!/^[a-z0-9-]+$/.test(location)) throw new Error('Invalid Google Cloud location.');
    const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
    url = `https://${host}/v1/projects/${encodeURIComponent(config.vertexProject)}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    try {
      const token = await auth.getAccessToken();
      if (!token) throw new Error('No token');
      headers.authorization = `Bearer ${token}`;
    } catch {
      throw new Error('Google Cloud authentication failed. Check the server credential and Vertex AI permissions.');
    }
  } else if (config.geminiBackend === 'developer') {
    if (!config.geminiKey) throw new Error('Gemini API key is not configured.');
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers['x-goog-api-key'] = config.geminiKey;
  } else {
    throw new Error('Invalid GEMINI_BACKEND. Choose developer or vertex.');
  }
  return fetch(url, { method: 'POST', headers, signal, body: JSON.stringify(body) });
}
