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
    update: async () => {}, move: async () => {}, remove: async () => {},
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
    sync: { get: async () => ({}), set: async () => {} },
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
  contextMenus: { create() {}, onClicked: listener() },
  sidePanel: { open: async () => {}, setPanelBehavior: async () => {} },
  action: { onClicked: listener() },
};

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
try {
  const search = doc.getElementById('search-input');
  if (search) { search.value = 'example'; fire(search, 'input'); }
  await new Promise(r => setTimeout(r, 400)); // debounced render
  fire(doc.getElementById('sessions-btn'), 'click');     // sessions.js renderSessions
  fire(doc.getElementById('tag-manager-btn'), 'click');  // tag manager
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
const cards = window.document.querySelectorAll('#cards-container .card, #cards-container .create-card-link');
const sidebarCard = window.document.querySelectorAll('#centro-card-container .card');
const bookmarks = window.document.querySelectorAll('#bookmarks-card-container .bookmarks-sidebar-card');
console.log(`render output: cardsContainer children=${cards.length}, sidebarCard=${sidebarCard.length}, bookmarksCard=${bookmarks.length}`);
if (cards.length === 0 || sidebarCard.length === 0) {
  console.error('FAIL: render did not populate expected containers');
  process.exit(1);
}
console.log('SMOKE PASS ✅');
// The loaded app sets a setInterval (extension-context check) + other timers that
// keep Node's event loop alive, so exit explicitly on success.
process.exit(0);
