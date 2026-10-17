# Prompt Polish 0.2 — actual AI rewriting, not templates

## Why 0.1 did not meet the request

The initial default mode copied the original prompt verbatim and appended generic
instructions. It did not correct grammar or spelling, rewrite awkward English, or
supply meaningful task-specific context. Its Tone control only instructed the eventual
answering model. Passing UI tests did not establish that it actually enhanced prompts.
The user's screenshot exposed that mismatch. **The template generator is now removed.**

## What changed

- Both rewrite paths use a language model to edit the actual sentences: spelling,
  grammar, punctuation, capitalization, phrasing, and useful task-specific elaboration.
- The selected tone applies to the rewritten prompt itself. English is the default,
  unless the task explicitly requests another language.
- Added detail should clarify the task, not invent budgets, timelines, industry,
  audience, or facts about unseen attachments. Code, names and explicit constraints
  must be preserved. Review model output; these instructions are not a guarantee.
- No copied-original `Task / Approach / Output` fallback remains. Identical outputs
  and the old copied-input wrapper pattern are rejected rather than called enhanced.
- Saved legacy wrapper results are invalidated when restored; the original input remains
  available if Chrome has retained the session. Chrome reload itself clears session storage.
- The output checklist is labeled **Review the rewrite**, not a claim of verified changes.

## Install or update

1. **Copy any draft you want to keep before reloading**; Chrome extension session storage
   is cleared by reload/update.
2. If loading the workspace [extension folder](extension/), open `chrome://extensions`
   and click **Reload** on Prompt Polish. Close old extension tabs/panel, then reopen it.
3. If loading a separate extracted copy, replace it with the contents of the
   [0.2.0 ZIP](artifacts/prompt-polish-0.2.0.zip), then reload that installation.
4. For a new installation, enable Developer mode, click Load unpacked, and select the
   folder containing the manifest. No build/server is needed.
5. The extension card should show **0.2.0**; the editor should offer **Chrome AI** and
   **Claude**, not the old rule-based On-device mode.

Desktop Chrome 116+ can load the extension for Claude use; Chrome AI support requires
newer Chrome and eligible hardware. Use current Chrome and rely on the availability
status displayed by the extension, not only the version number.

## Choose an actual rewrite engine

### Chrome AI — no API key, only on supported browsers/devices

The extension uses Chrome's built-in `LanguageModel` Prompt API. It checks availability
without starting a session or downloading a model. On supported devices:

- **Available:** Rewrite my prompt creates a fresh on-device model session.
- **Downloadable:** Download Chrome AI & rewrite explicitly authorizes initialization
  and the browser-managed model download, which can use several GB of disk space/data.
- **Downloading:** the UI reports progress when the native API supplies it.
- **Unavailable:** the UI says so and directs the user to Claude setup. It does not
  generate a fake result or silently send text to a paid cloud model.

Prompt text is processed on-device; Chrome handles model distribution. No remote code,
model download URL, or additional website permission is embedded in the extension.
See [official Chrome Prompt API requirements](https://developer.chrome.com/docs/ai/prompt-api).
The fresh test browser exposed the API but returned **unavailable**. Actual on-device
model generation and quality are therefore **not verified here**.

### Claude — your API key

1. Open Settings and enter a personal key from [Anthropic Console](https://console.anthropic.com/).
   A Claude chat subscription does not include API usage. Do not put keys in source or chat.
2. Save and approve Chrome's optional access to `api.anthropic.com`.
3. Verify connection to retrieve model IDs accessible to your account. Choose a model
   from the suggestions and save if the starting model is unavailable.
4. Select Claude and click **Send to Claude & rewrite**. This sends the prompt and
   preferences directly to Anthropic and makes one billable generation request.

The editable starting model is `claude-haiku-4-5-20251001`; provider availability can
change. No live API key or paid request was used for this update. Live provider access,
output quality, latency and billing are not verified.

## Response comparison

After producing and reviewing a rewrite, check the consent box and select Compare with
Claude. The original and edited rewritten prompt are answered by the same model in two
separate calls, with the same system instruction and an 800-token output limit each.
There is no third judge call, fake quality score, or guarantee that longer is better.
The exact prompts, usage and incomplete/error states are visible. Claude receives no
images, browsing tools, website conversations, or code-execution tools from this extension.

## Other behavior

- Type/paste or explicitly import selected text. Right-click selection → Polish this
  prompt, or invoke the toolbar icon and use Use selected text. Restricted pages/frames
  may require paste. Nothing is automatically inserted into or submitted on a website.
- Examples/selection imports clear old audience/context to prevent unrelated facts
  carrying into a new task. Tone and format remain.
- Editing input/preferences marks a rewrite stale and blocks comparison until regenerated.
  Editing either prompt invalidates previous comparison results.
- Ctrl/Command + Enter triggers the same explicit operation as the main button.
- Output remains editable and copyable. No model output is interpreted as HTML.
- Fresh model sessions avoid cross-task history. On-device sessions are destroyed after
  success/failure; Cancel and closing the extension page abort its local request.

## Limits and privacy

Original: 12,000 characters; context: 3,000; audience: 200; output editor: 24,000.
Claude rewrite: 2,400 output tokens, 25-second request timeout; comparison: 800 tokens
per answer. No automatic retry. Cancellation/timeouts do not guarantee provider billing
stops. On-device initialization: up to 10 minutes including downloads; generation:
90 seconds. Native context overflow causes rejection, not silent success.

Keys default to trusted extension session storage; Remember explicitly uses local storage,
not sync. Storage is not an encrypted vault. Drafts/results also use session storage and
clear on restart/reload/disable/update. Clear workspace removes drafts/results, not keys.
Remove key & access removes both key copies and revokes optional provider access.
Use one editor at a time: the side panel and full tab share one session workspace.
See [privacy and permission details](PRIVACY.md).

## Verification boundary

See [verification](VERIFICATION.md), the [browser report](artifacts/browser-verification.json),
and [native capability probe](artifacts/native-chrome-ai-capability.json).
Automated tests check routing, payloads, state, consent, rejection, cancellation, and
security. **Mock model output does not prove good grammar or semantic enhancement.**
The user's exact screenshot input is a regression fixture, not a hardcoded runtime answer.

- [Actual unsupported-browser state](artifacts/screenshots/real-capability-1440.png)
- [Mechanical-prompt UI with explicitly simulated output](artifacts/screenshots/rewritten-mechanical-fixture-1440.png)
- [Connection settings](artifacts/screenshots/settings-1440.png)

### Live quality acceptance still required

Test typo-heavy emails, technical identification, coding prompts, explicit constraints,
non-English requests, and already-clear prompts using a real selected model. For the
mechanical-component example: correct the English, ask for proper engineering names
and function, add relevant identification evidence/uncertainty, do not identify unseen
images, and do not invent material/dimensions. Review factual preservation, not length.
The current unchanged-output check intentionally rejects identical text even for an
already-clear prompt; it is a simple non-rewrite guard, not a semantic quality evaluator.

## Development

Zero production npm dependencies. From this project folder:

```sh
npm ci
npx playwright install chromium
npm test
npm run check
npm run test:browser
npm run package
```

Tests use a disposable Chromium profile. Packaging uses system `zip` and only includes
runtime extension files; model fixtures and tests never ship.

- [Shared rewrite contract and guards](extension/lib/prompt.js)
- [Chrome AI integration](extension/lib/chrome-ai.js)
- [Claude client](extension/lib/claude.js)
- [Panel controller](extension/panel.js)
- [Background worker](extension/background.js)
- [Manifest](extension/manifest.json)

This is an unpacked extension, not a published Web Store product. Publication still needs
owner/contact/privacy URL, permission disclosures, live model evaluation, and security
review. Never distribute a shared embedded API key. Existing workspace apps are unchanged.
