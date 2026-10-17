import test from 'node:test';
import assert from 'node:assert/strict';
import { CHROME_AI_OPTIONS, chromeAiAvailability, rewriteWithChrome } from '../extension/lib/chrome-ai.js';

const original = 'plz explain how this works';
const rewritten = 'Explain how this works, describing its purpose, the main steps involved, and a concrete example.';
function fixture({ text = rewritten, fail, overflow = false } = {}) {
  const observed = { destroyed: 0 };
  const session = new EventTarget();
  session.prompt = async (input, options) => {
    observed.prompt = input; observed.promptOptions = options;
    if (overflow) session.dispatchEvent(new Event('contextoverflow'));
    if (fail) throw fail;
    return text;
  };
  session.destroy = () => { observed.destroyed++; };
  const api = {
    availability: async (options) => { observed.availability = options; return 'available'; },
    create: async (options) => { observed.create = options; return session; },
  };
  return { api, observed };
}

test('missing, unsupported and failing native API report unavailable without creating anything', async () => {
  assert.equal(await chromeAiAvailability(null), 'unavailable');
  assert.equal(await chromeAiAvailability({ availability: async () => { throw new Error('blocked'); }, create() {} }), 'unavailable');
  await assert.rejects(rewriteWithChrome(original, {}, { api: null }), /No template/);
});
test('availability and create use the same language/type expectations', async () => {
  const { api, observed } = fixture();
  assert.equal(await chromeAiAvailability(api), 'available');
  await rewriteWithChrome(original, {}, { api, availability: 'available' });
  assert.deepEqual(observed.availability, CHROME_AI_OPTIONS);
  assert.deepEqual(observed.create.expectedInputs, observed.availability.expectedInputs);
  assert.deepEqual(observed.create.expectedOutputs, observed.availability.expectedOutputs);
});
test('download starts only in explicitly requested rewrite and reports real progress events', async () => {
  const { api, observed } = fixture();
  const create = api.create;
  api.create = (options) => {
    const monitor = new EventTarget(); options.monitor(monitor);
    const event = new Event('downloadprogress'); Object.defineProperty(event, 'loaded', { value: .6 }); monitor.dispatchEvent(event);
    return create(options);
  };
  let progress;
  await rewriteWithChrome(original, {}, { api, availability: 'downloadable', onProgress: (value) => { progress = value; } });
  assert.equal(progress, 60); assert.equal(observed.destroyed, 1);
});
test('a real request uses the shared rewrite instruction and returns model text, not a local template', async () => {
  const { api, observed } = fixture();
  const result = await rewriteWithChrome(original, { tone: 'formal' }, { api, availability: 'available' });
  assert.match(observed.create.initialPrompts[0].content, /grammatically correct English/);
  assert.equal(JSON.parse(observed.prompt).original_prompt, original);
  assert.equal(JSON.parse(observed.prompt).preferences.tone, 'formal');
  assert.equal(result.text, rewritten); assert.equal(result.engine, 'chrome-ai');
  assert.equal(observed.destroyed, 1);
});
test('unchanged output is rejected and its session is destroyed', async () => {
  const { api, observed } = fixture({ text: original });
  await assert.rejects(rewriteWithChrome(original, {}, { api, availability: 'available' }), /unchanged/);
  assert.equal(observed.destroyed, 1);
});
test('context overflow never silently drops input and returns a supposed enhancement', async () => {
  const { api, observed } = fixture({ overflow: true });
  await assert.rejects(rewriteWithChrome(original, {}, { api, availability: 'available' }), /context capacity/);
  assert.equal(observed.destroyed, 1);
});
test('cancel propagates to native create and destroys any obtained session', async () => {
  const { api, observed } = fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(rewriteWithChrome(original, {}, { api, availability: 'available', signal: controller.signal }), /canceled/);
  assert.equal(observed.create.signal.aborted, true); assert.equal(observed.destroyed, 1);
});
test('capacity and permission failures are actionable, not replaced with canned text', async () => {
  for (const [name, pattern] of [['QuotaExceededError', /capacity/], ['NotAllowedError', /click/], ['NotSupportedError', /not available/]]) {
    const { api, observed } = fixture({ fail: new DOMException('Native failure', name) });
    await assert.rejects(rewriteWithChrome(original, {}, { api, availability: 'available' }), pattern);
    assert.equal(observed.destroyed, 1);
  }
});
