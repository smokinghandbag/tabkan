// Unit tests for TabKan's pure helpers (no DOM / chrome needed).
// Run with: node --test scripts/unit.test.mjs   (or `npm run unit`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, getFaviconUrl, distanceSq, movedLikeDrag, DRAG_CLICK_THRESHOLD_PX,
  normalizeTag, todoProgress, suggestTags, splitMatch,
  isWithinSuppressionWindow, dashboardPopupMode,
} from '../src/utils.js';
import { nextWindowLabel, bindWindows, resolveFocusedWindowId } from '../src/workspaces.js';
import { switcherViewModel, focusWindow, toggleFocusLockState, renameWindowInRegistry, autoFollowWindow } from '../src/workspaces.js';
import { groupWorkspacesByWindow, rebindWindow } from '../src/workspaces.js';
import { isSnapshotAlreadyOpen, forgetSnapshotsInRegistry, referencedGroupIds } from '../src/workspaces.js';

test('escapeHtml encodes all five HTML-sensitive characters', () => {
  assert.equal(escapeHtml(`<a href="x" class='y'>&</a>`),
    '&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('escapeHtml handles null/undefined as empty string', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
});

test('escapeHtml is injection-safe for a hostile tab title', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const out = escapeHtml(evil);
  assert.ok(!out.includes('<img'));
  assert.ok(!out.includes('"'));
});

test('getFaviconUrl derives Google favicon service URL from hostname', () => {
  assert.equal(getFaviconUrl('https://news.ycombinator.com/item?id=1'),
    'https://www.google.com/s2/favicons?domain=news.ycombinator.com');
});

test('getFaviconUrl returns inline SVG fallback for an invalid URL', () => {
  const out = getFaviconUrl('not a url');
  assert.ok(out.startsWith('data:image/svg+xml'));
});

test('distanceSq computes squared euclidean distance', () => {
  assert.equal(distanceSq(0, 0, 3, 4), 25);
  assert.equal(distanceSq(1, 1, 1, 1), 0);
});

test('movedLikeDrag: a tiny move (<= threshold) is a click, not a drag', () => {
  // 3px move, threshold 5 → click
  assert.equal(movedLikeDrag(100, 100, 103, 100), false);
  // exactly at threshold → still a click (strictly greater triggers)
  assert.equal(movedLikeDrag(0, 0, DRAG_CLICK_THRESHOLD_PX, 0), false);
});

test('movedLikeDrag: a move beyond threshold is a drag', () => {
  assert.equal(movedLikeDrag(100, 100, 120, 100), true);
  assert.equal(movedLikeDrag(0, 0, DRAG_CLICK_THRESHOLD_PX + 1, 0), true);
});

test('movedLikeDrag: respects a custom threshold', () => {
  assert.equal(movedLikeDrag(0, 0, 8, 0, 10), false);
  assert.equal(movedLikeDrag(0, 0, 12, 0, 10), true);
});

// --- Edit-tab modal helpers ---------------------------------------------

test('normalizeTag strips leading #, trims, collapses whitespace', () => {
  assert.equal(normalizeTag('  #Design  '), 'Design');
  assert.equal(normalizeTag('##job  hunt'), 'job hunt');
  assert.equal(normalizeTag(''), '');
  assert.equal(normalizeTag(null), '');
  assert.equal(normalizeTag(undefined), '');
});

test('todoProgress counts completed / total', () => {
  assert.deepEqual(todoProgress([]), { done: 0, total: 0 });
  assert.deepEqual(todoProgress(undefined), { done: 0, total: 0 });
  assert.deepEqual(
    todoProgress([{ completed: true }, { completed: false }, { completed: true }]),
    { done: 2, total: 3 });
});

test('suggestTags: prefix matches rank before substring matches', () => {
  const all = ['design', 'design-system', 'desk-research', 'redesign'];
  const { matches } = suggestTags(all, 'des', []);
  // prefix hits (design, design-system, desk-research) before substring (redesign)
  assert.deepEqual(matches, ['design', 'design-system', 'desk-research', 'redesign']);
});

test('suggestTags: empty query yields no matches and no create row', () => {
  const r = suggestTags(['a', 'b'], '   ', []);
  assert.deepEqual(r.matches, []);
  assert.equal(r.showCreate, false);
});

test('suggestTags: excludes already-applied tags from matches', () => {
  const { matches } = suggestTags(['design', 'design-system'], 'des', ['design']);
  assert.deepEqual(matches, ['design-system']);
});

test('suggestTags: showCreate is false on an exact existing tag, true otherwise', () => {
  assert.equal(suggestTags(['design'], 'design', []).showCreate, false);   // exact exists
  assert.equal(suggestTags(['design'], '#design', []).showCreate, false);  // exact after normalize
  assert.equal(suggestTags(['design'], 'desi', []).showCreate, true);      // novel
  assert.equal(suggestTags(['design'], 'desi', ['desi']).showCreate, false); // already applied
  assert.equal(suggestTags(['design'], '#new-tag', []).createValue, 'new-tag');
});

test('suggestTags: respects the limit', () => {
  const all = Array.from({ length: 20 }, (_, i) => `tag${i}`);
  assert.equal(suggestTags(all, 'tag', [], 5).matches.length, 5);
});

test('splitMatch: splits around the case-insensitive match for highlighting', () => {
  assert.deepEqual(splitMatch('design-system', 'des'), ['', 'des', 'ign-system']);
  assert.deepEqual(splitMatch('redesign', 'des'), ['re', 'des', 'ign']);
  assert.deepEqual(splitMatch('Design', 'des'), ['', 'Des', 'ign']); // keeps original case
  assert.deepEqual(splitMatch('design', 'xyz'), ['design', '', '']); // no match
  assert.deepEqual(splitMatch('design', ''), ['design', '', '']);    // empty query
});

// --- Single-dashboard popup gating -------------------------------------------

test('dashboardPopupMode: create when no dashboard exists anywhere', () => {
  assert.equal(dashboardPopupMode(null, 1), 'create');
  assert.equal(dashboardPopupMode(undefined, 1), 'create');
});

test('dashboardPopupMode: primary when the dashboard is in this window', () => {
  assert.equal(dashboardPopupMode({ id: 9, windowId: 1 }, 1), 'primary');
});

test('dashboardPopupMode: secondary when the dashboard is in another window', () => {
  assert.equal(dashboardPopupMode({ id: 9, windowId: 2 }, 1), 'secondary');
});

// --- Self-mutation suppression -----------------------------------------------

test('isWithinSuppressionWindow: true only before the until timestamp', () => {
  assert.equal(isWithinSuppressionWindow(1000, 999), true);   // now < until
  assert.equal(isWithinSuppressionWindow(1000, 1000), false); // now === until (expired)
  assert.equal(isWithinSuppressionWindow(1000, 1001), false); // now > until
  assert.equal(isWithinSuppressionWindow(undefined, 50), false);
  assert.equal(isWithinSuppressionWindow(null, 50), false);
  assert.equal(isWithinSuppressionWindow('x', 50), false);
});

// --- Workspace registry pure helpers ------------------------------------

test('nextWindowLabel: first is "Window 1", then increments past existing numbers', () => {
  assert.equal(nextWindowLabel([]), 'Window 1');
  assert.equal(nextWindowLabel([{ label: 'Window 1' }]), 'Window 2');
  assert.equal(nextWindowLabel([{ label: 'Work' }, { label: 'Window 3' }]), 'Window 4');
});

test('bindWindows: keeps known windows, adds new ones, marks closed ones', () => {
  const prev = [
    { tkId: 'w_a', label: 'Window 1', liveWindowId: 1, isPrimary: true },
    { tkId: 'w_b', label: 'Window 2', liveWindowId: 2, isPrimary: false },
  ];
  // window 2 closed, window 5 opened; dashboard now in window 1
  const out = bindWindows(prev, [{ id: 1 }, { id: 5 }], 1, () => 'w_c');
  const byId = Object.fromEntries(out.map(w => [w.tkId, w]));
  assert.equal(byId.w_a.liveWindowId, 1);
  assert.equal(byId.w_a.isPrimary, true);
  assert.equal(byId.w_b.liveWindowId, null);   // closed → kept, unbound
  assert.equal(byId.w_c.liveWindowId, 5);      // new entry
  assert.equal(byId.w_c.label, 'Window 3');
});

test('bindWindows: re-associates a restarted window to its entry by URL overlap (no duplicate)', () => {
  // Simulates "Continue where you left off": Chrome reopens the window under a NEW
  // id (99), so id-matching misses. The old entry holds the snapshot; the live
  // window holds the same URLs → they should rebind, NOT spawn a 2nd entry/card.
  const prev = [
    { tkId: 'w_dash', label: 'Window 1', liveWindowId: null, isPrimary: false,
      lastSnapshot: { tabs: [{ url: 'https://a' }, { url: 'https://b' }, { url: 'https://c' }] } },
    { tkId: 'w_old',  label: 'Window 2', liveWindowId: null, isPrimary: false,
      lastSnapshot: { tabs: [{ url: 'https://x' }, { url: 'https://y' }] } },
  ];
  const urls = new Map([
    [10, new Set(['https://a', 'https://b', 'https://c'])], // dashboard window
    [99, new Set(['https://x', 'https://y'])],              // restarted secondary
  ]);
  const out = bindWindows(prev, [{ id: 10 }, { id: 99 }], 10, () => 'w_new', urls);
  assert.equal(out.length, 2);                              // no fresh entries created
  const byTk = Object.fromEntries(out.map(w => [w.tkId, w]));
  assert.equal(byTk.w_dash.liveWindowId, 10);
  assert.equal(byTk.w_dash.isPrimary, true);
  assert.equal(byTk.w_old.liveWindowId, 99);                // re-bound, not duplicated
  assert.ok(!out.some(w => w.tkId === 'w_new'));            // no "Window 3" placeholder
});

test('bindWindows: below-threshold overlap falls back to a fresh entry', () => {
  const prev = [
    { tkId: 'w_old', label: 'Window 1', liveWindowId: null,
      lastSnapshot: { tabs: [{ url: 'https://a' }, { url: 'https://b' }, { url: 'https://c' }] } },
  ];
  const urls = new Map([[42, new Set(['https://a'])]]);     // only 1/3 → 33% < 0.6
  const out = bindWindows(prev, [{ id: 42 }], 42, () => 'w_new', urls);
  const byTk = Object.fromEntries(out.map(w => [w.tkId, w]));
  assert.equal(byTk.w_old.liveWindowId, null);              // not adopted
  assert.equal(byTk.w_new.liveWindowId, 42);                // fresh entry instead
});

test('bindWindows: id-stable binding still wins (no URL map needed)', () => {
  const prev = [{ tkId: 'w_a', label: 'Window 1', liveWindowId: 1, isPrimary: true }];
  const out = bindWindows(prev, [{ id: 1 }], 1, () => 'w_c');  // legacy 4-arg call
  assert.equal(out.length, 1);
  assert.equal(out[0].liveWindowId, 1);
});

test('resolveFocusedWindowId: focused if still live, else dashboard window', () => {
  const reg = {
    windows: [{ tkId: 'w_a', liveWindowId: 1 }, { tkId: 'w_b', liveWindowId: 2 }],
    focusedTkId: 'w_b',
  };
  assert.equal(resolveFocusedWindowId(reg, 1), 2);                 // focused is live
  const regClosed = { windows: [{ tkId: 'w_a', liveWindowId: 1 }, { tkId: 'w_b', liveWindowId: null }], focusedTkId: 'w_b' };
  assert.equal(resolveFocusedWindowId(regClosed, 1), 1);           // focused closed → dashboard window
  assert.equal(resolveFocusedWindowId({ windows: [], focusedTkId: null }, 7), 7); // empty → dashboard window
});

test('switcherViewModel: only open windows, flags focus, hidden when <2', () => {
  const reg = { windows: [
    { tkId: 'a', label: 'Window 1', liveWindowId: 1, isPrimary: true },
    { tkId: 'b', label: 'Work', liveWindowId: 2, isPrimary: false },
    { tkId: 'c', label: 'Window 3', liveWindowId: null, isPrimary: false },
  ], focusedTkId: 'b', focusLocked: true };
  const vm = switcherViewModel(reg);
  assert.equal(vm.windows.length, 2);
  assert.deepEqual(vm.windows.map(w => w.tkId), ['a', 'b']);
  assert.equal(vm.windows.find(w => w.tkId === 'b').isFocused, true);
  assert.equal(vm.locked, true);
  assert.equal(vm.visible, true);
});

test('switcherViewModel: renumbers auto labels by active position, keeps custom names', () => {
  // Two open windows whose stored auto-labels have drifted ("Window 1" + "Window 5"),
  // plus one with a custom name → display shows Window 1, 2 and the custom name as-is.
  const drifted = { windows: [
    { tkId: 'a', label: 'Window 1', liveWindowId: 1 },
    { tkId: 'b', label: 'Window 5', liveWindowId: 2 },
  ], focusedTkId: 'a' };
  assert.deepEqual(switcherViewModel(drifted).windows.map(w => w.displayLabel), ['Window 1', 'Window 2']);

  const mixed = { windows: [
    { tkId: 'a', label: 'Work', liveWindowId: 1 },
    { tkId: 'b', label: 'Window 9', liveWindowId: 2 },
  ], focusedTkId: 'a' };
  assert.deepEqual(switcherViewModel(mixed).windows.map(w => w.displayLabel), ['Work', 'Window 2']);
});

test('switcherViewModel: falls back to primary as focused when focusedTkId is stale', () => {
  const reg = { windows: [
    { tkId: 'a', label: 'Window 1', liveWindowId: 1, isPrimary: true },
    { tkId: 'b', label: 'Window 2', liveWindowId: 2, isPrimary: false },
  ], focusedTkId: 'gone', focusLocked: false };
  const vm = switcherViewModel(reg);
  assert.equal(vm.windows.find(w => w.isPrimary).isFocused, true);
  assert.equal(vm.windows.filter(w => w.isFocused).length, 1);
});

test('switcherViewModel: not visible with a single window', () => {
  const vm = switcherViewModel({ windows: [{ tkId: 'a', label: 'Window 1', liveWindowId: 1, isPrimary: true }], focusedTkId: 'a' });
  assert.equal(vm.visible, false);
});

test('switcherViewModel: dashboard (primary) window is always first and "Window 1"', () => {
  // Primary entry sits 2nd in the registry with a drifted auto-label; it must still
  // surface first in the switcher and renumber to "Window 1".
  const reg = { windows: [
    { tkId: 'sec', label: 'Window 3', liveWindowId: 2, isPrimary: false },
    { tkId: 'dash', label: 'Window 7', liveWindowId: 1, isPrimary: true },
    { tkId: 'third', label: 'Window 9', liveWindowId: 3, isPrimary: false },
  ], focusedTkId: 'sec' };
  const vm = switcherViewModel(reg);
  assert.equal(vm.windows[0].tkId, 'dash');                                  // primary first
  assert.equal(vm.windows[0].displayLabel, 'Window 1');                      // numbered 1
  assert.deepEqual(vm.windows.map(w => w.displayLabel), ['Window 1', 'Window 2', 'Window 3']);
  assert.deepEqual(vm.windows.map(w => w.tkId), ['dash', 'sec', 'third']);   // rest keep order
  assert.equal(vm.windows.find(w => w.tkId === 'sec').isFocused, true);      // focus unchanged
});

test('switcherViewModel: a renamed primary stays first but keeps its custom name', () => {
  const reg = { windows: [
    { tkId: 'sec', label: 'Window 2', liveWindowId: 2, isPrimary: false },
    { tkId: 'dash', label: 'Main', liveWindowId: 1, isPrimary: true },
  ], focusedTkId: 'dash' };
  const vm = switcherViewModel(reg);
  assert.equal(vm.windows[0].tkId, 'dash');
  assert.equal(vm.windows[0].displayLabel, 'Main');     // custom label respected
  assert.equal(vm.windows[1].displayLabel, 'Window 2');
});

test('switcherViewModel: lists closed sessions (unbound windows with a snapshot) + visible when present', () => {
  const reg = { windows: [
    { tkId: 'a', label: 'Window 1', liveWindowId: 1 },                                                               // open, no snapshot
    { tkId: 'b', label: 'Work', liveWindowId: null, lastSnapshot: { savedAt: 123, groups: [{}], tabs: [{},{}] } },   // closed → listed
    { tkId: 'c', label: 'Window 3', liveWindowId: null, lastSnapshot: { groups: [], tabs: [] } },                    // closed but empty → excluded
  ], focusedTkId: 'a' };
  const vm = switcherViewModel(reg);
  assert.deepEqual(vm.closedSessions.map(s => s.tkId), ['b']);
  assert.equal(vm.closedSessions[0].tabCount, 2);
  assert.equal(vm.closedSessions[0].savedAt, 123);
  assert.equal(vm.visible, true);   // one open window + one closed session → still show the area
});

test('focusWindow sets focusedTkId and locks', () => {
  const out = focusWindow({ windows: [], focusedTkId: 'a', focusLocked: false }, 'b');
  assert.equal(out.focusedTkId, 'b');
  assert.equal(out.focusLocked, true);
});

test('toggleFocusLockState flips the lock', () => {
  assert.equal(toggleFocusLockState({ focusLocked: false }).focusLocked, true);
  assert.equal(toggleFocusLockState({ focusLocked: true }).focusLocked, false);
});

test('renameWindowInRegistry renames only the matching window', () => {
  const reg = { windows: [{ tkId: 'a', label: 'Window 1' }, { tkId: 'b', label: 'Window 2' }] };
  const out = renameWindowInRegistry(reg, 'b', 'Research');
  assert.deepEqual(out.windows.map(w => w.label), ['Window 1', 'Research']);
});

test('autoFollowWindow: focuses the active window only when unlocked', () => {
  const reg = { windows: [{ tkId: 'a', liveWindowId: 1 }, { tkId: 'b', liveWindowId: 2 }], focusedTkId: 'a', focusLocked: false };
  assert.equal(autoFollowWindow(reg, 2).focusedTkId, 'b');
  assert.equal(autoFollowWindow({ ...reg, focusLocked: true }, 2).focusedTkId, 'a');
  assert.equal(autoFollowWindow(reg, 999), reg);
});

test('groupWorkspacesByWindow: buckets tabs+groups per window, drops dashboard tab', () => {
  const tabs = [
    { url: 'https://a/', title: 'A', groupId: 1, index: 0, pinned: false, windowId: 1 },
    { url: 'chrome-extension://x/fullpage.html', title: 'TabKan', groupId: -1, index: 1, pinned: true, windowId: 1 },
    { url: 'https://b/', title: 'B', groupId: -1, index: 0, pinned: false, windowId: 2 },
  ];
  const groups = [
    { id: 1, title: 'G1', color: 'blue', collapsed: false, windowId: 1 },
    { id: 2, title: 'G2', color: 'red', collapsed: true, windowId: 2 },
  ];
  const byWin = groupWorkspacesByWindow(tabs, groups, 'chrome-extension://x/fullpage.html');
  assert.equal(byWin.get(1).tabs.length, 1);
  assert.equal(byWin.get(1).tabs[0].url, 'https://a/');
  assert.equal(byWin.get(1).groups.length, 1);
  assert.equal(byWin.get(2).tabs.length, 1);
  assert.equal(byWin.get(2).groups[0].title, 'G2');
});

test('rebindWindow: rebinds tkId to the live id and drops a placeholder for that live id', () => {
  const reg = { windows: [
    { tkId: 'a', label: 'Window 1', liveWindowId: null, lastSnapshot: { tabs: [{}], groups: [] } },
    { tkId: 'c', label: 'Window 2', liveWindowId: 2 },
  ], focusedTkId: 'a' };
  const out = rebindWindow(reg, 'a', 2);
  assert.deepEqual(out.windows.map(w => w.tkId), ['a']);
  assert.equal(out.windows[0].liveWindowId, 2);
});

test('rebindWindow: with null liveWindowId, only updates the target (no placeholder purge)', () => {
  const reg = { windows: [{ tkId: 'a', liveWindowId: 1 }, { tkId: 'b', liveWindowId: null }] };
  const out = rebindWindow(reg, 'b', null);
  assert.equal(out.windows.length, 2);
});

test('isSnapshotAlreadyOpen: true when a window holds >= threshold of the snapshot URLs', () => {
  assert.equal(isSnapshotAlreadyOpen(['a','b','c'], [new Set(['a','b','c'])]), true);   // 100%
  assert.equal(isSnapshotAlreadyOpen(['a','b','c'], [new Set(['a','b'])]), true);        // 66% >= 0.6
  assert.equal(isSnapshotAlreadyOpen(['a','b','c'], [new Set(['a'])]), false);           // 33%
  assert.equal(isSnapshotAlreadyOpen(['a','b','c'], [new Set(['x']), new Set(['a','b'])]), true); // 2nd window
  assert.equal(isSnapshotAlreadyOpen([], [new Set(['a'])]), false);                      // nothing to match
  assert.equal(isSnapshotAlreadyOpen(['a','b','c'], []), false);                         // no open windows
  assert.equal(isSnapshotAlreadyOpen(['a','b','c'], [['a','b']]), true);                 // accepts arrays too
  assert.equal(isSnapshotAlreadyOpen(['a','b','c','d'], [new Set(['a','b'])], 0.5), true); // custom threshold 50%
});

test('forgetSnapshotsInRegistry: clears snapshots for given tkIds and prunes unbound empties', () => {
  const reg = { windows: [
    { tkId: 'w1', liveWindowId: null, lastSnapshot: { tabs: [{}], groups: [] } },   // unbound + forgotten → pruned
    { tkId: 'w2', liveWindowId: 5,    lastSnapshot: { tabs: [{}], groups: [] } },   // live → kept, snapshot cleared
    { tkId: 'w3', liveWindowId: null, lastSnapshot: { tabs: [{}], groups: [] } },   // not forgotten → kept
  ], focusedTkId: 'w2' };
  const out = forgetSnapshotsInRegistry(reg, ['w1', 'w2']);
  assert.deepEqual(out.windows.map(w => w.tkId), ['w2', 'w3']);   // w1 pruned
  assert.equal(out.windows.find(w => w.tkId === 'w2').lastSnapshot, undefined);
  assert.ok(out.windows.find(w => w.tkId === 'w3').lastSnapshot);  // untouched
});

test('referencedGroupIds: only group ids that have tabs, excluding ungrouped (-1)', () => {
  const tabs = [{ groupId: 1 }, { groupId: 1 }, { groupId: -1 }, { groupId: 7 }, {}];
  assert.deepEqual([...referencedGroupIds(tabs)].sort((a,b)=>a-b), [1, 7]);
  assert.equal(referencedGroupIds([]).size, 0);
  assert.equal(referencedGroupIds(undefined).size, 0);
});
