// Toolbar-icon popup: a small menu with "Dashboard" and "Side Menu".
// Single-dashboard model: the dashboard lives in one "primary" window. In a
// secondary window (the dashboard is open elsewhere) we hide the Dashboard option
// and offer only the side panel.
import { dashboardPopupMode } from './src/utils.js';

const DASH_URL = chrome.runtime.getURL('fullpage.html');

// Prefetch the current window id at load (no gesture needed) so the side-panel
// open call can run synchronously inside the click handler — chrome.sidePanel.open
// must happen in the same user-gesture task, and an await before it can lose that.
let currentWindowId = null;
chrome.windows.getCurrent().then((w) => { currentWindowId = w.id; }).catch(() => {});

// Hide the Dashboard option when the dashboard lives in ANOTHER window (this is a
// secondary window → side panel only). On any error, leave the default (shown).
(async () => {
  try {
    const [win, tabs] = await Promise.all([
      chrome.windows.getCurrent(),
      chrome.tabs.query({ url: DASH_URL }),
    ]);
    if (dashboardPopupMode(tabs[0] || null, win.id) === 'secondary') {
      const btn = document.getElementById('open-dashboard');
      if (btn) btn.style.display = 'none';
    }
  } catch (e) { /* leave default */ }
})();

// Focus the single dashboard wherever it is, or create it in this window (which
// then becomes primary). In a primary window the existing dashboard is in THIS
// window, so this focuses it.
const openDashboard = async () => {
  try {
    const existing = await chrome.tabs.query({ url: DASH_URL });
    if (existing.length > 0) {
      const tab = existing[0];
      await chrome.tabs.update(tab.id, { active: true, pinned: true });
      await chrome.tabs.move(tab.id, { index: 0 });
      await chrome.windows.update(tab.windowId, { focused: true });
    } else {
      const win = await chrome.windows.getCurrent();
      await chrome.tabs.create({ url: DASH_URL, pinned: true, index: 0, windowId: win.id });
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
