import { ApiError } from '../errors.ts';
import type { Model } from './gemini.ts';

const PER_MINUTE = 40;

/**
 * Models hosted by NVIDIA (OpenAI-compatible API). The free tier allows 40 requests a minute; past that a call fails at once.
 * Measured: nemotron-3-super answers a word in 0.7-1.2 s with reasoning off (Gemini's free tier swings from 0.7 to 11 s)
 * but misses a few senses Gemini gets, so it backs Gemini up instead of replacing it. Reasoning models (kimi-k3,
 * deepseek-v4.1-flash) took 45 s to over 120 s.
 */
export function createNvidia(apiKey: string | undefined, model: string): Model | null {
  if (!apiKey) return null;
  let recent: number[] = [];
  return async (system, text, schema) => {
    const now = Date.now();
    recent = recent.filter((t) => t > now - 60_000);
    if (recent.length >= PER_MINUTE) throw new ApiError(429, 'RATE_LIMIT', 'Model rate limit, try again shortly');
    recent.push(now);
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 6000,
        // without this switch nemotron reasons first and spends seconds (or the whole token budget) before answering
        ...(model.startsWith('nvidia/') && { chat_template_kwargs: { enable_thinking: false } }),
        // JSON mode only returns objects, so a batch comes wrapped in {"items": [...]} and is unwrapped below
        ...(schema && { response_format: { type: 'json_object' } }),
        messages: [
          { role: 'system', content: schema ? `${system} Answer with JSON only: {"items": <that array>}.` : system },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new ApiError(res.status === 429 ? 429 : 502, 'TRANSLATION_FAILED', `Model error ${res.status}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const out = json.choices?.[0]?.message?.content?.trim();
    if (!out) throw new ApiError(502, 'TRANSLATION_FAILED', 'Empty model response');
    const u = json.usage ?? {};
    const answer = schema ? JSON.stringify((JSON.parse(out) as { items?: unknown }).items ?? []) : out;
    return {
      text: answer,
      usage: { tokens: { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, total: u.total_tokens ?? 0 } },
    };
  };
}

/** Asks each configured model in turn until one answers: the next one covers a missing key, a rate limit or an outage. */
export const withFallback =
  (...models: (Model | null)[]): Model =>
  async (...args) => {
    const [first, ...rest] = models.filter((m): m is Model => m !== null);
    if (!first) throw new ApiError(500, 'SERVER_MISCONFIGURED', 'No model is configured');
    if (!rest.length) return first(...args);
    try {
      return await first(...args);
    } catch {
      return withFallback(...rest)(...args);
    }
  };
