import { API_ORIGIN } from './lib/claude.js';
import { DEFAULT_MODEL } from './lib/prompt.js';

const $ = (id) => document.getElementById(id);
const extension = Boolean(globalThis.chrome?.runtime?.id);
function status(text, error = false) { $('settings-status').hidden = false; $('settings-status').textContent = text; $('settings-status').classList.toggle('error', error); }
async function send(type, payload = {}) {
  if (!extension) throw new Error('Load this folder as an unpacked Chrome extension first.');
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || 'The extension connection was interrupted.');
  return response.data;
}
function busy(value) { for (const id of ['save-settings', 'verify', 'remove-key', 'api-key', 'model', 'remember']) $(id).disabled = value; }
async function refresh() {
  $('model').value = DEFAULT_MODEL;
  if (!extension) return;
  const data = await send('GET_SETTINGS');
  $('model').value = data.model;
  $('remember').checked = data.remembered;
  $('key-state').textContent = data.hasKey ? `A key is saved ${data.remembered ? 'on this device' : 'for this browser session'}. Leave this field blank to keep it.${data.permitted ? '' : ' API access permission is missing; save to grant it.'}` : 'No API key saved. Chrome AI can rewrite without a key only if your browser and device support it.';
  $('verify').disabled = !data.hasKey || !data.permitted;
  $('remove-key').disabled = !data.hasKey && !data.permitted;
}
$('show-key').addEventListener('click', () => {
  const show = $('api-key').type === 'password';
  $('api-key').type = show ? 'text' : 'password'; $('show-key').textContent = show ? 'Hide' : 'Show';
  $('show-key').setAttribute('aria-label', show ? 'Hide API key' : 'Show API key');
  $('show-key').setAttribute('aria-pressed', String(show));
});
$('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    if (!extension) throw new Error('Load this folder as an unpacked Chrome extension first.');
    // permissions.request is the first asynchronous action in this explicit user gesture.
    const granted = await chrome.permissions.request({ origins: [API_ORIGIN] });
    if (!granted) throw new Error('API access was not granted. No key was saved and no prompt was sent.');
    busy(true);
    await send('SAVE_SETTINGS', { apiKey: $('api-key').value.trim(), model: $('model').value.trim(), remember: $('remember').checked });
    $('api-key').value = '';
    $('api-key').type = 'password'; $('show-key').textContent = 'Show'; $('show-key').setAttribute('aria-label', 'Show API key'); $('show-key').setAttribute('aria-pressed', 'false');
    status('Connection saved. No prompt was sent. Verify the key and model before using Claude.');
  } catch (error) { status(error.message, true); }
  finally { busy(false); await refresh(); }
});
$('verify').addEventListener('click', async () => {
  try {
    busy(true); status('Checking your key and listing available models…');
    const result = await send('CHECK_CONNECTION');
    $('model-list').replaceChildren(...result.models.map((item) => { const option = document.createElement('option'); option.value = item.id; option.label = item.name; return option; }));
    status(result.selectedAvailable ? `Connected. ${result.model} is available. No generation request was made.` : `Key accepted, but ${result.model} was not in the returned model list. Choose a model from the suggestions and save.`, !result.selectedAvailable);
  } catch (error) { status(error.message, true); }
  finally { busy(false); await refresh(); }
});
$('remove-key').addEventListener('click', async () => {
  try {
    busy(true); await send('REMOVE_KEY'); await chrome.permissions.remove({ origins: [API_ORIGIN] });
    $('api-key').value = ''; status('API key removed and API access revoked. Chrome AI remains usable only if supported on this device.');
  } catch (error) { status(error.message, true); }
  finally { busy(false); await refresh(); }
});
refresh().catch(() => status('Could not read connection settings. Reopen the extension and try again.', true));