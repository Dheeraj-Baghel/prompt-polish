import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Run the real unpacked MV3 extension and real service worker/storage.
// Model generation (Chrome AI and Anthropic), native permission dialogs and OS clipboard are mocked.
// These verify integration and failure handling, NOT real model rewrite quality.
// No real credentials, provider traffic, or billable calls are used.
const extensionPath = path.resolve('extension');
const context = await chromium.launchPersistentContext('', {
  executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),
  headless: true, viewport: { width: 1440, height: 1100 },
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
const checks = [];
const errors = [];
const network = [];
const record = (name) => { checks.push(name); console.log('PASS', name); };
await mkdir('artifacts/screenshots', { recursive: true });
context.on('request', (request) => { if (/^https?:/.test(request.url())) network.push(request.url()); });
context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
let worker;
try {
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const base = `chrome-extension://${extensionId}`;
  const page = await context.newPage();
  await page.goto(base + '/panel.html');
  await page.locator('#provider-status').filter({ hasText: 'Comparison requires' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#engine-note').textContent.startsWith('Checking'));
  const nativeCapability = await page.evaluate(async () => {
    const { chromeAiAvailability } = await import('./lib/chrome-ai.js');
    return { api: typeof globalThis.LanguageModel, availability: await chromeAiAvailability() };
  });
  await writeFile('artifacts/native-chrome-ai-capability.json', JSON.stringify(nativeCapability, null, 2) + '\n');
  console.log('REAL NATIVE CAPABILITY', nativeCapability);
  assert.equal(await page.title(), 'Prompt Polish — A little clarity goes a long way');
  record('Real unpacked MV3 extension and module service worker load');
  await page.screenshot({ path: 'artifacts/screenshots/real-capability-1440.png', fullPage: true });
  if (nativeCapability.availability === 'unavailable') {
    assert.match(await page.locator('#engine-note').textContent(), /no generic template/);
    assert.equal(await page.locator('#result-area').isVisible(), false);
    record('Real unsupported browser reports unavailable instead of fabricating a rewrite');
  }

  await page.evaluate(() => chrome.storage.session.set({ workspace: {
    original: 'My unsaved original prompt', preferences: {}, engine: 'local',
    result: { text: 'Task\nMy unsaved original prompt\n\nApproach\nBoilerplate', engine: 'local', changes: [] },
  } }));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#original').value === 'My unsaved original prompt');
  assert.equal(await page.locator('#result-area').isVisible(), false);
  record('Upgrade preserves original text but does not restore the defective wrapper output');

  // Test-only native model fixture. This never ships in extension/.
  await page.addInitScript(() => {
    globalThis.__localCalls = [];
    globalThis.__localState = sessionStorage.getItem('test-native-state') || 'available';
    globalThis.__localMode = 'success';
    globalThis.__destroyed = 0;
    Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: {
      availability: async () => globalThis.__localState,
      create: async (options) => {
        globalThis.__localCalls.push({ options });
        if (globalThis.__localState === 'downloadable') {
          const monitor = new EventTarget(); options.monitor(monitor);
          const event = new Event('downloadprogress'); Object.defineProperty(event, 'loaded', { value: .5 });
          monitor.dispatchEvent(event);
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        const session = new EventTarget();
        session.prompt = async (user, { signal }) => {
          const payload = JSON.parse(user); globalThis.__localCalls.at(-1).payload = payload;
          if (globalThis.__localMode === 'wait') return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
          if (globalThis.__localMode === 'unchanged') return payload.original_prompt;
          if (/mechanil/.test(payload.original_prompt)) return 'I will provide images of mechanical components. For each component, identify its standard engineering name, explain its function and typical applications, and point out the visible features that support the identification. If the image is unclear or several components look similar, explain the uncertainty and ask for a clearer view rather than guessing. Use clear, professional English.';
          if (/recursion/.test(payload.original_prompt)) return 'Describe recursion using a simple example. Explain the recursive step and the base case, and show how each step brings the process closer to stopping.';
          if (/different email/.test(payload.original_prompt)) return 'Draft a different email using the details I provide, with a clear purpose and appropriate closing.';
          return `Draft a friendly email to My project manager requesting an extension to Friday. Explain that the design review took two extra days, acknowledge the impact, and keep the message accountable rather than defensive.`;
        };
        session.destroy = () => { globalThis.__destroyed++; };
        return session;
      },
    } });
  });
  await page.reload();
  await page.locator('#engine-note').filter({ hasText: 'on-device language model' }).waitFor();
  await page.locator('#clear').click();
  await page.locator('#status').click();
  const emptyA11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await writeFile('artifacts/accessibility-empty.json', JSON.stringify(emptyA11y.violations, null, 2) + '\n');
  assert.equal(emptyA11y.violations.length, 0, JSON.stringify(emptyA11y.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) }))));
  record('Empty workspace passes automated axe WCAG A/AA checks');
  await page.screenshot({ path: 'artifacts/screenshots/workspace-empty-1440.png', fullPage: true });

  await page.locator('#improve').click();
  await page.locator('#status.error').filter({ hasText: 'Add a prompt' }).waitFor();
  record('Empty prompt validation');
  await page.locator('[data-example="email"]').click();
  await page.locator('#context-details summary').click();
  await page.locator('#audience').fill('My project manager');
  await page.locator('#context').fill('The design review took two extra days. Ask for an extension to Friday. Keep it accountable, not defensive.');
  await page.locator('#tone').selectOption('friendly');
  await page.locator('#format').selectOption('short');
  await page.locator('#improve').click();
  await page.locator('#result-area').waitFor();
  assert.match(await page.locator('#improved').inputValue(), /My project manager/);
  assert.match(await page.locator('#improved').inputValue(), /extension to Friday/);
  assert.match(await page.locator('#output-mode').textContent(), /CHROME AI REWRITE/);
  assert.equal(network.length, 0);
  assert.equal(await page.locator('#compare').isDisabled(), true);
  const localRequest = await page.evaluate(() => globalThis.__localCalls.at(-1));
  assert.equal(localRequest.payload.preferences.context, 'The design review took two extra days. Ask for an extension to Friday. Keep it accountable, not defensive.');
  assert.match(localRequest.options.initialPrompts[0].content, /grammatically correct English/);
  record('On-device path invokes model with grammar/detail instructions and preferences (model fixture)');
  await page.screenshot({ path: 'artifacts/screenshots/workspace-polished-1440.png', fullPage: true });

  await page.waitForTimeout(200);
  await page.reload();
  await page.locator('#result-area').waitFor();
  assert.match(await page.locator('#improved').inputValue(), /project manager/);
  record('Draft and result restore from actual chrome.storage.session');
  await page.locator('#original').fill('Write a different email.');
  await page.locator('#stale-notice').waitFor();
  assert.equal(await page.locator('#compare').isDisabled(), true);
  record('Changed input marks result stale and blocks mismatched comparisons');
  await page.locator('#original').press('Control+Enter');
  await page.waitForFunction(() => document.querySelector('#stale-notice').hidden);
  assert.match(await page.locator('#improved').inputValue(), /different email/);
  record('Keyboard shortcut regenerates the correct result');

  // Clipboard API behavior, using the actual extension UI and a deterministic OS boundary.
  await page.evaluate(() => { navigator.clipboard.writeText = async (text) => { globalThis.__copied = text; }; });
  await page.locator('#improved').fill('My carefully edited prompt.');
  await page.locator('#copy').click();
  assert.equal(await page.evaluate(() => globalThis.__copied), 'My carefully edited prompt.');
  record('Editable output copies the latest text (clipboard OS boundary stubbed)');

  await page.locator('input[name="engine"][value="claude"]').check();
  const settingsOpened = context.waitForEvent('page');
  await page.locator('#improve').click();
  const setupTab = await settingsOpened;
  await setupTab.waitForLoadState();
  assert.ok(setupTab.url().endsWith('/settings.html'));
  await setupTab.close(); await page.bringToFront();
  assert.equal(network.length, 0);
  record('Missing Claude key opens setup without sending text or creating a fake result');
  await page.locator('#use-selection').click();
  await page.locator('#status.error').filter({ hasText: 'Chrome could not read' }).waitFor();
  record('Restricted page selection explains paste fallback');
  await page.locator('input[name="engine"][value="local"]').check();
  const screenshotPrompt = 'i will provide you images of thr mechanil componets you need t identify what the name of that compoent or what it is called in mechanicl terms and wht is its use';
  await page.locator('#original').fill(screenshotPrompt);
  await page.locator('#tone').selectOption('formal');
  await page.locator('#context').fill(''); await page.locator('#audience').fill('');
  await page.locator('#improve').click();
  await page.waitForFunction(() => document.querySelector('#busy-bar').hidden && document.querySelector('#improved').value.startsWith('I will provide images'));
  assert.match(await page.locator('#improved').inputValue(), /mechanical components/);
  assert.doesNotMatch(await page.locator('#improved').inputValue(), /mechanil|componets|\nApproach\n/);
  record('Screenshot regression routes to AI and displays its rewritten text, not the copied raw template (fixture)');
  await page.locator('#status').click();
  await page.evaluate(() => {
    const note = document.createElement('p'); note.id = 'test-fixture-note';
    note.textContent = 'TEST FIXTURE — simulated model output; live rewrite quality not verified.';
    note.style.cssText = 'padding:14px;background:#fff2dd;color:#614417;text-align:center;font-weight:600';
    document.querySelector('main').prepend(note);
  });
  await page.screenshot({ path: 'artifacts/screenshots/rewritten-mechanical-fixture-1440.png', fullPage: true });
  await page.locator('#test-fixture-note').evaluate((node) => node.remove());
  await page.evaluate(() => { globalThis.__localMode = 'unchanged'; });
  const goodPrompt = await page.locator('#improved').inputValue();
  await page.locator('#improve').click();
  await page.locator('#status.error').filter({ hasText: 'unchanged' }).waitFor();
  assert.equal(await page.locator('#improved').inputValue(), goodPrompt);
  record('Unchanged model response is rejected and does not replace previous output');
  await page.evaluate(() => { globalThis.__localMode = 'wait'; });
  await page.locator('#improve').click(); await page.locator('#busy-bar').waitFor();
  await page.locator('#cancel').click();
  await page.locator('#status.error').filter({ hasText: 'On-device rewrite canceled' }).waitFor();
  assert.equal(await page.locator('#original').isEnabled(), true);
  record('On-device cancellation aborts the model and unlocks editing');
  await page.evaluate(() => { sessionStorage.setItem('test-native-state', 'downloadable'); });
  await page.reload();
  await page.locator('#engine-note').filter({ hasText: 'one-time model download' }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.__localCalls.length), 0);
  await page.locator('#improve').click();
  await page.locator('#busy-label').filter({ hasText: '50%' }).waitFor();
  await page.waitForFunction(() => document.querySelector('#busy-bar').hidden);
  assert.equal(await page.evaluate(() => globalThis.__localCalls.length), 1);
  record('Downloadable model is not initialized on page load; explicit click starts it and shows progress (fixture)');
  await page.evaluate(() => sessionStorage.removeItem('test-native-state'));
  await page.evaluate(() => chrome.storage.session.set({ pendingSelection: { text: 'Explain recursion with a simple example.', at: Date.now() } }));
  await page.waitForFunction(() => document.querySelector('#original').value.startsWith('Explain recursion'));
  await page.locator('input[name="engine"][value="local"]').check();
  await page.locator('#improve').click();
  await page.waitForFunction(() => document.querySelector('#busy-bar').hidden && document.querySelector('#improved').value.startsWith('Describe recursion'));
  record('Selected-text handoff loads into editor without submitting');
  assert.equal(await page.locator('#context').inputValue(), '');
  assert.equal(await page.locator('#audience').inputValue(), '');
  assert.doesNotMatch(await page.locator('#improved').inputValue(), /design review|project manager/);
  record('New selected task does not inherit unrelated facts or audience');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#status').click();
  await page.screenshot({ path: 'artifacts/screenshots/sidepanel-390.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 320, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  record('Narrow 390px and 320px layouts have no horizontal overflow');
  const panelA11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await writeFile('artifacts/accessibility-panel.json', JSON.stringify(panelA11y.violations, null, 2) + '\n');
  assert.equal(panelA11y.violations.length, 0, JSON.stringify(panelA11y.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) }))));
  record('Narrow panel passes automated axe WCAG A/AA checks');
  await page.setViewportSize({ width: 1440, height: 1100 });

  await worker.evaluate(() => {
    globalThis.__apiCalls = [];
    globalThis.__apiMode = 'success';
    globalThis.__apiAllowed = true;
    const realContains = chrome.permissions.contains.bind(chrome.permissions);
    chrome.permissions.contains = async (permissions) => permissions.origins?.includes('https://api.anthropic.com/*') ? globalThis.__apiAllowed : realContains(permissions);
    globalThis.fetch = async (url, init) => {
      if (!url.startsWith('https://api.anthropic.com/v1/')) throw new Error('Unexpected network origin');
      const body = init.body ? JSON.parse(init.body) : null;
      globalThis.__apiCalls.push({ url, body });
      if (globalThis.__apiMode === 'wait') return new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); });
      if (url.includes('/models')) return new Response(JSON.stringify({ data: [{ id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' }] }));
      const first = body.messages[0].content.startsWith('Explain');
      if (globalThis.__apiMode === 'partial' && first) return new Response('{}', { status: 429 });
      if (globalThis.__apiMode === 'unauthorized') return new Response('{}', { status: 401 });
      const rewrite = body.system.includes('prompt editor');
      const text = rewrite ? 'Explain recursion to a beginner. Use a short example, show the base case, and explain how each step reaches it.' : first
        ? 'Recursion is when a function calls itself to solve a smaller version of the same problem. It stops at a base case.\n\nFor example, counting down from 3 repeats the same operation for 2 and then 1.'
        : 'Think of opening a set of nested boxes. Each box contains a smaller box until the final box has no box inside.\n\nIn a recursive function:\n1. The base case stops the process.\n2. The recursive step solves a smaller problem.\n3. Each step must get closer to the base case.\n\nExample: countdown(3) prints 3, then calls countdown(2), then countdown(1), and stops at 0.\n\nWithout a reachable base case, recursion can continue until the call stack is exhausted.';
      return new Response(JSON.stringify({ content: [{ type: 'text', text: globalThis.__apiMode === 'xss' ? '<img src=x onerror="window.__xss=1"> <script>window.__xss=1</script>' : text }], model: body.model, usage: { input_tokens: 80, output_tokens: 140 }, stop_reason: globalThis.__apiMode === 'truncated' ? 'max_tokens' : 'end_turn' }));
    };
  });
  const settings = await context.newPage();
  await settings.goto(base + '/settings.html');
  await settings.locator('#key-state').filter({ hasText: 'No API key' }).waitFor();
  await settings.evaluate(() => { chrome.permissions.request = async () => true; });
  await settings.locator('#api-key').fill('sk-ant-browser-fixture-not-a-real-key');
  await settings.locator('#save-settings').click();
  await settings.locator('#settings-status').filter({ hasText: 'Connection saved' }).waitFor();
  let stored = await settings.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
  assert.equal(Boolean(stored.session.sessionKey), true);
  assert.equal(stored.local.savedKey, undefined);
  assert.equal(await settings.locator('#api-key').inputValue(), '');
  const publicSettings = await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }));
  assert.equal(JSON.stringify(publicSettings).includes('sk-ant-'), false);
  assert.equal((await worker.evaluate(() => globalThis.__apiCalls)).length, 0);
  record('Settings save is network-free; default key is session-only and never returned to UI');
  await settings.locator('#verify').click();
  await settings.locator('#settings-status').filter({ hasText: 'Connected.' }).waitFor();
  assert.equal((await worker.evaluate(() => globalThis.__apiCalls)).length, 1);
  record('Model-list verification through real runtime messaging, using mocked Anthropic transport');
  await settings.screenshot({ path: 'artifacts/screenshots/settings-1440.png', fullPage: true });
  const settingsA11y = await new AxeBuilder({ page: settings }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await writeFile('artifacts/accessibility-settings.json', JSON.stringify(settingsA11y.violations, null, 2) + '\n');
  assert.equal(settingsA11y.violations.length, 0, JSON.stringify(settingsA11y.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) }))));
  record('Settings passes automated axe WCAG A/AA checks');

  await settings.locator('#remember').check();
  await settings.locator('#save-settings').click();
  await settings.locator('#key-state').filter({ hasText: 'on this device' }).waitFor();
  stored = await settings.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
  assert.equal(Boolean(stored.local.savedKey), true); assert.equal(stored.session.sessionKey, undefined);
  await settings.locator('#remember').uncheck();
  await settings.locator('#save-settings').click();
  await settings.locator('#key-state').filter({ hasText: 'browser session' }).waitFor();
  stored = await settings.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
  assert.equal(stored.local.savedKey, undefined); assert.equal(Boolean(stored.session.sessionKey), true);
  record('Explicit remember/unremember moves the key between storage areas without duplicates');

  await page.bringToFront();
  await page.locator('#provider-status').filter({ hasText: 'Key saved' }).waitFor();
  assert.equal(await page.locator('#compare').isDisabled(), true);
  await page.locator('#compare-consent').check();
  await page.locator('#compare').click();
  await page.locator('#comparison-results').waitFor();
  await page.waitForFunction(() => document.querySelector('#busy-bar').hidden);
  assert.match(await page.locator('#answer-original').textContent(), /Recursion/);
  assert.match(await page.locator('#answer-improved').textContent(), /nested boxes/);
  let calls = await worker.evaluate(() => globalThis.__apiCalls.filter((call) => call.body));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.model, calls[1].body.model);
  assert.equal(calls[0].body.max_tokens, calls[1].body.max_tokens);
  record('Consent-gated comparison sends exactly two independent matched-model requests');
  await page.locator('#status').click();
  await page.screenshot({ path: 'artifacts/screenshots/comparison-mocked-1440.png', fullPage: true });

  await worker.evaluate(() => { globalThis.__apiMode = 'partial'; });
  await page.locator('#compare').click();
  await page.locator('#answer-original.error').filter({ hasText: 'rate-limiting' }).waitFor();
  assert.match(await page.locator('#answer-improved').textContent(), /nested boxes/);
  record('Partial failure preserves the successful answer and reports billing uncertainty');
  await worker.evaluate(() => { globalThis.__apiMode = 'xss'; });
  await page.locator('#compare').click();
  await page.locator('#answer-original').filter({ hasText: '<img' }).waitFor();
  assert.equal(await page.locator('#answer-original img, #answer-original script').count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__xss), undefined);
  record('Untrusted Claude output is rendered as plain text, not executable HTML');

  await worker.evaluate(() => { globalThis.__apiMode = 'success'; });
  await page.locator('input[name="engine"][value="claude"]').check();
  await page.locator('#improve').click();
  await page.locator('#output-mode').filter({ hasText: 'CLAUDE REWRITE' }).waitFor();
  assert.match(await page.locator('#improved').inputValue(), /Explain recursion to a beginner/);
  assert.equal(await page.locator('#comparison-results').isVisible(), false);
  record('Claude rewrite replaces output only on success and invalidates old comparisons');
  const prior = await page.locator('#improved').inputValue();
  await worker.evaluate(() => { globalThis.__apiMode = 'unauthorized'; });
  await page.locator('#improve').click();
  await page.locator('#status.error').filter({ hasText: 'rejected the API key' }).waitFor();
  assert.equal(await page.locator('#improved').inputValue(), prior);
  record('Authentication failure preserves the previous usable prompt');
  await worker.evaluate(() => { globalThis.__apiMode = 'wait'; });
  await page.locator('#improve').click();
  await page.locator('#busy-bar').waitFor();
  assert.equal(await page.locator('#original').isDisabled(), true);
  await page.locator('#cancel').click();
  await page.locator('#status.error').filter({ hasText: 'canceled' }).waitFor();
  assert.equal(await page.locator('#original').isEnabled(), true);
  assert.equal(await page.locator('#improved').inputValue(), prior);
  record('Cancel aborts worker request, unlocks editor, and preserves previous output');

  const beforeFallback = await worker.evaluate(() => globalThis.__apiCalls.length);
  await page.evaluate(() => sessionStorage.setItem('test-native-state', 'unavailable'));
  await page.reload();
  await page.locator('input[name="engine"][value="local"]').check();
  await page.locator('#improve-label').filter({ hasText: 'Use Claude instead' }).waitFor();
  await page.locator('#improve').click();
  await page.locator('#improve-label').filter({ hasText: 'Send to Claude & rewrite' }).waitFor();
  assert.equal(await worker.evaluate(() => globalThis.__apiCalls.length), beforeFallback);
  record('Unavailable on-device model never silently falls back to a paid cloud request');

  await settings.evaluate(() => { chrome.permissions.remove = async () => true; });
  await settings.locator('#remove-key').click();
  await settings.locator('#settings-status').filter({ hasText: 'API key removed' }).waitFor();
  stored = await settings.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
  assert.equal(stored.local.savedKey, undefined); assert.equal(stored.session.sessionKey, undefined);
  record('Remove-key clears both storage areas (native permission dialog boundary stubbed)');
  await page.locator('#clear').click();
  await page.locator('#empty-output').waitFor();
  stored = await page.evaluate(() => chrome.storage.session.get(null));
  assert.equal(stored.workspace, undefined);
  assert.equal(await page.locator('#original').inputValue(), '');
  assert.equal(await page.locator('input[value="local"]').isChecked(), true);
  record('Clear workspace removes session draft/results and returns to local mode');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(network.length, 0, JSON.stringify(network));
  record('No uncaught browser errors or real HTTP traffic across all workflows');
  await writeFile('artifacts/browser-verification.json', JSON.stringify({ passed: true, browser: await context.browser().version(), nativeCapability, checks, errors, realHttpRequests: network.length, boundaries: ['Chrome AI generation mocked; native capability was separately probed, no model downloaded', 'Anthropic transport mocked; no live API key or billable calls', 'Tests do not establish live grammar or semantic enhancement quality', 'Native optional host permission dialog stubbed', 'Clipboard OS boundary stubbed', 'Selected-text handoff tested; native toolbar/context menu click not automated', 'Side-panel layout tested in extension page viewports, not browser sidebar chrome'], generatedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(`\n${checks.length} browser checks passed.`);
} catch (error) {
  await writeFile('artifacts/browser-verification.json', JSON.stringify({ passed: false, checks, errors, failure: error.message }, null, 2) + '\n');
  throw error;
} finally { await context.close(); }
