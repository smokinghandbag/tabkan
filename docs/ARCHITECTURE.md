# Architecture

TabKan is a Manifest V3 Chrome extension written in vanilla JavaScript — no
build step, no framework. There are three runtime surfaces, all driven by
Chrome's `tabs`, `tabGroups`, `bookmarks`, `storage`, and `sidePanel` APIs.

## Surfaces

| Surface | Files | Role |
|---|---|---|
| Service worker | `background.js` | Context menu, opens/focuses the dashboard, debounced "re-render" messages to the dashboard on tab/group events, auto-collapse. |
| Toolbar popup | `popup.html`, `popup.js` | Small menu: **Dashboard** / **Side Menu**. Set via `action.default_popup`. |
| Dashboard | `fullpage.html` + `src/*.js` + `styles.css` | The full-page Kanban board (primary surface). |
| Side panel | `sidepanel.html`, `sidepanel.js`, `sidebar-styles.css` | A lightweight, self-contained tab list for the Chrome side panel. |

## Dashboard modules (`src/`)

The dashboard was refactored from a single ~3,000-line IIFE into ES modules
(loaded via `<script type="module" src="src/app.js">`).

```
utils.js     Pure helpers + constants: escapeHtml, getFaviconUrl, log/DEBUG,
             timing/layout constants, CHROME_GROUP_COLORS. No DOM/chrome deps.
state.js     `state`  – persisted data (mirrored to chrome.storage)
             `ui`     – transient cross-module flags/values (searchTerm,
                        activeTagFilters, isWakingTab, currentSessionToLoad, ...)
dom.js       Cached element + dialog references (getElementById at module load).
bookmarks.js Bookmark folder tree card + dirty-flagged re-render.
tasks.js     Aggregates to-dos across all tabs into the roll-up card.
sessions.js  Capture / save / restore / import-export of full workspaces.
app.js       Entry module. Owns the render engine, drag-and-drop, the dialog
             layer, persistence (saveData), tab-order enforcement, and all
             top-level event wiring; calls init() at the end.
```

### Why `state.ui`

ES module bindings can't be reassigned across module boundaries, so values that
multiple modules read **and write** (e.g. `searchTerm`) live as properties on the
exported `ui` object. Render-engine-local flags (`isRendering`, `isDragging`,
timers) stay private to `app.js`.

### Data flow

1. A tab/group/bookmark event fires → `background.js` sends a debounced `render`
   message (or a bookmark listener fires inside `app.js`).
2. `render()` queries Chrome for the current tabs/groups, buckets tabs by group,
   and rebuilds the board. It reuses that one tab query for the task roll-up and
   only rebuilds bookmarks when they (or the search term) changed.
3. Drag-and-drop updates the real Chrome tab order via `chrome.tabs.move`/`group`,
   and optimistically moves the DOM node so the UI tracks the drop immediately.

Per-tab metadata (title, tags, notes, to-dos) is keyed by URL in
`chrome.storage.sync`, so it persists across close/reopen.

## Verification

There is no automated UI test, but `scripts/smoke.mjs` loads `fullpage.html` in
jsdom with a mocked `chrome.*`, imports `src/app.js`, and runs `init()`/`render()`
plus a few interactions — catching import/TDZ/undefined-reference errors. It runs
in CI alongside `node --check` on every script.
