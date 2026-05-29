// Shared pure helpers and constants for the TabKan dashboard.
// No DOM or chrome dependencies — safe to import anywhere.

// HTML-escape for safe interpolation into BOTH text nodes and double-quoted
// attribute values (encodes quotes too, unlike a textContent round-trip).
export const escapeHtml = (str) => {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// Safe favicon URL via Google's favicon service; neutral SVG fallback on bad URLs.
export const getFaviconUrl = (url) => {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}`;
  } catch {
    return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="%23666"/></svg>';
  }
};

// Debug logging (flip DEBUG to true to trace render/drag flow).
export const DEBUG = false;
export const log = (...args) => DEBUG && console.log(...args);
export const trace = (...args) => DEBUG && console.trace(...args);

// Performance and timing constants
export const RENDER_DEBOUNCE_MS = 300;
export const WAKE_TAB_POLL_INTERVAL_MS = 30;
export const EXTENSION_CHECK_INTERVAL_MS = 5000; // Check every 5 seconds
export const EXTENSION_CHECK_GRACE_PERIOD_MS = 3000; // Wait after page load before checking
export const EXTENSION_CHECK_RETRY_COUNT = 3; // Retry before reloading
export const SCROLL_ANIMATION_SPEED = 5;
export const EDGE_SCROLL_ZONE_PX = 120;

// UI layout constants
export const FOLDER_INDENT_REM = 1;
export const BOOKMARK_INDENT_REM = 1.5;
export const FOLDER_HEADER_BASE_REM = 0.5;
export const DRAG_HANDLE_OFFSET_PX = 10;

// Official Chromium tab-group colours (name -> hex), used for column accents.
export const CHROME_GROUP_COLORS = {
  grey: '#5F6368', blue: '#1A73E8', red: '#D93025', yellow: '#F9AB00',
  green: '#1E8E3E', pink: '#D01884', purple: '#9334E6', cyan: '#12B5CB',
  orange: '#FA903E',
};
