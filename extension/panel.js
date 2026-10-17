import { DEFAULT_PREFERENCES, REWRITE_VERSION, cleanPreferences, validatePrompt, wordCount } from './lib/prompt.js';
import { chromeAiAvailability, rewriteWithChrome } from './lib/chrome-ai.js';

const $ = (id) => document.getElementById(id);
const extension = Boolean(globalThis.chrome?.runtime?.id);
let result = null;
let comparison = null;
let sourceFingerprint = '';
let provider = { hasKey: false, permitted: false };
let busy = false;
let chromeAiState = 'checking';
let localController = null;
let persistTimer;
let noticeTimer;
const examples = {
  email: 'Write an email asking for more time on a project.',
  code: 'Help me fix a slow React app.',
  learn: 'Explain machine learning.',
};

function preferences() { return cleanPreferences(Object.fromEntries(['tone', 'format', 'audience', 'context'].map((key) => [key, $(key).value]))); }
function fingerprint() { return JSON.stringify({ original: $('original').value.trim(), preferences: preferences() }); }
function selectedEngine() { return document.querySelector('input[name="engine"]:checked').value; }
function isStale() { return Boolean(result && fingerprint() !== sourceFingerprint); }

function notify(text, error = false) {
  clearTimeout(noticeTimer);
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
  $('status').hidden = false;
  if (!error) noticeTimer = setTimeout(() => { $('status').hidden = true; }, 6500);
}

async function send(type, payload = {}) {
  if (!extension) throw new Error('Load Prompt Polish as a Chrome extension to use this feature.');
  let response;
  try { response = await chrome.runtime.sendMessage({ type, ...payload }); }
  catch { throw new Error('The extension connection was interrupted. Reopen the panel and try again.'); }
  if (!response?.ok) throw new Error(response?.error || 'The extension did not return a response.');
  return response.data;
}

function saveSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(save, 150);
}

async function save() {
  if (!extension) return;
  await chrome.storage.session.set({ workspace: {
    original: $('original').value, preferences: preferences(), engine: selectedEngine(), result,
    sourceFingerprint, comparison,
  } }).catch(() => notify('Your workspace could not be saved for this session.', true));
}

function updateControls() {
  $('character-count').textContent = `${$('original').value.length.toLocaleString('en-US')} / 12,000`;
  $('stale-notice').hidden = !isStale();
  const claude = selectedEngine() === 'claude';
  const chromeNotes = {
    checking: 'Checking whether this browser supports an on-device language model…',
    unavailable: 'Chrome AI is unavailable here. Real rewriting needs a language model. Connect Claude below; no generic template will be generated.',
    downloadable: 'A one-time model download is required and can use several GB of disk space/data. Clicking below authorizes the download and rewrite. Your prompt is processed on-device.',
    downloading: 'Chrome is downloading its AI model. Keep the panel open; your prompt will be processed on-device when ready.',
    available: 'An on-device language model will rewrite grammar, wording, and relevant detail. No prompt is sent to a cloud provider.',
  };
  $('engine-note').textContent = claude
    ? 'Clicking Send transmits your prompt and preferences to Anthropic for an AI rewrite. One billable API call using your key.'
    : chromeNotes[chromeAiState];
  $('improve-label').textContent = claude
    ? (provider.hasKey && provider.permitted ? 'Send to Claude & rewrite' : 'Connect Claude to rewrite')
    : chromeAiState === 'checking' ? 'Checking Chrome AI…'
    : chromeAiState === 'unavailable' ? (provider.hasKey && provider.permitted ? 'Use Claude instead' : 'Connect Claude to rewrite')
    : chromeAiState === 'downloadable' ? 'Download Chrome AI & rewrite'
    : chromeAiState === 'downloading' ? 'Finish download & rewrite' : 'Rewrite my prompt';
  $('improve').disabled = busy || (!claude && chromeAiState === 'checking');
  $('engine-recheck').hidden = claude || chromeAiState !== 'unavailable';
  $('engine-recheck').disabled = busy;
  $('compare').disabled = busy || !result?.text?.trim() || isStale() || !$('compare-consent').checked || !provider.hasKey || !provider.permitted;
  $('copy').disabled = !result?.text?.trim();
  $('provider-status').textContent = provider.hasKey && provider.permitted ? 'Key saved · ready to send' : 'Comparison requires a Claude API key';
  $('connect-claude').textContent = provider.hasKey && provider.permitted ? 'Connection settings' : 'Connect your key';
}

function setBusy(value, label = '') {
  busy = value;
  document.querySelectorAll('#original, #improved, #tone, #format, #audience, #context, input[name="engine"], #improve, #clear, #use-selection, [data-example], #compare-consent').forEach((element) => { element.disabled = value; });
  $('busy-bar').hidden = !value;
  $('busy-label').textContent = label;
  $('status').hidden = true;
  updateControls();
}

function renderResult() {
  $('empty-output').hidden = Boolean(result);
  $('result-area').hidden = !result;
  $('output-mode').textContent = result ? (result.engine === 'chrome-ai' ? 'CHROME AI REWRITE' : 'CLAUDE REWRITE') : 'READY WHEN YOU ARE';
  if (result) {
    $('improved').value = result.text;
    $('result-meta').textContent = `${wordCount(result.text)} words · AI rewrite · review before use`;
    $('changes').replaceChildren(...result.changes.map((text) => { const li = document.createElement('li'); li.textContent = text; return li; }));
  }
  updateControls();
}

function renderComparison() {
  $('comparison-results').hidden = !comparison;
  if (!comparison) return;
  $('comparison-model').textContent = `${comparison.model} · up to ${comparison.maxTokens} output tokens per answer`;
  $('sent-original').textContent = comparison.prompts.original;
  $('sent-improved').textContent = comparison.prompts.improved;
  for (const key of ['original', 'improved']) {
    const answer = comparison[key];
    // Never interpret untrusted model or selected-page content as HTML.
    $('answer-' + key).textContent = answer.error || answer.text;
    $('answer-' + key).classList.toggle('error', Boolean(answer.error));
    $('usage-' + key).textContent = answer.error ? 'This answer was not received. Other calls may still be billed.'
      : `${answer.usage.input} input tokens · ${answer.usage.output} output tokens${answer.truncated ? ' · Output limit reached; answer is incomplete.' : ''}`;
  }
}

async function improve() {
  if (busy) return;
  try {
    if (selectedEngine() === 'local' && chromeAiState === 'unavailable') {
      document.querySelector('input[name="engine"][value="claude"]').checked = true;
      updateControls(); await save();
      if (provider.hasKey && provider.permitted) notify('Claude selected. Click Send to Claude & rewrite to send your prompt.');
      else openSettings();
      return;
    }
    if (selectedEngine() === 'claude' && (!provider.hasKey || !provider.permitted)) { await save(); openSettings(); return; }
    const original = validatePrompt($('original').value);
    const prefs = preferences();
    const origin = fingerprint();
    let next;
    if (selectedEngine() === 'claude') {
      setBusy(true, 'Claude is rewriting your prompt…');
      next = await send('REWRITE', { original, preferences: prefs, consent: true });
    } else {
      localController = new AbortController();
      setBusy(true, chromeAiState === 'available' ? 'Rewriting your prompt on-device…' : 'Preparing Chrome AI (model download may take a few minutes)…');
      next = await rewriteWithChrome(original, prefs, {
        availability: chromeAiState, signal: localController.signal,
        onProgress: (percent) => { $('busy-label').textContent = `Chrome AI model download: ${percent}%`; },
        onStage: (label) => { $('busy-label').textContent = label; },
      });
      chromeAiState = 'available';
    }
    result = next;
    comparison = null;
    sourceFingerprint = origin;
    renderResult();
    renderComparison();
    await save();
    if (window.innerWidth <= 650) $('output-heading').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    setBusy(false);
    notify(next.engine === 'chrome-ai' ? 'On-device AI rewrite ready. Review the grammar, added detail, and meaning.' : 'Claude rewrite ready. Review it before use.');
  } catch (error) { setBusy(false); notify(error.message, true); }
  finally { localController = null; }
}

async function compare() {
  if (busy || $('compare').disabled) return;
  const prompts = { original: $('original').value.trim(), improved: result.text.trim() };
  try {
    comparison = null;
    renderComparison();
    setBusy(true, 'Getting two independent Claude answers…');
    const answers = await send('COMPARE', { ...prompts, consent: $('compare-consent').checked });
    comparison = { ...answers, prompts };
    renderComparison();
    await save();
    setBusy(false);
    const failed = Number(Boolean(answers.original.error)) + Number(Boolean(answers.improved.error));
    notify(failed ? `${failed === 2 ? 'Both answers failed' : 'One answer failed'}. See the details below; no automatic retry was sent.` : 'Both answers are ready. Compare relevance, accuracy, and usefulness.', Boolean(failed));
    $('comparison-results').scrollIntoView({ behavior: 'instant', block: 'start' });
  } catch (error) { setBusy(false); notify(error.message, true); }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); notify('Copied to clipboard.'); }
  catch { notify('Clipboard access was blocked. Select the text and copy it manually.', true); }
}

function inputChanged() { comparison = null; renderComparison(); updateControls(); saveSoon(); }
async function refreshProvider() {
  if (!extension) { updateControls(); return; }
  try { provider = await send('GET_SETTINGS'); updateControls(); }
  catch (error) { notify(error.message, true); }
}
async function refreshChromeAi() {
  chromeAiState = 'checking'; updateControls();
  chromeAiState = await chromeAiAvailability(); updateControls();
}
function openSettings() { if (extension) chrome.runtime.openOptionsPage(); else window.location.href = 'settings.html'; }

function startNewPrompt(text) {
  $('original').value = text.slice(0, 12000);
  // An explicitly imported task must not inherit facts from the previous task.
  $('audience').value = '';
  $('context').value = '';
  $('context-details').open = false;
  inputChanged();
}

async function applySelection(text) {
  if (!text?.trim()) return;
  startNewPrompt(text);
  notify('Selected text added; previous context cleared. Nothing has been sent or submitted.');
  if (extension) await chrome.storage.session.remove('pendingSelection');
}

$('improve').addEventListener('click', improve);
$('compare').addEventListener('click', compare);
$('cancel').addEventListener('click', async () => {
  if (localController) { localController.abort(); return; }
  try { await send('CANCEL'); } catch (error) { notify(error.message, true); }
});
$('engine-recheck').addEventListener('click', refreshChromeAi);
window.addEventListener('pagehide', () => localController?.abort());
$('copy').addEventListener('click', () => copyText(result.text));
$('copy-comparison').addEventListener('click', () => {
  if (!comparison) return;
  copyText(`PROMPT POLISH — CLAUDE COMPARISON\nModel: ${comparison.model}\n\nORIGINAL PROMPT\n${comparison.prompts.original}\n\nCLAUDE ANSWER\n${comparison.original.text || comparison.original.error}\n\nPOLISHED PROMPT\n${comparison.prompts.improved}\n\nCLAUDE ANSWER\n${comparison.improved.text || comparison.improved.error}\n\nIndividual model outputs are not a quality benchmark.`);
});
$('settings').addEventListener('click', openSettings);
$('connect-claude').addEventListener('click', openSettings);
$('open-tab').addEventListener('click', async () => { await save(); if (extension) chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') }); });
$('status').addEventListener('click', () => { $('status').hidden = true; });
for (const id of ['original', 'tone', 'format', 'audience', 'context']) $(id).addEventListener('input', inputChanged);
document.querySelectorAll('input[name="engine"]').forEach((input) => input.addEventListener('change', () => { updateControls(); saveSoon(); }));
$('compare-consent').addEventListener('change', updateControls);
$('improved').addEventListener('input', () => {
  if (!result) return;
  result.text = $('improved').value;
  $('result-meta').textContent = `${wordCount(result.text)} words · edited by you`;
  inputChanged();
});
document.querySelectorAll('[data-example]').forEach((button) => button.addEventListener('click', () => {
  startNewPrompt(examples[button.dataset.example]); $('original').focus();
}));
$('clear').addEventListener('click', async () => {
  clearTimeout(persistTimer);
  $('original').value = ''; result = null; comparison = null; sourceFingerprint = '';
  for (const [key, value] of Object.entries(DEFAULT_PREFERENCES)) $(key).value = value;
  document.querySelector('input[name="engine"][value="local"]').checked = true;
  $('compare-consent').checked = false;
  $('context-details').open = false;
  $('improved').value = '';
  for (const id of ['sent-original', 'sent-improved', 'answer-original', 'answer-improved']) $(id).textContent = '';
  renderResult(); renderComparison();
  if (extension) await chrome.storage.session.remove(['workspace', 'pendingSelection']);
  $('original').focus(); notify('Drafts and results cleared. Your connection settings are unchanged.');
});
$('use-selection').addEventListener('click', async () => {
  try {
    if (!extension) throw new Error('Selected text is available after loading the Chrome extension.');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active page is available.');
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && active.type === 'password') return '';
      if (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'email'].includes(active.type))) {
        if (typeof active.selectionStart === 'number') return active.value.slice(active.selectionStart, active.selectionEnd);
      }
      return window.getSelection()?.toString() || '';
    } });
    const text = results[0]?.result;
    if (!text?.trim()) throw new Error('Select prompt text on a web page first, then open the side panel. You can also right-click a selection and choose “Polish this prompt”.');
    await applySelection(text);
  } catch (error) {
    notify(error.message?.includes('Select prompt') ? error.message : 'Chrome could not read a selection here. Built-in Chrome pages, extension pages, and some frames are restricted. Paste your prompt instead.', true);
  }
});
document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!busy) improve(); } });

async function init() {
  if (extension) {
    const data = await chrome.storage.session.get(['workspace', 'pendingSelection']);
    if (data.workspace) {
      const saved = data.workspace;
      $('original').value = saved.original || '';
      for (const [key, value] of Object.entries(cleanPreferences(saved.preferences))) $(key).value = value;
      document.querySelector(`input[name="engine"][value="${saved.engine === 'claude' ? 'claude' : 'local'}"]`).checked = true;
      // Preserve the user's input, but never restore the old wrapper as a polished result.
      result = saved.result?.rewriteVersion === REWRITE_VERSION ? saved.result : null;
      comparison = result ? saved.comparison || null : null;
      sourceFingerprint = result ? saved.sourceFingerprint || '' : '';
      if (saved.result && !result) notify('Your original prompt was kept. The old template output was removed; choose an AI engine to rewrite it.');
      $('context-details').open = Boolean($('audience').value || $('context').value);
    }
    if (data.pendingSelection) await applySelection(data.pendingSelection.text);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes.pendingSelection?.newValue) {
        if (busy) notify('A selection is waiting. Reopen the panel after the current request to import it.');
        else applySelection(changes.pendingSelection.newValue.text);
      }
      if (area === 'local' || (area === 'session' && changes.sessionKey)) refreshProvider();
    });
    chrome.permissions.onRemoved.addListener(refreshProvider);
    chrome.permissions.onAdded.addListener(refreshProvider);
  }
  renderResult(); renderComparison(); await Promise.all([refreshProvider(), refreshChromeAi()]);
}
init().catch(() => notify('Could not restore the previous session. Reopen the extension to try again.', true));