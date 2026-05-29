# Contributing to TabKan

Thanks for your interest in improving TabKan! This is a vanilla‑JS Chrome
extension (Manifest V3) — no build step, no framework. You can be productive in
minutes.

## Project layout

```
manifest.json        Extension manifest (MV3)
background.js        Service worker: context menu, tab/group event fan-out
popup.html / .js     Toolbar-icon menu (Dashboard / Side Menu)
fullpage.html        The full-page dashboard shell
src/                 Dashboard ES modules (loaded by fullpage.html):
  utils.js           Pure helpers + constants (escapeHtml, getFaviconUrl, ...)
  state.js           Shared state + transient UI flags
  dom.js             Cached element / dialog references
  bookmarks.js       Bookmark tree card
  tasks.js           Cross-tab task roll-up
  sessions.js        Save / restore / import-export of workspaces
  app.js             Entry: render engine, drag-and-drop, dialogs, wiring
sidepanel.html / .js Chrome side-panel variant (standalone)
styles.css           Dashboard styles
sidebar-styles.css   Side-panel styles
scripts/             Dev tooling (smoke test, visual preview mocks)
docs/                Design doc, architecture, audit, history
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the modules fit
together.

## Setup & checks

```sh
npm install        # installs jsdom (used by the smoke test)
npm run check      # node --check on every script + manifest JSON validity
npm run smoke      # loads the dashboard in jsdom with a mocked chrome.* and runs init()/render()
npm test           # both of the above
```

CI runs `npm run check` and `npm run smoke` on every PR. Please make sure both
pass locally first.

### Testing in a real browser

The smoke test verifies the modules load and render, but **not** interactive
behaviour. Before submitting UI changes, load the extension and try them:

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. After changes, click the reload icon on the TabKan card.

For quick visual iteration on CSS, `scripts/preview.html` and
`scripts/preview-sidepanel.html` render the markup with no extension context —
serve the folder (`python3 -m http.server`) and open them.

## Conventions

- **Security:** all user/tab/bookmark/session data rendered via `innerHTML`
  **must** be passed through `escapeHtml()`. Prefer `textContent` / DOM APIs for
  untrusted values. Treat imported session files as hostile.
- **Keep it clean:** remove dead code as you touch it; no leftover inert handlers.
- **Commits:** imperative subject line, a short body explaining the *why*.
- **Scope:** keep PRs focused; UI/behaviour changes should note how you tested them.

## Reporting bugs / requesting features

Use the issue templates. For anything security‑related, **do not** open a public
issue — see [`SECURITY.md`](SECURITY.md).
