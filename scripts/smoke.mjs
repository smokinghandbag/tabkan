// Smoke test for the modularized TabKan dashboard.
// Loads the real fullpage.html in jsdom, mocks chrome.*, imports the entry
// module, and lets init()/render() run. Any thrown error (import resolution,
// TDZ, undefined reference, etc.) fails the test.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPO = process.argv[2];
if (!REPO) { console.error('usage: node smoke.mjs <repo-path>'); process.exit(2); }

const html = readFileSync(`${REPO}/fullpage.html`, 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://localhost/' });
const { window } = dom;

// --- chrome.* mock -------------------------------------------------------
const listener = () => ({ addListener() {}, removeListener() {} });
const tabsData = [
  { id: 10, url: 'https://example.com/', title: 'Example', index: 1, groupId: 1, windowId: 1, favIconUrl: 'https://example.com/f.ico', active: true, pinned: false },
  { id: 11, url: 'https://news.ycombinator.com/', title: 'HN <b>x</b>', index: 2, groupId: -1, windowId: 1, favIconUrl: '', active: false, pinned: false },
];
const groupsData = [{ id: 1, title: 'Work "set" <x>', color: 'blue', collapsed: false, windowId: 1 }];
const chrome = {
  runtime: {
    id: 'smoke',
    lastError: undefined,
    getURL: (p) => `chrome-extension://smoke/${p}`,
    onMessage: listener(),
    sendMessage() {},
  },
  tabs: {
    getCurrent: async () => ({ id: 99, url: 'chrome-extension://smoke/fullpage.html', windowId: 1, index: 0 }),
    query: async () => tabsData.map(t => ({ ...t })),
    get: async (id) => ({ ...(tabsData.find(t => t.id === id) || tabsData[0]) }),
    update: async (id, props) => { tabsData._updates = tabsData._updates || []; tabsData._updates.push({ id, props }); },
    move: async () => {}, remove: async () => {},
    group: async () => 1, ungroup: async () => {}, create: async () => ({ id: 500, index: 9 }),
    onCreated: listener(), onRemoved: listener(), onUpdated: listener(),
    onMoved: listener(), onActivated: listener(),
  },
  tabGroups: {
    TAB_GROUP_ID_NONE: -1,
    query: async () => groupsData.map(g => ({ ...g })),
    update: async () => {}, move: async () => {},
    onCreated: listener(), onRemoved: listener(), onUpdated: listener(),
  },
  storage: {
    sync: { get: async () => ({}), set: async (obj) => { chrome.storage.sync._writes.push(obj); } },
    local: { get: async () => ({}), set: async () => {} },
    onChanged: listener(),
  },
  bookmarks: {
    getTree: async () => ([{ id: '0', title: '', children: [
      { id: '1', title: 'Bookmarks Bar', index: 0, children: [
        { id: '5', title: 'Folder <x>', index: 0, parentId: '1', children: [
          { id: '6', title: 'Bm "q"', url: 'https://a.test/', index: 0, parentId: '5' },
        ] },
      ] },
      { id: '2', title: 'Other Bookmarks', index: 1, children: [] },
    ] }]),
    create: async () => ({ id: 'x' }), remove: async () => {}, removeTree: async () => {},
    onCreated: listener(), onRemoved: listener(), onChanged: listener(), onMoved: listener(),
  },
  windows: { WINDOW_ID_CURRENT: -2, getCurrent: async () => ({ id: 1 }), update: async () => {}, create: async () => ({ id: 2 }) },
  // (storage.sync._writes initialized below)
  contextMenus: { create() {}, onClicked: listener() },
  sidePanel: { open: async () => {}, setPanelBehavior: async () => {} },
  action: { onClicked: listener() },
};

chrome.storage.sync._writes = [];

// --- install globals the module expects ----------------------------------
let rafId = 0;
const errorsRAF = [];
Object.assign(window, {
  chrome,
  requestAnimationFrame: (cb) => { setTimeout(() => { try { cb(performance.now ? performance.now() : Date.now()); } catch (e) { errorsRAF.push(e); } }, 0); return ++rafId; },
  cancelAnimationFrame: () => {},
  confirm: () => true,
  alert: () => {},
});
globalThis.window = window;
globalThis.document = window.document;
globalThis.chrome = chrome;
try { globalThis.location = window.location; } catch {}
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
// Use jsdom's AbortController so signals passed to jsdom's addEventListener match
// its realm (Node's global AbortSignal is a different type and jsdom rejects it).
if (window.AbortController) globalThis.AbortController = window.AbortController;
if (typeof globalThis.Blob === 'undefined') globalThis.Blob = window.Blob;

// Surface async errors
const errors = [];
window.addEventListener('error', (e) => errors.push(e.error || e.message));
process.on('unhandledRejection', (r) => errors.push(r));

// --- run -----------------------------------------------------------------
try {
  await import(pathToFileURL(`${REPO}/src/app.js`).href);
  // let init()/render() microtasks + any timers settle
  await new Promise(r => setTimeout(r, 300));
} catch (err) {
  console.error('IMPORT/EXEC ERROR:\n', err);
  process.exit(1);
}

if (errors.length) {
  console.error(`RUNTIME ERRORS (${errors.length}):`);
  for (const e of errors.slice(0, 8)) console.error(' -', e && e.stack ? e.stack.split('\n').slice(0,3).join('\n') : e);
  process.exit(1);
}

// Exercise more cross-module paths: search render, sessions dialog, tag manager.
const fire = (el, type) => el && el.dispatchEvent(new window.Event(type, { bubbles: true }));
const doc = window.document;

// v5.5.0: ungrouped tabs render as a column in the main grid (checked on the
// initial, unfiltered render — the fixture has one ungrouped tab, id 11).
{
  const ungrouped = doc.querySelector('#cards-container .card[data-card-id="unfiled"]');
  console.log(`ungrouped column in grid: ${!!ungrouped}`);
  if (!ungrouped) { console.error('FAIL: ungrouped tabs should render as a grid column'); process.exit(1); }
}

try {
  const search = doc.getElementById('search-input');
  if (search) { search.value = 'example'; fire(search, 'input'); }
  await new Promise(r => setTimeout(r, 400)); // debounced render
  // Sessions now opens from inside Settings (Block 3).
  fire(doc.getElementById('settings-btn'), 'click');       // open settings dialog
  fire(doc.getElementById('open-sessions-btn'), 'click');  // → sessions.js renderSessions
  fire(doc.getElementById('tag-manager-btn'), 'click');    // tag manager (now inline w/ filters)
  // exercise tag-manager add (Enter) — this path previously called a now-removed helper
  const tmInput = doc.getElementById('tag-manager-input');
  if (tmInput) { tmInput.value = 'smoke-tag'; tmInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
  fire(doc.getElementById('toggle-all-cards-btn'), 'click');
  await new Promise(r => setTimeout(r, 200));
} catch (err) {
  console.error('INTERACTION ERROR:\n', err);
  process.exit(1);
}
if (errors.length) {
  console.error(`RUNTIME ERRORS after interaction (${errors.length}):`);
  for (const e of errors.slice(0, 8)) console.error(' -', e && e.stack ? e.stack.split('\n').slice(0,4).join('\n') : e);
  process.exit(1);
}
await new Promise(r => setTimeout(r, 50)); // let rAF callbacks flush
if (errorsRAF.length) {
  console.error(`ERRORS inside requestAnimationFrame callbacks (${errorsRAF.length}):`);
  for (const e of errorsRAF.slice(0, 8)) console.error(' -', e && e.stack ? e.stack.split('\n').slice(0,4).join('\n') : e);
  process.exit(1);
}
const sessionsList = doc.querySelector('#sessions-list .empty-sessions, #sessions-list .session-card');
console.log(`sessions dialog rendered: ${!!sessionsList}`);

// Assert render actually populated the board
// At this point a search filter ('example') is active, so only matching cards
// show — just assert the board populated.
const cards = window.document.querySelectorAll('#cards-container .card, #cards-container .create-card-link');
const bookmarks = window.document.querySelectorAll('#bookmarks-card-container .bookmarks-sidebar-card');
console.log(`render output (filtered): cardsContainer children=${cards.length}, bookmarksCard=${bookmarks.length}`);
if (cards.length === 0) {
  console.error('FAIL: render did not populate the board');
  process.exit(1);
}

// --- Block 1: tile click-zone behaviour (v5.1 model) --------------------
// Clear the search filter from earlier so tiles are visible again.
try {
  const search = doc.getElementById('search-input');
  if (search) { search.value = ''; fire(search, 'input'); }
  await new Promise(r => setTimeout(r, 400));

  const clickAt = (el) => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));

  const firstTile = doc.querySelector('#cards-container .tab-item');
  if (!firstTile) { console.error('FAIL: no tab-item rendered to click'); process.exit(1); }

  // (a) Clicking the tile BODY (title) must NOT open the tab anymore.
  tabsData._updates = [];
  firstTile.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
  firstTile.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 5, clientY: 5 }));
  clickAt(firstTile.querySelector('.title') || firstTile);
  await new Promise(r => setTimeout(r, 50));
  const bodyOpened = (tabsData._updates || []).some(u => u.props && u.props.active === true);
  console.log(`tile body is inert (no open): ${!bodyOpened}`);
  if (bodyOpened) { console.error('FAIL: clicking the tile body should not open the tab'); process.exit(1); }

  // (b) Clicking the go-to (⇗) hover action opens/switches to the tab.
  tabsData._updates = [];
  const gotoBtn = firstTile.querySelector('.tab-goto');
  if (!gotoBtn) { console.error('FAIL: no .tab-goto action on tile'); process.exit(1); }
  firstTile.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
  firstTile.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 5, clientY: 5 }));
  clickAt(gotoBtn);
  await new Promise(r => setTimeout(r, 50));
  const openedViaGoto = (tabsData._updates || []).some(u => u.props && u.props.active === true);
  console.log(`go-to action opens tab: ${openedViaGoto}`);
  if (!openedViaGoto) { console.error('FAIL: go-to action did not activate the tab'); process.exit(1); }

  // (c) A drag gesture (pointer moved > threshold) must suppress the go-to click.
  tabsData._updates = [];
  firstTile.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
  firstTile.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 40, clientY: 5 }));
  clickAt(gotoBtn);
  await new Promise(r => setTimeout(r, 50));
  const openedAfterDrag = (tabsData._updates || []).some(u => u.props && u.props.active === true);
  console.log(`drag gesture suppressed click: ${!openedAfterDrag}`);
  if (openedAfterDrag) { console.error('FAIL: drag gesture wrongly opened the tab'); process.exit(1); }
} catch (err) {
  console.error('TILE INTERACTION ERROR:\n', err);
  process.exit(1);
}
if (errors.length) {
  console.error(`RUNTIME ERRORS after tile interaction (${errors.length}):`);
  for (const e of errors.slice(0, 8)) console.error(' -', e && e.stack ? e.stack.split('\n').slice(0,4).join('\n') : e);
  process.exit(1);
}

// --- Block 2: search clear (×) + empty state ----------------------------
// (the redundant filter-status bar was removed; tag filters + the search ×
//  communicate state, and the empty state offers a full reset)
try {
  const search = doc.getElementById('search-input');
  const clearBtn = doc.getElementById('search-clear');

  // the filter-status bar should no longer exist in the DOM
  if (doc.getElementById('filter-status')) { console.error('FAIL: filter-status bar should have been removed'); process.exit(1); }
  console.log('filter-status bar removed: true');

  // (a) A matching search reveals the search clear (×) button.
  search.value = 'example'; fire(search, 'input');
  await new Promise(r => setTimeout(r, 450));
  const clearShown = clearBtn && !clearBtn.classList.contains('hidden');
  console.log(`search reveals × clear button: ${clearShown}`);
  if (!clearShown) { console.error('FAIL: search did not reveal the × clear button'); process.exit(1); }

  // (b) A no-match search shows the empty state with a "Clear filters" button.
  search.value = 'zzz-no-such-tab-xyz'; fire(search, 'input');
  await new Promise(r => setTimeout(r, 450));
  const emptyState = doc.querySelector('#cards-container .board-empty-state');
  const emptyClear = emptyState && emptyState.querySelector('.board-empty-clear');
  console.log(`empty state with clear button on no match: ${!!emptyClear}`);
  if (!emptyClear) { console.error('FAIL: no empty state / clear button for a zero-match search'); process.exit(1); }

  // (c) The empty-state "Clear filters" button restores the board.
  emptyClear.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 450));
  const boardBack = !!doc.querySelector('#cards-container .card');
  const searchReset = doc.getElementById('search-input').value === '';
  console.log(`empty-state clear restores board: ${boardBack && searchReset}`);
  if (!boardBack || !searchReset) { console.error('FAIL: empty-state clear did not restore the board'); process.exit(1); }
} catch (err) {
  console.error('SEARCH/FILTER ERROR:\n', err);
  process.exit(1);
}
if (errors.length) {
  console.error(`RUNTIME ERRORS after search/filter (${errors.length}):`);
  for (const e of errors.slice(0, 8)) console.error(' -', e && e.stack ? e.stack.split('\n').slice(0,4).join('\n') : e);
  process.exit(1);
}

// --- Block 4: bookmarks default to top-folders-collapsed ----------------
{
  // The smoke fixture has a top-level "Bookmarks Bar" containing "Folder <x>".
  // With no saved state, a top-level folder should render collapsed by default.
  const topFolder = doc.querySelector('#bookmarks-card-container .bookmark-folder');
  const defaultCollapsed = topFolder && topFolder.classList.contains('collapsed');
  console.log(`bookmarks top folder default-collapsed: ${!!defaultCollapsed}`);
  if (!defaultCollapsed) { console.error('FAIL: top-level bookmark folder should default to collapsed'); process.exit(1); }

  // Toggling the folder caret should expand it (simple class toggle, no .hidden walk).
  const toggle = topFolder.querySelector('.folder-toggle');
  toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const nowExpanded = !topFolder.classList.contains('collapsed');
  console.log(`bookmark folder toggles open: ${nowExpanded}`);
  if (!nowExpanded) { console.error('FAIL: folder toggle did not expand'); process.exit(1); }
}

// --- v5.1: Edit Tab modal (redesign + auto-save + tag autocomplete) -----
try {
  // restore the board
  const search = doc.getElementById('search-input');
  if (search) { search.value = ''; fire(search, 'input'); }
  await new Promise(r => setTimeout(r, 450));

  const tile = doc.querySelector('#cards-container .tab-item');
  const editBtn = tile && tile.querySelector('.tab-edit');
  if (!editBtn) { console.error('FAIL: no .tab-edit button to open the modal'); process.exit(1); }
  // clean pointerdown/up (no movement) resets the drag-gesture guard from earlier tests
  editBtn.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
  editBtn.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 5, clientY: 5 }));
  editBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));
  await new Promise(r => setTimeout(r, 30));

  const modal = doc.getElementById('rename-dialog');
  const modalOpen = modal && !modal.classList.contains('hidden');
  const hostShown = (doc.getElementById('edit-tab-host').textContent || '').length > 0;
  console.log(`edit modal opens with identity header: ${modalOpen && hostShown}`);
  if (!modalOpen || !hostShown) { console.error('FAIL: edit modal did not open with host identity'); process.exit(1); }

  // add a tag via the chips-in-field input (Enter commits)
  const tagsInput = doc.getElementById('tags-input');
  tagsInput.value = 'work';
  tagsInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const chipAdded = !!doc.querySelector('#tag-box .etm-chip');
  console.log(`tag chip added inline: ${chipAdded}`);
  if (!chipAdded) { console.error('FAIL: tag chip not added'); process.exit(1); }

  // autocomplete: typing a prefix of the just-added tag should surface a suggestion
  tagsInput.value = 'wo';
  tagsInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  const dd = doc.getElementById('tag-suggestions');
  const ddShown = dd && !dd.classList.contains('hidden') && !!dd.querySelector('[data-add]');
  console.log(`tag autocomplete dropdown shows matches: ${ddShown}`);
  if (!ddShown) { console.error('FAIL: autocomplete dropdown did not show a match'); process.exit(1); }
  tagsInput.value = ''; // clear pending text so it isn't committed as a stray tag

  // add a to-do; the count should reflect it
  const addTodo = doc.getElementById('add-todo-input');
  addTodo.value = 'ship it';
  addTodo.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const todoRow = doc.querySelector('#todo-list-container .etm-todo');
  const countText = doc.getElementById('todo-count').textContent;
  console.log(`to-do added, count="${countText}": ${!!todoRow}`);
  if (!todoRow || !/\/\s*1/.test(countText)) { console.error('FAIL: to-do not added / count wrong'); process.exit(1); }

  // close via the ✕ → must auto-save (no Save button)
  chrome.storage.sync._writes = [];
  doc.getElementById('edit-tab-close').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const closed = modal.classList.contains('hidden');
  await new Promise(r => setTimeout(r, 650)); // saveData debounce is 500ms
  const persisted = chrome.storage.sync._writes.some(w =>
    w.tabMetadata && Object.values(w.tabMetadata).some(m =>
      m && Array.isArray(m.tags) && m.tags.includes('work') &&
      Array.isArray(m.todos) && m.todos.some(t => t.text === 'ship it')));
  console.log(`modal closes and auto-saves edits: ${closed && persisted}`);
  if (!closed || !persisted) { console.error('FAIL: modal did not auto-save on close'); process.exit(1); }
} catch (err) {
  console.error('EDIT MODAL ERROR:\n', err);
  process.exit(1);
}
if (errors.length) {
  console.error(`RUNTIME ERRORS after edit modal (${errors.length}):`);
  for (const e of errors.slice(0, 8)) console.error(' -', e && e.stack ? e.stack.split('\n').slice(0,4).join('\n') : e);
  process.exit(1);
}

// --- Theme toggle (light/dark) ------------------------------------------
try {
  const html = doc.documentElement;
  const lightBtn = doc.querySelector('#theme-toggle .theme-opt[data-theme-choice="light"]');
  const darkBtn = doc.querySelector('#theme-toggle .theme-opt[data-theme-choice="dark"]');
  if (!lightBtn || !darkBtn) { console.error('FAIL: theme toggle buttons missing'); process.exit(1); }

  chrome.storage.sync._writes = [];
  lightBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 650)); // saveData debounce
  const wentLight = html.getAttribute('data-theme') === 'light';
  const persistedLight = chrome.storage.sync._writes.some(w => w.settings && w.settings.theme === 'light');
  console.log(`theme → light applies + persists: ${wentLight && persistedLight}`);
  if (!wentLight || !persistedLight) { console.error('FAIL: light theme not applied/persisted'); process.exit(1); }

  darkBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 50));
  const backDark = html.getAttribute('data-theme') !== 'light';
  console.log(`theme → dark restores: ${backDark}`);
  if (!backDark) { console.error('FAIL: dark theme not restored'); process.exit(1); }
} catch (err) {
  console.error('THEME TOGGLE ERROR:\n', err);
  process.exit(1);
}

// --- Block 3/refresh: combined toolbar row ------------------------------
{
  const removedSessionsBtn = doc.getElementById('sessions-btn');           // should be gone
  const sessionsInSettings = doc.getElementById('open-sessions-btn');      // should exist
  // Search, the three action buttons, and the tag filters now share one row.
  const actions = doc.querySelector('.top-filters .toolbar-actions');
  const tagBtnInActions = doc.querySelector('.toolbar-actions #tag-manager-btn');
  const tagsInRow = doc.querySelector('.top-filters #tag-filters');
  const searchInRow = doc.querySelector('.top-filters .search-wrapper');
  console.log(`toolbar: sessions moved into settings: ${!removedSessionsBtn && !!sessionsInSettings}`);
  console.log(`toolbar: combined row (search+actions+tags): ${!!(searchInRow && actions && tagBtnInActions && tagsInRow)}`);
  if (removedSessionsBtn || !sessionsInSettings || !actions || !tagBtnInActions || !tagsInRow || !searchInRow) {
    console.error('FAIL: combined toolbar layout not as expected'); process.exit(1);
  }
}

console.log('SMOKE PASS ✅');
// The loaded app sets a setInterval (extension-context check) + other timers that
// keep Node's event loop alive, so exit explicitly on success.
process.exit(0);
