# Verification — Prompt Polish 0.2.0

## What failed in 0.1

The previous tests verified that a deterministic template preserved the original text.
That behavior was the defect: the user wanted corrected grammar, proper English, and
meaningful enhancement, not raw typo-filled text under generic headings. Passing those
workflow checks did not establish product quality. The template engine is removed.

## Current automated evidence

- **31 unit tests:** shared rewriting contract (correct grammar, rewrite actual wording,
  relevant elaboration without invented user facts), bounded input/preferences,
  unchanged/wrapper rejection, Chrome AI availability/options/progress/cancellation/
  context-overflow/session cleanup, Claude transport, partial failures, output limits,
  and matched two-call comparisons. Contract tests check instructions, not live quality.
- **34 Chromium workflow checks:** real unpacked MV3 extension, service worker,
  runtime messages, trusted-context storage, upgrade-state migration, explicit model
  initialization, UI state, cancellation, no silent cloud fallback, key lifecycle,
  comparisons and plain-text rendering. See [full report](artifacts/browser-verification.json).
- **Actual native capability:** the test browser exposes `LanguageModel` but returns
  `unavailable` for the requested English text input/output. This is a genuine native
  probe, not a fixture. See [probe](artifacts/native-chrome-ai-capability.json).
- **No real model generation was performed.** Chrome did not have an available model;
  no browser flags were changed or large model download initiated. No personal Claude
  key was available or used. Grammar quality and semantic faithfulness remain unverified.
- **Accessibility:** zero automated axe WCAG A/AA violations in empty desktop, narrow
  populated panel, and Settings states. This is not a manual accessibility certification.
- **Responsive:** no horizontal overflow at 320 and 390 CSS pixels. Layout inspected at
  1440 pixels. Tests use extension-page viewports, not native sidebar chrome.
- **Static/packaging:** syntax, required manifest assets, no broad host permission,
  no remote scripts/eval/unsafe HTML/sync storage; runtime-only 0.2.0 ZIP integrity passes.
- **Traffic:** browser suite made zero real HTTP requests observed by Playwright.
  Model/network fixtures replace generation; this is not a claim about real model downloads.

## What is simulated

- Chrome's native model creation, progress, generation, unchanged response and cancellation
  after the separate real capability probe. Fixtures test the API integration, not AI skill.
- Anthropic transport in the real worker, including errors and cancellation.
- Native host-permission acceptance/removal and OS clipboard writes.
- Selected-text handoff uses real session storage; native toolbar/context-menu clicks
  are not automated. Restricted-page selection failure is exercised.

The screenshot-specific typo input appears only in tests, never as a special-case
production rewrite. Its expected rewritten output is a **test fixture**, not a live
model result. The [mechanical-prompt screenshot](artifacts/screenshots/rewritten-mechanical-fixture-1440.png)
includes that warning. Other generated result/comparison screenshots also use fixtures.
The [unsupported-browser screenshot](artifacts/screenshots/real-capability-1440.png)
shows the actual detected state.

## Live acceptance checklist — still pending

1. Update/reload in current desktop Chrome, saving drafts first. Check native toolbar,
   side panel, context menu, actual clipboard, keyboard and screen-reader behavior.
2. On an eligible device, explicitly allow the model download and run real Chrome AI.
   Verify progress, response time, cancellation, session cleanup and context-limit errors.
3. With a user's personal Claude key and native permission dialog, verify an available
   model, then perform one rewrite and one comparison. Confirm actual transport and billing.
4. Evaluate typo-heavy writing, mechanical image-identification prompts, coding tasks,
   constraints, multilingual requests, and already-clear prompts. Check:
   - Original sentences really are corrected and rewritten in natural English.
   - Added detail is relevant, not the same generic padding for every task.
   - Explicit names, numbers, constraints, code and user intent survive.
   - Tone affects the prompt's language; no invented context or unseen-image analysis.
   - A prompt is returned, not an answer to its task.
5. The screenshot example should request the engineering names, functions/applications,
   visible identification evidence, and uncertainty handling in clear English. It should
   not identify images the extension has not received or invent dimensions/materials.
6. Inspect session-only versus remembered keys across a real browser restart and verify
   native API access removal. Session storage is not an archive; reload clears it.
7. Before publication, supply publisher/contact/privacy URL, complete store disclosures,
   and perform a security/quality review. No Web Store submission has occurred.

The unchanged/wrapper guard catches obvious non-rewrites only. It is not a grammar or
semantic evaluator and intentionally rejects identical already-clear prompts as unchanged.

## Reproduce

From the project folder: `npm ci`, `npx playwright install chromium`, `npm test`,
`npm run check`, `npm run test:browser`, and `npm run package`. Tests use a disposable
browser profile. No unrelated workspace application was modified.
