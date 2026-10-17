import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createNvidia } from '../src/translate/nvidia.ts';
import { batchSchema } from '../src/translate/prompts.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replies with [content] and keeps the request body the client sent. */
function fakeNvidia(content: string) {
  const sent: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 3 } }));
  }) as typeof fetch;
  return sent;
}

test('nemotron answers without reasoning, so a word comes back in about a second', async () => {
  const sent = fakeNvidia(' margem ');
  const model = createNvidia('key', 'nvidia/nemotron-3-super-120b-a12b');
  assert.equal((await model?.('system', 'bank'))?.text, 'margem');
  assert.deepEqual(sent[0]?.chat_template_kwargs, { enable_thinking: false });
  assert.equal(sent[0]?.response_format, undefined);
});

test('a batch asks for a JSON object and hands back the plain array the routes expect, like Gemini does', async () => {
  const sent = fakeNvidia('{"items":[{"blockId":"0","translatedText":"olá"}]}');
  const model = createNvidia('key', 'nvidia/nemotron-3-super-120b-a12b');
  const r = await model?.('system', '[]', batchSchema);
  assert.deepEqual(JSON.parse(r?.text ?? ''), [{ blockId: '0', translatedText: 'olá' }]);
  assert.deepEqual(sent[0]?.response_format, { type: 'json_object' });
});

test('models outside nvidia/ get no reasoning switch they might reject', async () => {
  const sent = fakeNvidia('ok');
  await createNvidia('key', 'moonshotai/kimi-k3')?.('system', 'text');
  assert.equal(sent[0]?.chat_template_kwargs, undefined);
});
