// Toolbar-icon popup: a small menu with "Dashboard" and "Side Menu".

// Prefetch the current window id at load (no gesture needed) so the side-panel
// open call can run synchronously inside the click handler — chrome.sidePanel.open
// must happen in the same user-gesture task, and an await before it can lose that.
let currentWindowId = null;
chrome.windows.getCurrent().then((w) => { currentWindowId = w.id; }).catch(() => {});

// Open (or focus) the dashboard tab.
const openDashboard = async () => {
  try {
    const url = chrome.runtime.getURL('fullpage.html');
    const tabs = await chrome.tabs.query({ url });
    if (tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { active: true, pinned: true });
      await chrome.tabs.move(tabs[0].id, { index: 0 });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url, pinned: true, index: 0 });
    }
  } catch (error) {
    console.error('[TabKan] Error opening dashboard:', error);
  } finally {
    window.close();
  }
};

// Open the side panel for the current window. Called synchronously (no await
// before the open) to preserve the user gesture.
const openSidePanel = () => {
  try {
    const opts = currentWindowId != null ? { windowId: currentWindowId } : {};
    const result = chrome.sidePanel.open(opts);
    if (result && typeof result.finally === 'function') {
      result.catch((e) => console.error('[TabKan] Error opening side panel:', e))
            .finally(() => window.close());
    } else {
      window.close();
    }
  } catch (error) {
    console.error('[TabKan] Error opening side panel:', error);
    window.close();
  }
};

document.getElementById('open-dashboard').addEventListener('click', openDashboard);
document.getElementById('open-sidepanel').addEventListener('click', openSidePanel);
