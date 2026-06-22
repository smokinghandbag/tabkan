// Single-dashboard model: exactly one "primary" dashboard across the profile (the
// window hosting the dashboard tab). If a dashboard exists in ANY window, focus it
// (never create a second). Only create one — in `preferredWindowId` (or the current
// window) — when none exists; that window becomes primary.
const openOrCreateDashboard = async (preferredWindowId) => {
  const dashboardUrl = chrome.runtime.getURL('fullpage.html');
  const existing = await chrome.tabs.query({ url: dashboardUrl });
  if (existing.length > 0) {
    const tab = existing[0];
    await chrome.tabs.update(tab.id, { active: true, pinned: true });
    await chrome.tabs.move(tab.id, { index: 0 });
    await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  const createProps = { url: dashboardUrl, pinned: true, index: 0 };
  if (preferredWindowId != null) createProps.windowId = preferredWindowId;
  await chrome.tabs.create(createProps);
};

// --- Event Listeners ---

// On install: create the context menu item, and (first install only) open a
// one-time welcome tab that shows how to pin the toolbar icon. Chrome doesn't
// let an extension pin itself, so this nudges the user to do it.
chrome.runtime.onInstalled.addListener((details) => {
  // Recreate the context menu from a clean slate. onInstalled fires on UPDATE too,
  // and the previous version's "open-kanban-dashboard" item still exists then, so a
  // bare create() throws "Cannot create item with duplicate id" (a benign but noisy
  // runtime.lastError). removeAll() clears it first.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "open-kanban-dashboard",
      title: "Open TabKan",
      contexts: ["page"] // Show on any page
    });
  });

  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});

// When the context menu item is clicked, open the dashboard.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-kanban-dashboard") {
    openOrCreateDashboard(tab && tab.windowId);
  }
});

// (The toolbar icon opens popup.html — see action.default_popup in the manifest —
// so there is no chrome.action.onClicked handler here.)

// When the user switches to a tab, check if it's the dashboard and collapse groups.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const dashboardUrl = chrome.runtime.getURL('fullpage.html');
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url === dashboardUrl) {
      // Collapse groups only in the dashboard's own (primary) window — not every
      // window's groups.
      const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
      for (const group of groups) {
        try {
          await chrome.tabGroups.update(group.id, { collapsed: true });
        } catch (error) {
          // Silently ignore errors when user is dragging tabs
          if (error.message && !error.message.includes('user may be dragging')) {
            console.error('Error collapsing tab group:', error);
          }
        }
      }
    }
  } catch (error) {
    // Tab may have been closed, ignore
  }
});

// To keep the dashboard in sync, we can notify it to re-render when changes occur.
const notifyDashboardToRender = async () => {
  const dashboardUrl = chrome.runtime.getURL('fullpage.html');
  const tabs = await chrome.tabs.query({ url: dashboardUrl });
  // Notify the dashboard to re-render. Normally there is one (the primary window's),
  // but we loop over all matches to also handle any legacy/leftover dashboard tabs.
  for (const t of tabs) {
    try {
      await chrome.tabs.sendMessage(t.id, { action: "render" });
    } catch (error) {
      // Expected when a dashboard is still loading / not listening yet.
      const lastError = chrome.runtime.lastError; // read to clear it
    }
  }
};

// Listen for tab and tab group changes to keep the dashboard updated.
// Note: Side panel updates automatically via its own event listeners
chrome.tabs.onCreated.addListener(() => {
  debouncedNotifyDashboard();
});

chrome.tabs.onRemoved.addListener(() => {
  debouncedNotifyDashboard();
});

chrome.tabs.onMoved.addListener(async () => {
  // Check if dashboard is enforcing tab order - if so, don't trigger render
  // (this would create an infinite render loop)
  try {
    const { isEnforcingTabOrder } = await chrome.storage.local.get('isEnforcingTabOrder');
    if (isEnforcingTabOrder) {
      return;
    }
  } catch (error) {
    // Ignore storage errors
  }

  debouncedNotifyDashboard();
});

// A tab moving BETWEEN windows changes the global (all-windows) board, so every
// open dashboard needs to re-render — not just the one in the affected window.
chrome.tabs.onAttached.addListener(() => debouncedNotifyDashboard());
chrome.tabs.onDetached.addListener(() => debouncedNotifyDashboard());

// Debounce render notifications to prevent flashing
let renderDebounceTimer = null;
const debouncedNotifyDashboard = () => {
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
  }
  renderDebounceTimer = setTimeout(() => {
    notifyDashboardToRender();
    renderDebounceTimer = null;
  }, 300); // Match RENDER_DEBOUNCE_MS in fullpage.js
};

// A more intelligent onUpdated listener
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const dashboardUrl = chrome.runtime.getURL('fullpage.html');

  // When the dashboard finishes loading, collapse the groups in its OWN window.
  if (tab.url === dashboardUrl && changeInfo.status === 'complete') {
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
    for (const group of groups) {
      try {
        await chrome.tabGroups.update(group.id, { collapsed: true });
      } catch (error) {
        // Silently ignore errors when user is dragging tabs
        if (error.message && !error.message.includes('user may be dragging')) {
          console.error('Error collapsing tab group:', error);
        }
      }
    }
  } else if (tab.url !== dashboardUrl && (changeInfo.title || changeInfo.favIconUrl)) {
    // Only render on meaningful changes (title or favicon), not every status change
    debouncedNotifyDashboard();
  }
});

chrome.tabGroups.onCreated.addListener(() => {
  debouncedNotifyDashboard();
});

chrome.tabGroups.onRemoved.addListener(() => {
  debouncedNotifyDashboard();
});

// A group being reordered (incl. moved between windows) also changes the board.
chrome.tabGroups.onMoved.addListener(() => {
  debouncedNotifyDashboard();
});

// Combined listener for tab group updates - handles both dashboard render and auto-collapse
chrome.tabGroups.onUpdated.addListener(async (group) => {
  // Skip the re-render NOTIFY (only) for the dashboard's OWN group writes
  // (rename/collapse/color) — it sets tkGroupMutationUntil before such writes.
  // Auto-collapse below must still run regardless. Mirrors the isEnforcingTabOrder guard.
  let selfMutation = false;
  try {
    const { tkGroupMutationUntil } = await chrome.storage.local.get('tkGroupMutationUntil');
    selfMutation = typeof tkGroupMutationUntil === 'number' && Date.now() < tkGroupMutationUntil;
  } catch (e) { /* ignore storage errors — treat as not-self-mutation */ }

  // Notify dashboard to render (debounced so an auto-collapse cascade coalesces).
  if (!selfMutation) debouncedNotifyDashboard();

  // Read settings from storage to ensure the latest value is used
  const { settings } = await chrome.storage.sync.get('settings');
  const autoCollapseEnabled = settings && settings.autoCollapseGroups;

  // Auto-collapse other groups if enabled
  if (autoCollapseEnabled && group.collapsed === false) {
    // Get all groups in the same window
    const allGroups = await chrome.tabGroups.query({ windowId: group.windowId });

    // Collapse all other groups
    for (const otherGroup of allGroups) {
      if (otherGroup.id !== group.id && !otherGroup.collapsed) {
        try {
          await chrome.tabGroups.update(otherGroup.id, { collapsed: true });
        } catch (error) {
          // Silently ignore errors when user is dragging tabs
          if (error.message && !error.message.includes('user may be dragging')) {
            console.error('Error auto-collapsing tab group:', error);
          }
        }
      }
    }
  }
});
