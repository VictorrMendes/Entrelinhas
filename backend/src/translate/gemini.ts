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

/**
 * Free-tier quotas are counted per model (15 requests a minute on flash-lite) and single calls sometimes queue for 5-10 s.
 * Asks the first model; when it fails (e.g. 429) or hasn't answered after [hedgeMs], asks the next one as well, and keeps
 * the first answer. Fails only when every model failed.
 */
export function modelPool(models: Model[], hedgeMs = 1500): Model {
  return (...args) =>
    new Promise((resolve, reject) => {
      let started = 0;
      let failed = 0;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const next = () => {
        clearTimeout(timer);
        const model = models[started++];
        if (settled || !model) return;
        if (started < models.length) timer = setTimeout(next, hedgeMs);
        // ponytail: the slower call isn't aborted; its answer is dropped and only costs its own model's quota
        model(...args).then(
          (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
          },
          (error) => {
            if (settled) return;
            if (++failed === models.length) {
              settled = true;
              reject(error);
            } else if (started < models.length) next();
          },
        );
      };
      next();
    });
}
