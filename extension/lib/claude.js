import { DEFAULT_MODEL, MAX_PROMPT_LENGTH, buildRewriteRequest, makeRewriteResult, validatePrompt } from './prompt.js';

export const API_ORIGIN = 'https://api.anthropic.com/*';
export const API_BASE = 'https://api.anthropic.com/v1';
export const COMPARISON_TOKENS = 800;
export const REWRITE_TOKENS = 2400;

export function validateKey(value) {
  if (typeof value !== 'string' || !/^sk-ant-[\x21-\x7E]{12,}$/.test(value.trim()) || value.length > 500) {
    throw new Error('Enter an Anthropic API key beginning with sk-ant-. A Claude subscription is not an API key.');
  }
  return value.trim();
}

export function validateModel(value = DEFAULT_MODEL) {
  if (typeof value !== 'string' || !/^claude-[a-zA-Z0-9.-]{3,100}$/.test(value)) throw new Error('Enter a valid Claude API model ID.');
  return value;
}

export function safeApiError(status) {
  if (status === 401) return 'Claude rejected the API key. Check it in Settings.';
  if (status === 403) return 'This API key cannot access the requested resource. Check its permissions.';
  if (status === 404) return 'That Claude model is unavailable. Verify the model ID in Settings.';
  if (status === 429) return 'Claude is rate-limiting requests. Wait a moment and try again.';
  if (status === 529 || status >= 500) return 'Claude is temporarily unavailable. Try again later or use Chrome AI if available.';
  if (status === 400 || status === 402) return 'Claude could not accept the request. Check API credit, model availability, and input size.';
  return `Claude request failed (HTTP ${status}). No replacement prompt was generated.`;
}

async function apiRequest(path, { apiKey, body, fetchImpl = fetch, signal } = {}) {
  const headers = {
    'x-api-key': validateKey(apiKey),
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    'content-type': 'application/json',
  };
  // A bounded request prevents an unresponsive fetch outliving the MV3 worker.
  const timeout = AbortSignal.timeout(25000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(API_BASE + path, {
      method: body ? 'POST' : 'GET', headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: combined, credentials: 'omit', cache: 'no-store', redirect: 'error',
    });
    if (!response.ok) throw new Error(safeApiError(response.status));
    return await response.json();
  } catch (error) {
    if (combined.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error(signal?.aborted ? 'Request canceled. Usage may still be billed by Anthropic.' : 'Claude took too long. Try a shorter prompt or try again. No automatic retry was sent.');
    }
    if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('Could not reach Claude or read its response. Check your connection and extension API permission.');
    throw error;
  }
}

export async function listModels(config) {
  const data = await apiRequest('/models?limit=100', config);
  if (!Array.isArray(data.data)) throw new Error('Claude returned an unexpected model list.');
  return data.data.filter((model) => typeof model.id === 'string' && model.id.startsWith('claude-'))
    .map((model) => ({ id: model.id, name: model.display_name || model.id }));
}

export async function sendMessage({ prompt, system, maxTokens = COMPARISON_TOKENS, model = DEFAULT_MODEL, ...config }) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_LENGTH * 2) throw new Error('The prompt is empty or too long to send.');
  const data = await apiRequest('/messages', { ...config, body: {
    model: validateModel(model), max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: prompt }],
  } });
  const text = (Array.isArray(data.content) ? data.content : []).filter((item) => item.type === 'text' && typeof item.text === 'string').map((item) => item.text).join('\n\n').trim();
  if (!text) throw new Error('Claude returned no text. Try rephrasing your request.');
  return {
    text, model: data.model || model, truncated: data.stop_reason === 'max_tokens',
    usage: { input: Number(data.usage?.input_tokens) || 0, output: Number(data.usage?.output_tokens) || 0 },
  };
}

export async function rewriteWithClaude(raw, preferences, config) {
  const { system, user } = buildRewriteRequest(raw, preferences);
  const result = await sendMessage({ ...config, prompt: user, system, maxTokens: REWRITE_TOKENS });
  if (result.truncated) throw new Error('Claude reached the rewrite limit. Shorten the prompt and try again; the incomplete rewrite was not applied.');
  return makeRewriteResult(raw, result.text, 'claude', result);
}

export async function compareWithClaude(original, improved, config) {
  validatePrompt(original);
  // Added structure can make a valid 12k-character input longer than its source.
  validatePrompt(improved, MAX_PROMPT_LENGTH * 2);
  // Identical model/system/output budget, no shared history, no third-call "judge".
  const settled = await Promise.allSettled([original, improved].map((prompt) => sendMessage({
    ...config, prompt, system: 'You are a helpful assistant. Answer the user request accurately. State important uncertainties. Do not claim to have browsed the web or executed code.',
    maxTokens: COMPARISON_TOKENS,
  })));
  return {
    original: settled[0].status === 'fulfilled' ? settled[0].value : { error: settled[0].reason.message },
    improved: settled[1].status === 'fulfilled' ? settled[1].value : { error: settled[1].reason.message },
    model: config.model || DEFAULT_MODEL, maxTokens: COMPARISON_TOKENS,
  };
}