// Toolbar-icon popup: a small menu with "Dashboard" and "Side Menu".

// Prefetch the current window id at load (no gesture needed) so the side-panel
// open call can run synchronously inside the click handler — chrome.sidePanel.open
// must happen in the same user-gesture task, and an await before it can lose that.
let currentWindowId = null;
chrome.windows.getCurrent().then((w) => { currentWindowId = w.id; }).catch(() => {});

// Open (or focus) the dashboard tab IN THIS WINDOW. Scoping to the current
// window is what lets each browser window have its own dashboard — previously
// this matched a dashboard in any window, so opening it from a 2nd window just
// jumped you back to the first and a second dashboard could never be created.
const openDashboard = async () => {
  try {
    const url = chrome.runtime.getURL('fullpage.html');
    const win = await chrome.windows.getCurrent();
    const tabs = await chrome.tabs.query({ url, windowId: win.id });
    if (tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { active: true, pinned: true });
      await chrome.tabs.move(tabs[0].id, { index: 0 });
      await chrome.windows.update(win.id, { focused: true });
    } else {
      await chrome.tabs.create({ url, pinned: true, index: 0, windowId: win.id });
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
