// Workspace registry — the spine of multi-window support. Gives each Chrome window
// a stable TabKan id (decoupled from Chrome's volatile, restart-reassigned window
// ids), an auto-numbered + renamable label, and which window is currently focused
// on the dashboard. Phase A: pure helpers + thin storage layer (snapshots/restore
// arrive in Phase D). See docs/superpowers/specs/2026-06-18-multi-window-workspaces-design.md.

export const STORAGE_KEY = 'tabkanWorkspaces';

// Next "Window N" label — one past the highest existing Window-N number (or
// "Window 1" if none exist). Increments past the max rather than filling gaps
// so that renamed windows ("Work", "Research") never cause a reused number to
// appear alongside them.
export const nextWindowLabel = (windows) => {
  let max = 0;
  for (const w of windows || []) {
    const m = /^Window (\d+)$/.exec(w && w.label ? w.label : '');
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return `Window ${max + 1}`;
};

// Reconcile registry entries against the live Chrome windows. Known windows keep
// their tkId/label and are re-bound to their live id; closed windows are kept with
// liveWindowId=null (so a future Phase-D snapshot stays restorable); new windows get
// a fresh entry. `newId` generates a stable tkId (injected for testability).
//
// `liveWindowUrls` (optional Map<windowId, Set<url>>) enables cross-restart
// RE-ASSOCIATION: Chrome reassigns window ids when it reopens windows ("Continue
// where you left off"), so id-matching alone leaves every restored window looking
// brand-new while its old entry (with the snapshot) lingers unbound — i.e. the same
// window shows up as BOTH an open window and a restorable "closed session", and
// restoring that card duplicates an already-open window. To prevent that, an
// unbound live window is matched to the unbound entry whose snapshot URLs it best
// overlaps (≥ threshold) and rebound to it, before any fresh entry is created.
export const bindWindows = (prev, liveWindows, dashboardWindowId, newId, liveWindowUrls, threshold = 0.6) => {
  const live = (liveWindows || []).map(w => w.id);
  const liveSet = new Set(live);
  const boundIds = new Set();
  const result = (prev || []).map(entry => {
    const stillLive = liveSet.has(entry.liveWindowId);
    return {
      ...entry,
      liveWindowId: stillLive ? entry.liveWindowId : null,
      isPrimary: stillLive && entry.liveWindowId === dashboardWindowId,
    };
  });
  for (const w of result) if (w.liveWindowId != null) boundIds.add(w.liveWindowId);

  // Re-associate unbound live windows to unbound snapshot entries by URL overlap.
  const urlsByWin = liveWindowUrls instanceof Map ? liveWindowUrls : new Map();
  for (const id of live) {
    if (boundIds.has(id)) continue;
    const winUrls = urlsByWin.get(id);
    if (!winUrls || !winUrls.size) continue;
    let best = null, bestScore = 0;
    for (const entry of result) {
      if (entry.liveWindowId != null || !entry.lastSnapshot) continue;
      const snapUrls = (entry.lastSnapshot.tabs || []).map(t => t && t.url).filter(Boolean);
      if (!snapUrls.length) continue;
      let hits = 0;
      for (const u of snapUrls) if (winUrls.has(u)) hits++;
      const score = hits / snapUrls.length;
      if (score > bestScore) { bestScore = score; best = entry; }
    }
    if (best && bestScore >= threshold) {
      best.liveWindowId = id;
      best.isPrimary = id === dashboardWindowId;
      boundIds.add(id);
    }
  }

  for (const id of live) {
    if (boundIds.has(id)) continue;
    result.push({
      tkId: newId(),
      label: nextWindowLabel(result),
      liveWindowId: id,
      isPrimary: id === dashboardWindowId,
    });
  }
  return result;
};

// Which live window id the board should render: the focused window if it is still
// live, otherwise the dashboard's own window (safe default → single-window unchanged).
export const resolveFocusedWindowId = (registry, dashboardWindowId) => {
  const windows = (registry && registry.windows) || [];
  const focused = windows.find(w => w.tkId === (registry && registry.focusedTkId));
  if (focused && focused.liveWindowId != null) return focused.liveWindowId;
  return dashboardWindowId;
};

// View model for the window switcher: one entry per OPEN window (liveWindowId set).
// `visible` is true only with 2+ open windows (single-window users never see it).
// If focusedTkId is stale/closed, the primary window is shown as the effective focus
// so exactly one tab is always active.
export const switcherViewModel = (registry) => {
  const windows = ((registry && registry.windows) || [])
    .filter(w => w.liveWindowId != null)
    .map(w => ({
      tkId: w.tkId,
      label: w.label,
      isFocused: w.tkId === (registry && registry.focusedTkId),
      isPrimary: !!w.isPrimary,
    }));
  // The dashboard's own (primary) window is ALWAYS shown first — so it's "Window 1"
  // in the tabbed switcher (and chip 1 when collapsed). Stable so the rest keep
  // their relative order. (Array.sort is stable in Node/V8.)
  windows.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
  if (windows.length && !windows.some(w => w.isFocused)) {
    (windows.find(w => w.isPrimary) || windows[0]).isFocused = true;
  }
  // Display labels: renumber AUTO "Window N" labels by their position among the
  // currently-open windows (1-based), so the switcher shows "Window 1, 2…" rather
  // than the stored auto-number (which drifts as entries accumulate across restarts).
  // With the primary pinned first, the dashboard window is "Window 1".
  // Custom/renamed labels are shown as-is. tkId and the stored label are untouched.
  const isAutoLabel = (l) => /^Window \d+$/.test(l || '');
  windows.forEach((w, i) => { w.displayLabel = isAutoLabel(w.label) ? `Window ${i + 1}` : w.label; });
  // Closed sessions: saved snapshots for windows not currently open — offered in
  // the switcher as "open in a new window" so they're restorable any time.
  const closedSessions = ((registry && registry.windows) || [])
    .filter(w => w.liveWindowId == null && w.lastSnapshot &&
      (((w.lastSnapshot.tabs || []).length) || ((w.lastSnapshot.groups || []).length)))
    .map(w => ({
      tkId: w.tkId,
      label: w.label,
      groupCount: (w.lastSnapshot.groups || []).length,
      tabCount: (w.lastSnapshot.tabs || []).length,
      savedAt: w.lastSnapshot.savedAt,
    }));
  return {
    windows,
    closedSessions,
    locked: !!(registry && registry.focusLocked),
    visible: windows.length >= 2 || closedSessions.length > 0,
  };
};

// Reducers — each returns a NEW registry object (pure).
export const focusWindow = (registry, tkId) => ({ ...registry, focusedTkId: tkId, focusLocked: true });
export const toggleFocusLockState = (registry) => ({ ...registry, focusLocked: !(registry && registry.focusLocked) });
export const renameWindowInRegistry = (registry, tkId, label) => ({
  ...registry,
  windows: ((registry && registry.windows) || []).map(w => (w.tkId === tkId ? { ...w, label } : w)),
});
// Auto-follow: when unlocked, focus the window matching the just-activated live id.
// No-op (returns the SAME object) when locked, no match, or already focused.
export const autoFollowWindow = (registry, liveWindowId) => {
  if (!registry || registry.focusLocked) return registry;
  const match = (registry.windows || []).find(w => w.liveWindowId === liveWindowId);
  if (!match || match.tkId === registry.focusedTkId) return registry;
  return { ...registry, focusedTkId: match.tkId };
};

// Re-bind a registry entry (by tkId) to a live window id after a restore, removing
// any OTHER entry that was a placeholder for that same live window (else a restored
// window would appear twice in the switcher). No-op-safe when liveWindowId is null.
export const rebindWindow = (registry, tkId, liveWindowId) => ({
  ...registry,
  windows: ((registry && registry.windows) || [])
    .filter(w => w.tkId === tkId || liveWindowId == null || w.liveWindowId !== liveWindowId)
    .map(w => (w.tkId === tkId ? { ...w, liveWindowId } : w)),
});

// Group already-queried tabs+groups by their window into per-window snapshot
// content (excluding dashboard tabs). Returns Map<windowId, {groups, tabs}>.
export const groupWorkspacesByWindow = (allTabs, allGroups, dashboardUrl) => {
  const byWin = new Map();
  const ensure = (wid) => { if (!byWin.has(wid)) byWin.set(wid, { groups: [], tabs: [] }); return byWin.get(wid); };
  for (const g of allGroups || []) {
    ensure(g.windowId).groups.push({ id: g.id, title: g.title || 'Untitled Group', color: g.color, collapsed: g.collapsed });
  }
  for (const t of allTabs || []) {
    if (t.url === dashboardUrl) continue;
    ensure(t.windowId).tabs.push({ url: t.url, title: t.title, groupId: t.groupId, index: t.index, pinned: t.pinned });
  }
  return byWin;
};

// True if some currently-open window holds at least `threshold` of the snapshot's
// tab URLs — i.e. the snapshot's session appears to already be open (e.g. Chrome
// restored it). Open windows are given as an array of Sets (or arrays) of URLs.
export const isSnapshotAlreadyOpen = (snapshotTabUrls, openWindowUrlSets, threshold = 0.6) => {
  const urls = (snapshotTabUrls || []).filter(Boolean);
  if (!urls.length) return false;
  for (const s of (openWindowUrlSets || [])) {
    const set = s instanceof Set ? s : new Set(s || []);
    let hits = 0;
    for (const u of urls) if (set.has(u)) hits++;
    if (hits / urls.length >= threshold) return true;
  }
  return false;
};

// The set of group ids that have at least one tab in the snapshot (excludes the
// "ungrouped" sentinel -1). Used so restore skips creating empty groups.
export const referencedGroupIds = (tabs) => {
  const ids = new Set();
  for (const t of (tabs || [])) if (t && t.groupId != null && t.groupId !== -1) ids.add(t.groupId);
  return ids;
};

// Clear lastSnapshot for the given tkIds; drop entries that become unbound + empty.
export const forgetSnapshotsInRegistry = (registry, tkIds) => {
  const ids = new Set(tkIds || []);
  return {
    ...registry,
    windows: ((registry && registry.windows) || [])
      .map(w => (ids.has(w.tkId) ? { ...w, lastSnapshot: undefined } : w))
      .filter(w => !(w.liveWindowId == null && !w.lastSnapshot)),
  };
};

export const loadRegistry = async () => {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data[STORAGE_KEY] || { windows: [], focusedTkId: null, focusLocked: false };
  } catch (e) {
    return { windows: [], focusedTkId: null, focusLocked: false };
  }
};

export const saveRegistry = async (registry) => {
  try { await chrome.storage.local.set({ [STORAGE_KEY]: registry }); } catch (e) { /* best-effort */ }
};

// Generate a stable tkId. Uses crypto.randomUUID when available (MV3 dashboard has it).
const genTkId = () =>
  (globalThis.crypto && globalThis.crypto.randomUUID)
    ? `w_${globalThis.crypto.randomUUID()}`
    : `w_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

// Re-bind the registry to the current live windows and persist it. Returns the
// refreshed registry. `dashboardWindowId` is the window hosting this dashboard.
export const refreshRegistry = async (dashboardWindowId) => {
  const registry = await loadRegistry();
  let liveWindows = [];
  try { liveWindows = await chrome.windows.getAll(); } catch (e) { /* none */ }
  // Per-window live URL sets (excluding the dashboard tab) so bindWindows can
  // re-associate Chrome-restored windows to their entries across a restart.
  const urlsByWin = new Map();
  try {
    const dashUrl = chrome.runtime.getURL('fullpage.html');
    const liveTabs = await chrome.tabs.query({});
    for (const t of liveTabs) {
      if (!t.url || t.url === dashUrl) continue;
      if (!urlsByWin.has(t.windowId)) urlsByWin.set(t.windowId, new Set());
      urlsByWin.get(t.windowId).add(t.url);
    }
  } catch (e) { /* no tabs access → id-only binding */ }
  const before = JSON.stringify(registry.windows);
  registry.windows = bindWindows(registry.windows, liveWindows, dashboardWindowId, genTkId, urlsByWin);
  if (JSON.stringify(registry.windows) !== before) await saveRegistry(registry);
  return registry;
};

// The live window id whose board should render. Refreshes bindings first so a
// focused window that has closed falls back to the dashboard's own window.
export const getFocusedWindowId = async (dashboardWindowId) => {
  const registry = await refreshRegistry(dashboardWindowId);
  return resolveFocusedWindowId(registry, dashboardWindowId);
};

export const setFocusedWindow = async (tkId) => {
  const reg = await loadRegistry();
  await saveRegistry(focusWindow(reg, tkId));
};

export const toggleFocusLock = async () => {
  const reg = await loadRegistry();
  const next = toggleFocusLockState(reg);
  await saveRegistry(next);
  return !!next.focusLocked;
};

export const renameWindow = async (tkId, label) => {
  const reg = await loadRegistry();
  await saveRegistry(renameWindowInRegistry(reg, tkId, label));
};

// Apply auto-follow for the just-activated live window. Refreshes bindings first
// (so a newly-opened window is known), then follows if unlocked. Persists only on change.
export const applyAutoFollow = async (liveWindowId, dashboardWindowId) => {
  const reg = await refreshRegistry(dashboardWindowId);
  const next = autoFollowWindow(reg, liveWindowId);
  if (next !== reg) await saveRegistry(next);
};

// One refresh → both the focused window id (for rendering the board) and the
// switcher view model. Used by render() so it resolves the registry only once.
export const getRenderContext = async (dashboardWindowId) => {
  const reg = await refreshRegistry(dashboardWindowId);
  return {
    focusedWindowId: resolveFocusedWindowId(reg, dashboardWindowId),
    switcher: switcherViewModel(reg),
  };
};

// Capture EVERY open window's workspace into its registry entry's lastSnapshot
// (debounced via the dashboard's snapshot scheduler). Never clobbers a good
// snapshot with an empty one. Persists only when something changed.
export const captureAllWindowSnapshots = async (dashboardWindowId) => {
  const dashUrl = chrome.runtime.getURL('fullpage.html');
  let allTabs = [], allGroups = [];
  try {
    [allTabs, allGroups] = await Promise.all([chrome.tabs.query({}), chrome.tabGroups.query({})]);
  } catch (e) { return; }
  const byWin = groupWorkspacesByWindow(allTabs, allGroups, dashUrl);
  await refreshRegistry(dashboardWindowId);           // ensure live bindings are current
  const reg = await loadRegistry();                   // re-read just before mutate+save (avoid clobbering focus/lock)
  let changed = false;
  for (const w of reg.windows) {
    if (w.liveWindowId == null) continue;
    const snap = byWin.get(w.liveWindowId);
    if (snap && (snap.tabs.length || snap.groups.length)) {
      w.lastSnapshot = { savedAt: Date.now(), groups: snap.groups, tabs: snap.tabs };
      changed = true;
    }
  }
  if (changed) await saveRegistry(reg);
};

// Re-bind a registry entry (by tkId) to a live window id after a restore.
export const bindRestoredWindow = async (tkId, liveWindowId) => {
  const reg = await loadRegistry();
  await saveRegistry(rebindWindow(reg, tkId, liveWindowId));
};

// Forget the given windows' snapshots (used when the user dismisses a closed session).
export const forgetSnapshots = async (tkIds) => {
  const reg = await loadRegistry();
  await saveRegistry(forgetSnapshotsInRegistry(reg, tkIds));
};
