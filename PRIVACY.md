# Prompt Polish privacy and permissions

Version 0.2.0. This document describes the unpacked extension in this workspace.
It is a technical disclosure, not a claim of Chrome Web Store approval.

## Data flows

**Chrome AI:** on eligible browsers/devices, the extension sends the text and editing
instructions to Chrome's on-device language model, not a cloud generation service.
Chrome may need to download its model; the extension starts initialization only after
the user clicks the explicitly labeled download/rewrite button. That download uses
network bandwidth and disk space managed by Chrome. Availability checks alone do not
start a model session. Chrome's browser-level distribution policies apply. There is no
developer-operated model host, analytics service, or silent paid-cloud fallback.

The old deterministic template generator is removed. Without a supported local model
or connected Claude key, the extension cannot rewrite and says so explicitly.

**Claude rewrite:** pressing the explicitly labeled send button transmits the original
prompt, optional audience/context/tone/format, a rewriting instruction, model ID, and
output-token limit directly to Anthropic. It authenticates with the user's own API key.

**Claude comparison:** after checking consent and pressing Compare, the original prompt
and edited improved prompt are sent as two independent Anthropic requests. The improved
prompt can contain any context the user incorporated. No third evaluator request is sent.

**Connection verification:** pressing Verify makes an authenticated models-list request
to Anthropic. It does not send a prompt or request text generation.

Anthropic necessarily receives connection metadata including the user's IP address.
Its current [privacy policy](https://www.anthropic.com/legal/privacy) and API terms apply.
Prompt Polish cannot delete information already transmitted to Anthropic or guarantee
provider-side cancellation, retention, accuracy, or billing behavior.

## Storage

- Browser session storage: current prompt, preferences, improved prompt, comparison
  answers, model usage metadata, pending explicitly selected text, and session-only key.
- Local storage: selected model ID and the API key only when Remember is explicitly on.
- No Chrome sync storage, developer database, telemetry, or automatic history archive.
- Keys are never sent back in settings-read responses, rendered into saved source files,
  embedded in prompts, or logged by this extension.
- Local and session storage are limited to trusted extension contexts, not page scripts.
- Storage is not a secure encrypted credential vault. A compromised device, browser,
  extension, or privileged debugger can expose it. Use individual revocable keys.
- On-device model sessions are fresh for each task and destroyed after completion or
  failure. Chrome manages downloaded model storage independently of extension drafts;
  Clear workspace does not uninstall Chrome's model.

Clear workspace removes the session prompt/results. Remove key & access removes keys
from both local and session storage and requests removal of the API host permission.
Browser restart/reload/disable/update clears session storage. Uninstall removes extension
storage, but cannot retract network requests, clipboard copies, or copies saved elsewhere.

## Permissions and why they exist

- **storage:** session drafts/results and opt-in provider connection settings.
- **sidePanel:** persistent editor beside the user's active page.
- **contextMenus:** user-initiated Polish this prompt selection action.
- **activeTab:** temporary access after explicit toolbar/context-menu interaction.
- **scripting:** reads only the selected text on the active page when requested.
- **Optional api.anthropic.com access:** requested only while saving a Claude connection.

There is no broad all-sites host permission, persistent content script, browsing-history
permission, cookie permission, or clipboard-read permission. Clipboard writes occur only
when the user clicks Copy. No prompt is automatically submitted to a website.

## Distribution

The current package is intended for local installation. Before public distribution,
the publisher must supply a public contact and policy URL, verify this disclosure against
the final package, and complete Chrome Web Store privacy/permission disclosures.