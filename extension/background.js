import { API_ORIGIN, compareWithClaude, listModels, rewriteWithClaude, validateKey, validateModel } from './lib/claude.js';
import { DEFAULT_MODEL } from './lib/prompt.js';

// Keys never enter page scripts, sync storage, prompts, console logs, or messages back to the UI.
const storageReady = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
let activeTask = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'polish-selection', title: 'Polish this prompt', contexts: ['selection'] });
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'polish-selection' || !tab?.windowId) return;
  // Open synchronously in the user gesture, before the storage await.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  chrome.storage.session.set({ pendingSelection: { text: (info.selectionText || '').slice(0, 12000), at: Date.now() } });
});

async function getConfig() {
  await storageReady;
  const [session, local] = await Promise.all([
    chrome.storage.session.get('sessionKey'), chrome.storage.local.get(['savedKey', 'model']),
  ]);
  return { apiKey: session.sessionKey || local.savedKey || '', model: local.model || DEFAULT_MODEL, remembered: Boolean(local.savedKey) };
}

async function requireConfig() {
  if (!await chrome.permissions.contains({ origins: [API_ORIGIN] })) throw new Error('Enable Claude API access in Settings first.');
  const config = await getConfig();
  if (!config.apiKey) throw new Error('Add your own Anthropic API key in Settings. Chrome AI is the alternative only on supported devices.');
  return config;
}

async function runTask(work) {
  if (activeTask) throw new Error('A Claude request is already running. Wait for it to finish or cancel it.');
  const controller = new AbortController();
  activeTask = controller;
  try { return await work(controller.signal); }
  finally { if (activeTask === controller) activeTask = null; }
}

async function handleMessage(message) {
  await storageReady;
  switch (message.type) {
    case 'GET_SETTINGS': {
      const { apiKey, model, remembered } = await getConfig();
      const permitted = await chrome.permissions.contains({ origins: [API_ORIGIN] });
      return { hasKey: Boolean(apiKey), model, remembered, permitted, busy: Boolean(activeTask) };
    }
    case 'SAVE_SETTINGS': {
      const previous = await getConfig();
      const apiKey = message.apiKey ? validateKey(message.apiKey) : previous.apiKey;
      const model = validateModel(message.model);
      if (!apiKey) throw new Error('Enter an API key to enable Claude.');
      if (!await chrome.permissions.contains({ origins: [API_ORIGIN] })) throw new Error('API access permission was not granted. Nothing was saved.');
      if (message.remember === true) {
        await chrome.storage.local.set({ savedKey: apiKey, model });
        await chrome.storage.session.remove('sessionKey');
      } else {
        await chrome.storage.session.set({ sessionKey: apiKey });
        await chrome.storage.local.set({ model });
        await chrome.storage.local.remove('savedKey');
      }
      return { saved: true };
    }
    case 'REMOVE_KEY':
      activeTask?.abort();
      await Promise.all([chrome.storage.session.remove('sessionKey'), chrome.storage.local.remove('savedKey')]);
      return { removed: true };
    case 'CHECK_CONNECTION': {
      return runTask(async (signal) => {
        const config = await requireConfig();
        const models = await listModels({ ...config, signal });
        return { models, selectedAvailable: models.some((item) => item.id === config.model), model: config.model };
      });
    }
    case 'REWRITE':
    case 'COMPARE': {
      if (message.consent !== true) throw new Error('Explicit send confirmation is required.');
      return runTask(async (signal) => {
        const config = await requireConfig();
        const result = message.type === 'REWRITE'
          ? await rewriteWithClaude(message.original, message.preferences, { ...config, signal })
          : await compareWithClaude(message.original, message.improved, { ...config, signal });
        // Discard a late response if the user canceled or removed the key.
        if (signal.aborted) throw new Error('Request canceled. Usage may still be billed by Anthropic.');
        return result;
      });
    }
    case 'CANCEL':
      activeTask?.abort();
      return { canceled: true };
    default: throw new Error('Unknown extension request.');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const allowed = ['panel.html', 'settings.html'].map((path) => chrome.runtime.getURL(path));
  const senderUrl = (sender.url || '').split(/[?#]/)[0];
  if (sender.id !== chrome.runtime.id || !allowed.includes(senderUrl)) {
    sendResponse({ ok: false, error: 'This request is not from an authorized extension page.' });
    return false;
  }
  handleMessage(message).then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || 'The request could not be completed.' }));
  return true;
});