// Function to open the dashboard, creating it if it doesn't exist.
const openOrCreateDashboard = async () => {
  const dashboardUrl = chrome.runtime.getURL('fullpage.html');
  // Check if a dashboard tab is already open.
  const tabs = await chrome.tabs.query({ url: dashboardUrl });
  if (tabs.length > 0) {
    // If it exists, focus it, pin it, and move to first position.
    await chrome.tabs.update(tabs[0].id, { active: true, pinned: true });
    await chrome.tabs.move(tabs[0].id, { index: 0 });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    // Otherwise, create a new dashboard tab, pinned at position 0.
    await chrome.tabs.create({ url: dashboardUrl, pinned: true, index: 0 });
  }
};

// --- Event Listeners ---

// When the extension is installed, create a context menu item.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open-kanban-dashboard",
    title: "Open TabKan",
    contexts: ["page"] // Show on any page
  });
});

// When the context menu item is clicked, open the dashboard.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-kanban-dashboard") {
    openOrCreateDashboard();
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
      const groups = await chrome.tabGroups.query({});
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
  if (tabs.length > 0) {
    try {
      await chrome.tabs.sendMessage(tabs[0].id, { action: "render" });
    } catch (error) {
      // Silently ignore connection errors - dashboard will render on load
      // This happens when the page is loading or if content script isn't ready
      // Check lastError to clear it
      const lastError = chrome.runtime.lastError;
      // No need to log, this is expected behavior
    }
  }
};

// Listen for tab and tab group changes to keep the dashboard updated.
// Note: Side panel updates automatically via its own event listeners
chrome.tabs.onCreated.addListener(() => {
  notifyDashboardToRender();
});

chrome.tabs.onRemoved.addListener(() => {
  notifyDashboardToRender();
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

  // If the dashboard tab itself is updated and now active, collapse all groups.
  if (tab.url === dashboardUrl && changeInfo.status === 'complete') {
    const groups = await chrome.tabGroups.query({});
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
  notifyDashboardToRender();
});

chrome.tabGroups.onRemoved.addListener(() => {
  notifyDashboardToRender();
});

// Combined listener for tab group updates - handles both dashboard render and auto-collapse
chrome.tabGroups.onUpdated.addListener(async (group) => {
  // Notify dashboard to render
  notifyDashboardToRender();

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