import { buildRewriteRequest, makeRewriteResult } from './prompt.js';

// Runs in the extension page, not a web-page content script. Never substitutes a template.
// Chrome exposes this only on eligible browsers/devices. Feature detection is authoritative.
export const CHROME_AI_OPTIONS = Object.freeze({
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
});
export const CHROME_AI_UNAVAILABLE = 'Chrome AI is not available in this browser or on this device. Connect Claude in Settings for real rewriting. No template result will be generated.';

export async function chromeAiAvailability(api = globalThis.LanguageModel) {
  if (!api?.availability || !api?.create) return 'unavailable';
  try {
    const state = await api.availability(CHROME_AI_OPTIONS);
    return ['available', 'downloadable', 'downloading'].includes(state) ? state : 'unavailable';
  } catch { return 'unavailable'; }
}

export async function rewriteWithChrome(raw, preferences, {
  api = globalThis.LanguageModel, availability = 'unavailable', signal,
  onProgress = () => {}, onStage = () => {},
} = {}) {
  if (!api?.create || !['available', 'downloadable', 'downloading'].includes(availability)) throw new Error(CHROME_AI_UNAVAILABLE);
  const { system, user } = buildRewriteRequest(raw, preferences);
  // Download may take minutes; initialization and generation have separate time limits.
  const createSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(600000)]);
  let session;
  let overflow = false;
  try {
    // Do not await an availability check here: create must retain this click's user activation.
    session = await api.create({
      ...CHROME_AI_OPTIONS,
      initialPrompts: [{ role: 'system', content: system }],
      signal: createSignal,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          const loaded = Number(event.loaded);
          if (Number.isFinite(loaded)) onProgress(Math.round(Math.max(0, Math.min(1, loaded)) * 100));
        });
      },
    });
    signal?.throwIfAborted();
    onStage('Rewriting grammar, wording, and task-specific detail…');
    const generationSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(90000)]);
    const onOverflow = () => { overflow = true; };
    session.addEventListener?.('contextoverflow', onOverflow);
    // Some Chrome extension versions retain this legacy event name.
    session.addEventListener?.('quotaoverflow', onOverflow);
    const text = await session.prompt(user, { signal: generationSignal });
    generationSignal.throwIfAborted();
    if (overflow) throw new Error('Chrome AI ran out of context capacity. Shorten the prompt; the incomplete result was not applied.');
    return makeRewriteResult(raw, text, 'chrome-ai');
  } catch (error) {
    if (signal?.aborted) throw new Error('On-device rewrite canceled. No prompt was sent to a cloud provider.');
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('Chrome AI took too long. Try again or use Claude. No fallback template was generated.');
    if (error.name === 'NotAllowedError') throw new Error('Chrome did not allow model initialization. Keep this panel visible and click the download/rewrite button again.');
    if (error.name === 'NotSupportedError') throw new Error(CHROME_AI_UNAVAILABLE);
    if (error.name === 'QuotaExceededError') throw new Error('This prompt exceeds Chrome AI capacity. Shorten it or use Claude.');
    throw error;
  } finally {
    // Every request is independent: never retain another task's conversation history.
    try { session?.destroy(); } catch { /* Session may already be destroyed by abort. */ }
  }
}
