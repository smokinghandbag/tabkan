// Applies the saved theme BEFORE first paint to avoid a flash of the wrong
// theme. The CSP forbids inline scripts, so this runs as a tiny head <script>.
// chrome.storage is async, so we mirror the choice to localStorage (synchronous)
// and read it here; app.js keeps both in sync and storage.sync is the source of
// truth across devices.
(function () {
  try {
    if (localStorage.getItem('tabkan-theme') === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (e) { /* localStorage unavailable — fall back to default dark */ }
})();
