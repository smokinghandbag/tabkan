// Battle-test for restoring a closed window session into a new window.
//
// Unlike smoke.mjs (which uses a flat, stateless tab list), this harness models
// Chrome's WINDOW/TAB LIFECYCLE faithfully — in particular the rule that **a
// window closes the instant its last tab is removed**. That rule is what makes a
// freshly-opened restore window "open then immediately close", so we need it to
// reproduce and lock down the bug.
//
// It drives the REAL restoreSessionToNewWindow / restoreSnapshotToWindow through a
// battery of scenarios (no groups, with groups, single tab, already-open adopt,
// and the anchor-URL "pending commit" race) and asserts, for each, that the new
// window SURVIVES with exactly the expected tabs (no duplicates, no orphans).
//
// Run: node scripts/restore.battle.mjs .
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPO = process.argv[2] || '.';
const html = readFileSync(`${REPO}/fullpage.html`, 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://localhost/' });
const { window } = dom;
const listener = () => ({ addListener() {}, removeListener() {} });
// A real event so we can fire onFocusChanged → exercise the app's auto-follow +
// render the way Chrome does when the new window steals focus.
const realEvent = () => { const cbs = []; return { addListener: (cb) => cbs.push(cb), removeListener: () => {}, _emit: (...a) => { for (const cb of cbs) { try { const r = cb(...a); if (r && r.catch) r.catch(() => {}); } catch (e) { /* swallow */ } } } }; };
const focusEvent = realEvent();

const DASH_URL = 'chrome-extension://smoke/fullpage.html';
const DASH_WIN = 100;

// ---- Stateful window / tab / group model --------------------------------
let _tid = 1000, _wid = 100, _gid = 1;
const WINS = new Map();   // winId -> { id, focused }
const TABS = new Map();   // tabId -> { id, windowId, url, groupId, pinned, index, active }
const GROUPS = new Map(); // groupId -> { id, windowId, title, color, collapsed }
const ev = { createdWindows: [], closedWindows: [], focusUpdates: [] };

// When true, windows.create returns the anchor tab with its URL NOT yet committed
// (url === ''), as real Chrome often does — stressing the by-URL claim.
let PENDING_URL_MODE = false;
// When true, the window-create anchor tab is "volatile": if any code groups /
// ungroups / moves / updates it while it's still committing, Chrome DISCARDS it
// (the tab vanishes). If it was the window's only tab, the window then closes.
// This reproduces the "opens then quickly closes again" report — restore must NOT
// operate on that seed tab; it should rebuild fresh tabs and drop the seed last.
let VOLATILE_ANCHOR = false;
// When true, windows.create/update with focus emits onFocusChanged so the app's
// auto-follow + render runs — exercising the full real click flow.
let FIRE_FOCUS = false;

const winTabs = (wid) => [...TABS.values()].filter(t => t.windowId === wid).sort((a, b) => a.index - b.index);
const closeIfEmpty = (wid) => {
  if (WINS.has(wid) && winTabs(wid).length === 0) { WINS.delete(wid); ev.closedWindows.push(wid); }
};
// If a volatile seed tab is operated on before it commits, model Chrome dropping it.
const maybeDiscardVolatile = (id) => {
  const t = TABS.get(id);
  if (t && t._volatile) { const wid = t.windowId; TABS.delete(id); ev.discarded = (ev.discarded || 0) + 1; closeIfEmpty(wid); return true; }
  return false;
};
const addTab = (wid, url, { pinned = false, groupId = -1, active = false } = {}) => {
  const id = ++_tid;
  TABS.set(id, { id, windowId: wid, url: url || '', groupId, pinned, index: winTabs(wid).length, active });
  return TABS.get(id);
};
const normWid = (wid) => (wid === -2 ? DASH_WIN : wid);

const chrome = {
  runtime: { id: 'smoke', lastError: undefined, getURL: (p) => `chrome-extension://smoke/${p}`, onMessage: listener(), sendMessage() {} },
  i18n: { getMessage: (k) => k },
  tabs: {
    getCurrent: async () => ({ id: 999, url: DASH_URL, windowId: DASH_WIN, index: 0 }),
    query: async (q = {}) => {
      let res = [...TABS.values()];
      if (q.windowId != null) res = res.filter(t => t.windowId === normWid(q.windowId));
      if (q.currentWindow) res = res.filter(t => t.windowId === DASH_WIN);
      if (q.groupId != null) res = res.filter(t => t.groupId === q.groupId);
      if (q.url != null) res = res.filter(t => t.url === q.url);
      if (q.pinned != null) res = res.filter(t => !!t.pinned === q.pinned);
      return res.map(t => ({ ...t }));
    },
    get: async (id) => { const t = TABS.get(id); if (!t) throw new Error('no tab ' + id); return { ...t }; },
    create: async ({ windowId, url, pinned = false, active = false } = {}) => {
      const wid = normWid(windowId);
      if (!WINS.has(wid)) throw new Error('create into missing window ' + wid);
      return { ...addTab(wid, url, { pinned, active }) };
    },
    remove: async (id) => {
      const ids = Array.isArray(id) ? id : [id];
      for (const i of ids) { const t = TABS.get(i); if (!t) continue; const wid = t.windowId; TABS.delete(i); closeIfEmpty(wid); }
    },
    update: async (id, props) => { if (maybeDiscardVolatile(id)) return undefined; const t = TABS.get(id); if (t) Object.assign(t, props); return t ? { ...t } : undefined; },
    move: async (id, props) => { if (maybeDiscardVolatile(id)) return; const t = TABS.get(id); if (t && props && props.windowId != null) t.windowId = normWid(props.windowId); },
    group: async ({ groupId, tabIds = [], createProperties } = {}) => {
      for (const tid of tabIds) if (maybeDiscardVolatile(tid)) return groupId == null ? ++_gid : groupId;
      let gid = groupId;
      if (gid == null) {
        gid = ++_gid;
        const wid = (createProperties && createProperties.windowId != null) ? normWid(createProperties.windowId)
          : (TABS.get(tabIds[0]) || {}).windowId;
        GROUPS.set(gid, { id: gid, windowId: wid, title: '', color: 'grey', collapsed: false });
      }
      for (const tid of tabIds) { const t = TABS.get(tid); if (t) t.groupId = gid; }
      return gid;
    },
    ungroup: async (id) => { const ids = Array.isArray(id) ? id : [id]; for (const i of ids) { if (maybeDiscardVolatile(i)) continue; const t = TABS.get(i); if (t) t.groupId = -1; } },
    onCreated: listener(), onRemoved: listener(), onUpdated: listener(), onMoved: listener(),
    onActivated: listener(), onAttached: listener(), onDetached: listener(),
  },
  tabGroups: {
    TAB_GROUP_ID_NONE: -1,
    query: async (q = {}) => {
      let res = [...GROUPS.values()];
      if (q.windowId != null) res = res.filter(g => g.windowId === normWid(q.windowId));
      // Chrome destroys a group once it has no tabs — model that so leftover temp
      // groups don't show up as phantom columns.
      res = res.filter(g => [...TABS.values()].some(t => t.groupId === g.id));
      return res.map(g => ({ ...g }));
    },
    update: async (id, props) => { const g = GROUPS.get(id); if (g) Object.assign(g, props); },
    move: async () => {}, onCreated: listener(), onRemoved: listener(), onUpdated: listener(), onMoved: listener(),
  },
  windows: {
    WINDOW_ID_CURRENT: -2, WINDOW_ID_NONE: -1,
    getCurrent: async () => ({ id: DASH_WIN }),
    getAll: async () => [...WINS.values()].map(w => ({ id: w.id })),
    get: async (id) => ({ id, tabs: winTabs(id).map(t => ({ ...t })) }),
    create: async (opts = {}) => {
      const id = ++_wid; WINS.set(id, { id, focused: !!opts.focused }); ev.createdWindows.push(id);
      const t = addTab(id, opts.url || 'chrome://newtab/', { active: true });
      if (VOLATILE_ANCHOR && opts.url) t._volatile = true;
      const reported = { ...t };
      if ((PENDING_URL_MODE || VOLATILE_ANCHOR) && opts.url) reported.url = '';   // not-yet-committed
      if (opts.focused && FIRE_FOCUS) focusEvent._emit(id);   // new window steals focus
      return { id, tabs: [reported] };
    },
    update: async (id, props) => { ev.focusUpdates.push({ id, props }); const w = WINS.get(id); if (w && props && props.focused) { for (const x of WINS.values()) x.focused = false; w.focused = true; if (FIRE_FOCUS) focusEvent._emit(id); } },
    remove: async (id) => { for (const t of winTabs(id)) TABS.delete(t.id); WINS.delete(id); },
    onFocusChanged: focusEvent, onCreated: listener(), onRemoved: listener(),
  },
  storage: {
    sync: { get: async () => ({}), set: async () => {} },
    local: (() => {
      const store = {};
      return {
        get: async (key) => (typeof key === 'string' ? (key in store ? { [key]: store[key] } : {}) : { ...store }),
        set: async (obj) => { Object.assign(store, obj); },
        remove: async (key) => { delete store[key]; },
      };
    })(),
    onChanged: listener(),
  },
  bookmarks: {
    getTree: async () => ([{ id: '0', title: '', children: [
      { id: '1', title: 'Bookmarks Bar', index: 0, children: [] },
      { id: '2', title: 'Other Bookmarks', index: 1, children: [] },
    ] }]),
    create: async () => ({ id: 'x' }), remove: async () => {}, removeTree: async () => {},
    onCreated: listener(), onRemoved: listener(), onChanged: listener(), onMoved: listener(),
  },
  contextMenus: { create() {}, onClicked: listener() },
  sidePanel: { open: async () => {}, setPanelBehavior: async () => {} },
  action: { onClicked: listener() },
};

// ---- globals the modules expect -----------------------------------------
Object.assign(window, { chrome, requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: () => {}, confirm: () => true, alert: () => {} });
globalThis.window = window;
globalThis.document = window.document;
globalThis.chrome = chrome;
try { globalThis.location = window.location; } catch {}
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
globalThis.confirm = window.confirm;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
if (window.AbortController) globalThis.AbortController = window.AbortController;
process.on('unhandledRejection', () => { /* init()'s render may reject against the lean mock; irrelevant to restore */ });

// Seed: a primary dashboard window with the dashboard tab + one normal tab.
WINS.set(DASH_WIN, { id: DASH_WIN, focused: true });
addTab(DASH_WIN, DASH_URL, { pinned: true, active: true });
addTab(DASH_WIN, 'https://dash-tab.test/');

// Import the real code (this also fires app.init(); its async render may fail
// against the lean mock — we don't care, we only call the restore functions).
const sessions = await import(pathToFileURL(`${REPO}/src/sessions.js`).href);
await new Promise(r => setTimeout(r, 50));

// ---- assertions ----------------------------------------------------------
let failures = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} — ${label}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};
// Reset to a clean world (just the primary dashboard window) so each scenario is
// isolated — otherwise windows opened by an earlier scenario stay live and the
// adopt guard (correctly) re-binds to them instead of exercising the create path.
const resetWorld = () => {
  WINS.clear(); TABS.clear(); GROUPS.clear();
  ev.closedWindows.length = 0;
  WINS.set(DASH_WIN, { id: DASH_WIN, focused: true });
  addTab(DASH_WIN, DASH_URL, { pinned: true, active: true });
  addTab(DASH_WIN, 'https://dash-tab.test/');
};
const setRegistry = async (windows) => { await chrome.storage.local.set({ tabkanWorkspaces: { windows, focusedTkId: null, focusLocked: false } }); };
const regEntry = async (tkId) => ((await chrome.storage.local.get('tabkanWorkspaces')).tabkanWorkspaces.windows.find(w => w.tkId === tkId) || {});

// Run one "open in new window" and report the created window + its surviving tabs.
const openAndInspect = async (tkId) => {
  const before = ev.createdWindows.length;
  const r = await sessions.restoreSessionToNewWindow(tkId);
  await new Promise(res => setTimeout(res, 10));
  const created = ev.createdWindows.slice(before);
  const newWin = created.length ? created[created.length - 1] : null;
  const alive = newWin != null && WINS.has(newWin);
  const tabs = newWin != null ? winTabs(newWin).map(t => ({ url: t.url, groupId: t.groupId })) : [];
  return { r, created, newWin, alive, tabs };
};
const urlsOf = (tabs) => tabs.map(t => t.url).filter(u => u && u !== 'chrome://newtab/' && u !== 'about:blank');
const hasDup = (arr) => new Set(arr).size !== arr.length;

for (const mode of ['committed', 'pending', 'volatile']) {
  PENDING_URL_MODE = mode === 'pending';
  VOLATILE_ANCHOR = mode === 'volatile';
  const tag = `[anchor URL ${mode}]`;

  // A) no groups, three tabs
  resetWorld();
  await setRegistry([{ tkId: 'A', label: 'Window 1', liveWindowId: null,
    lastSnapshot: { savedAt: 1, groups: [], tabs: [
      { url: 'https://a.test/', groupId: -1 }, { url: 'https://b.test/', groupId: -1 }, { url: 'https://c.test/', groupId: -1 },
    ] } }]);
  {
    const x = await openAndInspect('A');
    ok(`${tag} A: a new window opened`, x.newWin != null);
    ok(`${tag} A: window SURVIVED (did not auto-close)`, x.alive, x.alive ? '' : `closed=${ev.closedWindows.join(',')}`);
    const u = urlsOf(x.tabs);
    ok(`${tag} A: exactly the 3 snapshot tabs, no dup/orphan`, u.length === 3 && !hasDup(u) && ['https://a.test/','https://b.test/','https://c.test/'].every(s => u.includes(s)), `tabs=${JSON.stringify(u)}`);
    ok(`${tag} A: entry rebound to the new window`, (await regEntry('A')).liveWindowId === x.newWin);
  }

  // B) two groups + a loose tab
  resetWorld();
  await setRegistry([{ tkId: 'B', label: 'Window 2', liveWindowId: null,
    lastSnapshot: { savedAt: 1, groups: [
      { id: 11, title: 'G1', color: 'blue', collapsed: false }, { id: 12, title: 'G2', color: 'red', collapsed: true },
    ], tabs: [
      { url: 'https://g1a.test/', groupId: 11 }, { url: 'https://g1b.test/', groupId: 11 },
      { url: 'https://g2a.test/', groupId: 12 }, { url: 'https://loose.test/', groupId: -1 },
    ] } }]);
  {
    const x = await openAndInspect('B');
    ok(`${tag} B: window SURVIVED`, x.alive, x.alive ? '' : `closed=${ev.closedWindows.join(',')}`);
    const u = urlsOf(x.tabs);
    ok(`${tag} B: 4 snapshot tabs, no dup, no leftover blank/newtab`, u.length === 4 && !hasDup(u), `tabs=${JSON.stringify(x.tabs)}`);
    const groupedCount = x.tabs.filter(t => t.groupId !== -1).length;
    ok(`${tag} B: 3 tabs ended up grouped`, groupedCount === 3, `grouped=${groupedCount}`);
  }

  // C) single tab (the user's "1 tab" closed session)
  resetWorld();
  await setRegistry([{ tkId: 'C', label: 'Window 3', liveWindowId: null,
    lastSnapshot: { savedAt: 1, groups: [], tabs: [{ url: 'https://only.test/', groupId: -1 }] } }]);
  {
    const x = await openAndInspect('C');
    ok(`${tag} C: single-tab window SURVIVED`, x.alive, x.alive ? '' : `closed=${ev.closedWindows.join(',')}`);
    const u = urlsOf(x.tabs);
    ok(`${tag} C: exactly 1 tab, no dup`, u.length === 1 && u[0] === 'https://only.test/', `tabs=${JSON.stringify(u)}`);
  }
}
PENDING_URL_MODE = false;
VOLATILE_ANCHOR = false;

// D) adopt: session already open in a live window → focus it, do NOT duplicate
{
  resetWorld();
  const LIVE = ++_wid; WINS.set(LIVE, { id: LIVE, focused: false });
  addTab(LIVE, 'https://x.test/'); addTab(LIVE, 'https://y.test/');
  await setRegistry([{ tkId: 'D', label: 'Window 9', liveWindowId: null,
    lastSnapshot: { savedAt: 1, groups: [], tabs: [{ url: 'https://x.test/', groupId: -1 }, { url: 'https://y.test/', groupId: -1 }] } }]);
  const before = ev.createdWindows.length;
  ev.focusUpdates = [];
  const r = await sessions.restoreSessionToNewWindow('D');
  await new Promise(res => setTimeout(res, 10));
  ok('D: adopt — returned true', r === true);
  ok('D: adopt — opened NO new window', ev.createdWindows.length === before, `created=${ev.createdWindows.length - before}`);
  ok('D: adopt — focused the live window', ev.focusUpdates.some(u => u.id === LIVE && u.props && u.props.focused));
  ok('D: adopt — rebound entry to the live window', (await regEntry('D')).liveWindowId === LIVE);
  ok('D: adopt — live window still has exactly its 2 tabs', winTabs(LIVE).length === 2);
}

// F) close-2nd-window regression: a closed session whose URLs OVERLAP the still-open
// primary/dashboard window must NOT be "adopted" onto the primary (that bound window
// belongs to another entry). It must open a fresh window and leave the primary intact.
{
  resetWorld();                                  // DASH_WIN has the dashboard tab + https://dash-tab.test/
  await chrome.storage.local.set({ tabkanWorkspaces: { focusedTkId: 'P', focusLocked: false, windows: [
    { tkId: 'P', label: 'Window 1', liveWindowId: DASH_WIN, isPrimary: true,
      lastSnapshot: { savedAt: 1, groups: [], tabs: [{ url: 'https://dash-tab.test/', groupId: -1 }] } },
    // Closed 2nd window whose only saved URL is ALSO open in the primary (100% overlap).
    { tkId: 'F', label: 'Window 2', liveWindowId: null,
      lastSnapshot: { savedAt: 1, groups: [], tabs: [{ url: 'https://dash-tab.test/', groupId: -1 }] } },
  ] } });
  const before = ev.createdWindows.length;
  const r = await sessions.restoreSessionToNewWindow('F');
  await new Promise(res => setTimeout(res, 10));
  const created = ev.createdWindows.slice(before);
  const newWin = created.length ? created[created.length - 1] : null;
  ok('F: returned true', r === true);
  ok('F: opened a NEW window (did not adopt the primary)', newWin != null && WINS.has(newWin), `created=${created.length}`);
  ok('F: primary entry still bound to the dashboard window (not clobbered)', (await regEntry('P')).liveWindowId === DASH_WIN);
  ok('F: closed entry rebound to the NEW window', (await regEntry('F')).liveWindowId === newWin);
  ok('F: dashboard window untouched (still has its 2 tabs)', winTabs(DASH_WIN).length === 2);
}

// G) FULL FLOW — fire onFocusChanged so the app's auto-follow + render run, exactly
// as when the real click creates a focused window. The primary/dashboard window must
// NOT gain the session's tabs/groups (the "also opens it in the primary" report).
{
  FIRE_FOCUS = true;
  resetWorld();                                  // DASH_WIN: dashboard tab + https://dash-tab.test/
  const dashTabsBefore = winTabs(DASH_WIN).length;
  await chrome.storage.local.set({ tabkanWorkspaces: { focusedTkId: 'P', focusLocked: false, windows: [
    { tkId: 'P', label: 'Window 1', liveWindowId: DASH_WIN, isPrimary: true,
      lastSnapshot: { savedAt: 1, groups: [], tabs: [{ url: 'https://dash-tab.test/', groupId: -1 }] } },
    { tkId: 'G2', label: 'Window 2', liveWindowId: null,
      lastSnapshot: { savedAt: 1, groups: [{ id: 5, title: 'S', color: 'blue', collapsed: false }],
        tabs: [{ url: 'https://sess-a.test/', groupId: 5 }, { url: 'https://sess-b.test/', groupId: 5 }] } },
  ] } });
  const before = ev.createdWindows.length;
  await sessions.restoreSessionToNewWindow('G2');
  await new Promise(res => setTimeout(res, 60));  // let auto-follow render settle
  const newWin = ev.createdWindows.slice(before).pop();
  // Simulate the focus event that settles once the new window is bound (real Chrome
  // fires onFocusChanged as the window comes to front). Suppression must hold.
  focusEvent._emit(newWin);
  await new Promise(res => setTimeout(res, 30));
  const dashUrls = [...TABS.values()].filter(t => t.windowId === DASH_WIN).map(t => t.url);
  const dashGainedSession = dashUrls.includes('https://sess-a.test/') || dashUrls.includes('https://sess-b.test/');
  const focusedAfter = (await chrome.storage.local.get('tabkanWorkspaces')).tabkanWorkspaces.focusedTkId;
  ok('G: new window has the session', newWin != null && urlsOf(winTabs(newWin).map(t => ({ url: t.url }))).sort().join() === ['https://sess-a.test/','https://sess-b.test/'].join());
  ok('G: PRIMARY window did NOT gain the session tabs', !dashGainedSession, `dashUrls=${JSON.stringify(dashUrls)}`);
  ok('G: PRIMARY window tab count unchanged', winTabs(DASH_WIN).length === dashTabsBefore, `before=${dashTabsBefore} after=${winTabs(DASH_WIN).length}`);
  ok('G: dashboard stays on the PRIMARY (auto-follow suppressed, did not jump to the session)', focusedAfter === 'P', `focusedTkId=${focusedAfter}`);

  // CONTROL — clear the suppression and fire the same focus event: now the dashboard
  // DOES auto-follow to the bound session window. Proves the suppression above is
  // what kept it on the primary (and that auto-follow itself still works normally).
  await chrome.storage.local.set({ tkAutoFollowSuppressUntil: 0 });
  focusEvent._emit(newWin);
  await new Promise(res => setTimeout(res, 30));
  const focusedControl = (await chrome.storage.local.get('tabkanWorkspaces')).tabkanWorkspaces.focusedTkId;
  ok('G (control): once suppression clears, auto-follow DOES switch to the session window', focusedControl === 'G2', `focusedTkId=${focusedControl}`);
  FIRE_FOCUS = false;
}

// E) CONTROL — prove the harness detects the failure mode: operating on the
// volatile seed tab while it's the window's only tab DOES close the window (this
// is exactly what the previous "claim + ungroup the create-anchor" code did, and
// what produced "opens then quickly closes"). If this control ever stops closing,
// the model has gone slack and the survival assertions above mean nothing.
{
  VOLATILE_ANCHOR = true;
  resetWorld();
  const before = ev.createdWindows.length;
  const w = await chrome.windows.create({ url: 'https://seed.test/', focused: true });
  const seedId = w.tabs[0].id;
  await chrome.tabs.ungroup(seedId);           // operate on the still-committing sole tab
  const winId = ev.createdWindows[before];
  ok('E (control): operating on the volatile sole tab CLOSES the window', !WINS.has(winId), WINS.has(winId) ? 'still open — model too lax' : 'closed as expected');
  VOLATILE_ANCHOR = false;
}

console.log(failures ? `\nBATTLE FAIL ❌  (${failures} failing assertion${failures === 1 ? '' : 's'})` : '\nBATTLE PASS ✅');
process.exit(failures ? 1 : 0);
