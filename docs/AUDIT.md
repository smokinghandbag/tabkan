# TabKan v4.4 — Bug & Optimization Audit
**Date:** 2026-05-29
**Scope:** fullpage.js (3150), background.js (200), sidepanel.js (522), styles.css (2215), manifest.json
**Method:** 3 parallel reviewers (correctness / security / performance); top findings verified against source.

---

## TL;DR — fix in this order
1. **XSS is NOT fixed.** The v4.3 report's `escapeHtml()` was added but applied only to the bookmark path. ~9 `innerHTML` sinks still interpolate raw tab/group/todo/session data. A malicious page **title** or a shared **session JSON** = code execution with extension privileges. (SEC-1…9)
2. **`escapeHtml()` doesn't escape quotes** — so even the "fixed" bookmark attributes (`data-bookmark-url="..."`) are still attribute-breakout-able. (SEC-10)
3. **`state.sleepingTabs` can be undefined → crash.** Not in the initial state literal (line 135); an early background `render()` before `init()` throws. (BUG-1)
4. **Search calls full `render()` on every keystroke** — which also runs `enforceTabOrder()` (tab moves + 2 storage writes). Major jank. (PERF-1/2)
5. **Search permanently destroys collapsed-card state.** (BUG-2)
6. **Dragging a bookmark/folder to the bin is dead code** — silently does nothing. (BUG-3)
7. **sidepanel.js has no escaping at all** and re-renders fully on every tab switch. (SEC-9 / PERF-6)

---

## 🔴 SECURITY (XSS) — all CONFIRMED live unless noted

Threat model: `tab.title` is fully attacker-controlled (any page sets `document.title`). Bookmark titles/URLs, notes, tags, todos, group names, and **imported session name/description** are user- or file-controlled. All render inside the extension page, which holds `tabs`/`bookmarks`/`tabGroups`/`storage` access.

| # | File:line | Unescaped value(s) | Notes |
|---|-----------|--------------------|-------|
| SEC-1 | fullpage.js:1822 | `${title}` (tab title), `${tag}`, `${notes}`, favicon `src` (1820) | **Zero-click:** open a page with `<title><img src=x onerror=…></title>`. |
| SEC-2 | fullpage.js:1933, :1940 | `${group.title}` | Group name; also restored verbatim from imported sessions. |
| SEC-3 | fullpage.js:667, :670, :669, :664 | `task.text`, `task.tabTitle`, `task.tabFavicon` (src), `task.tabUrl` (attr) | Task roll-up. |
| SEC-4 | fullpage.js:1463 | `${todo.text}` | Todo edit dialog. |
| SEC-5 | fullpage.js:1300 | `${tag}` (text + `data-tag` attr) | Tag chips. |
| SEC-6 | fullpage.js:2611, :2613 | `${tag}` | Tag Manager. |
| SEC-7 | fullpage.js:2435, :2440 | `session.name`, `session.description` | **From imported JSON.** `importSession` (491) validates presence only, no sanitization. Highest-value attacker path: shared "session file" → RCE-in-extension. |
| SEC-8 | fullpage.js:1098 | `task.text` | Task-warning dialog. |
| SEC-9 | sidepanel.js:347–350 | `${title}`, `${favicon}` | **`escapeHtml` is not even defined in sidepanel.js.** Same privilege context. |

**SEC-10 — `escapeHtml()` is text-context only (fullpage.js:15).** `textContent → innerHTML` does **not** encode `"` or `'`. Every attribute use (e.g. `data-bookmark-url="${escapeHtml(...)}"` at :911) is still breakout-able with a `"` → inject `onmouseover=…`. **This is a residual hole in the already-"fixed" bookmark path.**
**Fix:** make `escapeHtml` also replace `"`→`&quot;`, `'`→`&#39;`; or use `setAttribute`/`dataset`/`createElement` for attributes & URLs instead of string interpolation.

**Favicon URLs (SEC-1/3, sidepanel:348):** raw URL into `src="${…}"`. The repo already has the safe `getFaviconUrl()` (fullpage.js:23) but these sites bypass it. Route through it or whitelist `http(s):`.

**Other security notes (not XSS):**
- **CDN without SRI** (fullpage.html:5–6, sidepanel.html:7): Google Fonts + Font Awesome loaded as remote `<link>` with no integrity hash. For an extension, **bundle them locally** (also lets you tighten CSP).
- **CSP** (manifest.json:17): `script-src 'self'; object-src 'self'` correctly blocks injected `<script>` (good backstop) but has no `default-src`/`img-src`. Add `default-src 'self'`.
- **Permissions:** appropriate; `host_permissions` is narrow (google.com favicons). No `eval`/`Function`/`setTimeout(string)`/data-built inline handlers found — clean.

---

## 🟠 CORRECTNESS BUGS — verified

- **BUG-1 (HIGH) — `state.sleepingTabs` undefined → crash.** Initial state literal (fullpage.js:135) omits `sleepingTabs`; it's only set in `init()`. Code reads `state.sleepingTabs.filter(...)` (722, 2270, 2554, 2603, 2657). A background `render()` ("render" message, ~1184) firing before `init()` completes throws `Cannot read properties of undefined`. **Fix:** add `sleepingTabs: []` to line 135.
- **BUG-2 (HIGH) — search destroys collapse state.** fullpage.js:1708 sets `state.collapsedCards[group.id] = false` to force-expand a match — a **permanent** mutation. After clearing search (and on next `saveData`), the user's collapsed cards are lost. **Fix:** track temp expansions in a transient Set, don't mutate persisted state.
- **BUG-3 (MED) — bin-delete for bookmarks/folders is dead.** Bin handler reads `getData('bookmarkId')` (3116) / `getData('folderId')` (3127), but the bookmark `dragstart` (1049) only sets `text/plain` (a JSON blob) + `item-type` — never a `bookmarkId` key, and there's no folder dragstart at all. Both deletions silently no-op. **Fix:** parse the JSON `text/plain` payload in the bin handler (and add a folder dragstart).
- **BUG-4 (MED) — sidebar drop off-by-one / end-drop no-op.** sidepanel.js:293–300 has no end-of-list handling: dropping at the bottom of a group leaves `targetWindowIndex = -1` and the move is skipped. fullpage.js same-group reorder (2155, 2179) is also susceptible to the classic "lands one slot off" when moving a tab downward (own removal shifts indices).
- **BUG-5 (MED) — `isEnforcingTabOrder` is a boolean, not a refcount.** Two overlapping `enforceTabOrder` runs: the second's `finally` clears the flag while the first is still moving → background `onMoved` fires → render→enforce→move feedback churn. **Fix:** refcount or dedicated in-flight guard.
- **BUG-6 (MED) — sidepanel listener leak.** `setupMessageListeners` (sidepanel.js:491) adds tabs/tabGroups/storage listeners on every `initSidebar` with no removal → N× redundant re-renders per event over a session. **Fix:** install-once guard.
- **BUG-7 (LOW) — dead message.** fullpage.js sends `{action:"updateAutoCollapseGroups"}` but background's `onMessage` (149) only handles `toggleSidePanel`; silently dropped (works anyway via storage re-read). Remove or handle.
- **BUG-8 (LOW) — `error.message.includes(...)` in background.js (52, 129, 194)** assumes `.message` exists; a non-Error throw makes the catch itself throw. fullpage.js:2824 already guards; background.js doesn't.
- **BUG-9 (LOW) — task roll-up checkbox** toggles `!model.completed` instead of reading `e.target.checked` (fullpage.js:~714); inverts if DOM/model diverge. Also `aggregateAllTasks` keys by `tab.url`, double-counting duplicate-URL tabs (561).

---

## 🟡 PERFORMANCE — verified hot paths

The core problem: **every** chrome.tabs/tabGroups event → full teardown + rebuild of the board, re-query of all tabs/groups/bookmarks, re-aggregate of all tasks, re-attach of hundreds of listeners. No incremental path.

- **PERF-1 (HIGH) — search re-renders on every keystroke.** fullpage.js:2742 `input` handler calls `render()` with no debounce. Typing "github" = 6 full rebuilds (each: 2 chrome queries + storage writes + full DOM + bookmark tree + task aggregation). **Fix:** debounce 150–250ms; better, filter existing DOM by toggling `display` (as sidepanel.js does) and never hit Chrome APIs from search.
- **PERF-2 (HIGH) — `enforceTabOrder()` runs inside every `render()`** (1621): sets flag, queries tabs, may `chrome.tabs.move` in a loop, **2× `chrome.storage.local.set` even when nothing moved.** On the search/event hot path. **Fix:** compute `needsReordering` first; run only on real create/move events, debounced; skip storage writes when no-op.
- **PERF-3 (HIGH) — full `replaceChildren` rebuild + per-element listeners.** Each tab attaches ~5 listeners, each card ~6, every render (1639). A single tab title change rebuilds the whole board. **Fix:** event delegation on `cardsContainer` (already done for `.open-tab-btn` at 1161 — extend it); diff/patch per group instead of nuking the container.
- **PERF-4 (HIGH) — bookmarks + tasks rebuilt on every render.** `renderBookmarks` (rebuilds full tree via innerHTML + per-item listeners) and `aggregateAllTasks` (another `chrome.tabs.query({})`) run on unrelated tab events (1776). **Fix:** gate behind dirty flags — only re-render bookmarks on bookmark events, re-aggregate tasks only when metadata changed.
- **PERF-5 (MED) — O(groups × tabs) filtering;** `shouldShowItem` runs twice per tab (1488 in `.some()` and 1950 in card build); `searchTerm.toLowerCase()` recomputed per item. **Fix:** single bucketing pass, precompute `searchLower`.
- **PERF-6 (MED) — sidepanel full re-render on every tab event incl. `onActivated`** (491), no debounce. Every tab switch anywhere rebuilds the panel. **Fix:** debounce; toggle `.active` class instead of rebuild.
- **PERF-7 (LOW)** — `console.log` (not gated `log()`) on the render message path (1186); `setInterval(checkExtensionContext,5000)` never cleared (1231); `transition: all` + width/max-height transitions across styles.css force per-frame reflow during collapse animations; live `getBoundingClientRect` reads during dragover (1846) cause drag thrash.

---

## Suggested remediation sequence
1. **Security pass:** quote-aware `escapeHtml`; escape all 9 sinks; add `escapeHtml` to sidepanel.js; route favicons through `getFaviconUrl`; treat `importSession` input as hostile. Bundle CDN assets locally + add `default-src 'self'`.
2. **Crash + data-loss:** BUG-1 (one line), BUG-2.
3. **Perf quick wins:** debounce search & remove `enforceTabOrder` from it (PERF-1/2); dirty-flag bookmarks/tasks (PERF-4); debounce sidepanel (PERF-6).
4. **Structural:** event delegation + diff rendering (PERF-3); bin-delete fix (BUG-3); listener-leak + refcount guards (BUG-5/6).
