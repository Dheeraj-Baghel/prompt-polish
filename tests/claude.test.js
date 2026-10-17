import test from 'node:test';
import assert from 'node:assert/strict';
import { API_BASE, compareWithClaude, listModels, rewriteWithClaude, safeApiError, sendMessage, validateKey, validateModel } from '../extension/lib/claude.js';
const apiKey = 'sk-ant-not-a-real-key-for-tests';
const model = 'claude-haiku-4-5-20251001';
const reply = (text = 'An answer', extra = {}) => ({ content: [{ type: 'text', text }], model, stop_reason: 'end_turn', usage: { input_tokens: 25, output_tokens: 35 }, ...extra });
const mock = (data = reply(), status = 200) => async () => new Response(JSON.stringify(data), { status });

test('keys and models reject malformed data and arbitrary endpoints', () => {
  for (const key of ['', 'password', 'sk-ant-ab\n12', 'sk-ant-' + 'x'.repeat(501)]) assert.throws(() => validateKey(key));
  assert.equal(validateKey(apiKey), apiKey);
  assert.throws(() => validateModel('https://attacker.test'));
});
test('message request uses pinned API origin, headers, no credentials, and bounded output', async () => {
  let captured;
  const result = await sendMessage({ apiKey, model, prompt: 'Hello', fetchImpl: async (url, init) => { captured = { url, init }; return new Response(JSON.stringify(reply())); } });
  assert.equal(captured.url, API_BASE + '/messages');
  assert.equal(captured.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(captured.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(captured.init.credentials, 'omit'); assert.equal(captured.init.redirect, 'error');
  assert.equal(JSON.parse(captured.init.body).max_tokens, 800);
  assert.equal(result.text, 'An answer'); assert.equal(result.usage.output, 35);
});
test('multiple text blocks are joined and non-text blocks ignored', async () => {
  const result = await sendMessage({ apiKey, prompt: 'Hi', fetchImpl: mock(reply('', { content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'one' }, { type: 'text', text: 'two' }] })) });
  assert.equal(result.text, 'one\n\ntwo');
});
test('missing text and malformed JSON fail clearly', async () => {
  await assert.rejects(sendMessage({ apiKey, prompt: 'Hi', fetchImpl: mock({}) }), /no text/);
  await assert.rejects(sendMessage({ apiKey, prompt: 'Hi', fetchImpl: async () => new Response('bad JSON') }), /Could not reach/);
});
test('HTTP errors never echo provider responses or credentials', async () => {
  for (const status of [400, 401, 403, 404, 429, 500, 529]) {
    await assert.rejects(sendMessage({ apiKey, prompt: 'Hi', fetchImpl: mock({ error: { message: apiKey } }, status) }), (error) => error.message === safeApiError(status) && !error.message.includes(apiKey));
  }
});
test('network errors and cancellation are actionable with no automatic retries', async () => {
  let calls = 0;
  await assert.rejects(sendMessage({ apiKey, prompt: 'Hi', fetchImpl: async () => { calls++; throw new TypeError('Failed to fetch'); } }), /connection/);
  assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(sendMessage({ apiKey, prompt: 'Hi', signal: controller.signal, fetchImpl: async () => { throw new DOMException('Aborted', 'AbortError'); } }), /canceled/);
});
test('AI rewrite returns prompt only, with no hidden answering step', async () => {
  let body;
  const result = await rewriteWithClaude('write email', {}, { apiKey, model, fetchImpl: async (_, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify(reply('Write a clear email.'))); } });
  assert.equal(result.engine, 'claude'); assert.equal(result.text, 'Write a clear email.');
  assert.equal(body.messages.length, 1); assert.match(body.system, /prompt editor/);
  assert.equal(JSON.parse(body.messages[0].content).original_prompt, 'write email');
});
test('truncated rewrites are not applied', async () => {
  await assert.rejects(rewriteWithClaude('write email', {}, { apiKey, fetchImpl: mock(reply('partial', { stop_reason: 'max_tokens' })) }), /incomplete rewrite was not applied/);
});
test('comparison makes exactly two independent requests with same model/system/budget', async () => {
  const bodies = [];
  const result = await compareWithClaude('original', 'improved', { apiKey, model, fetchImpl: async (_, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify(reply())); } });
  assert.equal(bodies.length, 2); assert.deepEqual(bodies.map((body) => body.messages[0].content), ['original', 'improved']);
  assert.equal(bodies[0].model, bodies[1].model); assert.equal(bodies[0].system, bodies[1].system);
  assert.equal(bodies[0].max_tokens, bodies[1].max_tokens); assert.equal(bodies[0].messages.length, 1);
  assert.equal(result.original.text, 'An answer'); assert.equal(result.improved.text, 'An answer');
});
test('partial comparison retains the successful answer and marks output limits', async () => {
  let count = 0;
  const result = await compareWithClaude('original', 'improved', { apiKey, model, fetchImpl: async () => ++count === 1 ? new Response('{}', { status: 429 }) : new Response(JSON.stringify(reply('partial', { stop_reason: 'max_tokens' }))) });
  assert.match(result.original.error, /rate-limiting/); assert.equal(result.improved.text, 'partial'); assert.equal(result.improved.truncated, true);
});
test('two failed requests are reported, not fabricated answers', async () => {
  const result = await compareWithClaude('original', 'improved', { apiKey, fetchImpl: mock({}, 401) });
  assert.match(result.original.error, /key/); assert.match(result.improved.error, /key/);
});
test('connection check lists models without any generation request', async () => {
  let url;
  const result = await listModels({ apiKey, fetchImpl: async (target) => { url = target; return new Response(JSON.stringify({ data: [{ id: model, display_name: 'Haiku' }, { id: 'other' }] })); } });
  assert.ok(url.endsWith('/models?limit=100')); assert.deepEqual(result, [{ id: model, name: 'Haiku' }]);
});
test('expanded output can exceed 12k characters, but original and output limits are enforced separately', async () => {
  const result = await compareWithClaude('a'.repeat(12000), 'a'.repeat(13500), { apiKey, fetchImpl: mock() });
  assert.equal(result.improved.text, 'An answer');
  await assert.rejects(compareWithClaude('a'.repeat(12001), 'ok', { apiKey, fetchImpl: mock() }), /12,000/);
  await assert.rejects(compareWithClaude('ok', 'a'.repeat(24001), { apiKey, fetchImpl: mock() }), /24,000/);
});