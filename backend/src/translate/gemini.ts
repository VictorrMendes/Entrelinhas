import { ApiError } from '../errors.ts';

export interface ModelResult {
  text: string;
  usage: { tokens: { input: number; output: number; total: number } };
}

export type Model = (system: string, text: string, schema?: object) => Promise<ModelResult>;

export function createGemini(apiKey: string | undefined, model: string): Model {
  return async (system, text, schema) => {
    if (!apiKey) throw new ApiError(500, 'SERVER_MISCONFIGURED', 'GEMINI_API_KEY is not set');
    const request = () =>
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: { temperature: 0.2, ...(schema && { responseMimeType: 'application/json', responseSchema: schema }) },
        }),
        signal: AbortSignal.timeout(40_000),
      });
    let res = await request();
    if (res.status >= 500) res = await request(); // Gemini returns transient 503s under load
    if (!res.ok) {
      if (res.status === 429) throw new ApiError(429, 'RATE_LIMIT', 'Model rate limit, try again shortly');
      if (res.status === 401 || res.status === 403) throw new ApiError(502, 'GEMINI_UNAUTHORIZED', 'Model authentication failed');
      throw new ApiError(502, 'TRANSLATION_FAILED', `Model error ${res.status}`);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    };
    const out = json.candidates?.[0]?.content?.parts
      ?.filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('');
    if (!out) throw new ApiError(502, 'TRANSLATION_FAILED', 'Empty model response');
    const u = json.usageMetadata ?? {};
    return {
      text: out,
      usage: { tokens: { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, total: u.totalTokenCount ?? 0 } },
    };
  };
}
