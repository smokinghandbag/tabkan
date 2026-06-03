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

// --- drag-vs-click discrimination ---------------------------------------
// A click that follows a drag of more than DRAG_CLICK_THRESHOLD_PX should be
// treated as the *end of a drag*, not a click. Tiles are draggable, so without
// this a small accidental drag fires the tile's primary action.
export const DRAG_CLICK_THRESHOLD_PX = 5;

// Squared distance between two {x,y} points (avoids a sqrt).
export const distanceSq = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

// Given a pointer-down origin and the click point, did the pointer move far
// enough to count as a drag? threshold defaults to DRAG_CLICK_THRESHOLD_PX.
export const movedLikeDrag = (downX, downY, upX, upY, threshold = DRAG_CLICK_THRESHOLD_PX) =>
  distanceSq(downX, downY, upX, upY) > threshold * threshold;

// --- Edit-tab modal helpers ---------------------------------------------

// Normalize a raw tag string: trim, strip leading '#'(s), collapse internal
// whitespace. Returns '' for empty/garbage. Tags are stored WITHOUT a '#'.
export const normalizeTag = (raw) => {
  if (raw == null) return '';
  return String(raw).trim().replace(/^#+/, '').trim().replace(/\s+/g, ' ');
};

// Completed / total counts for a to-do list (tolerant of missing fields).
export const todoProgress = (todos) => {
  const list = Array.isArray(todos) ? todos : [];
  const done = list.filter(t => t && t.completed).length;
  return { done, total: list.length };
};

// Autocomplete suggestions for the tag input.
//   allTags - iterable of known tag names (no '#')
//   query   - what the user typed (may include '#')
//   applied - tags already on this item (excluded from suggestions)
//   limit   - max suggestions to return
// Returns { matches, showCreate, createValue }:
//   matches     - matching tag names, prefix-matches first, then alphabetical
//   showCreate  - true when the query is non-empty, isn't an exact existing tag,
//                 and isn't already applied → offer a "Create #x" row
//   createValue - the normalized tag the create row would add
export const suggestTags = (allTags, query, applied = [], limit = 6) => {
  const q = normalizeTag(query).toLowerCase();
  const appliedSet = new Set(Array.from(applied, t => normalizeTag(t).toLowerCase()));
  const all = Array.from(allTags || []);
  let matches = [];
  if (q) {
    matches = all
      .filter(t => {
        const lc = normalizeTag(t).toLowerCase();
        return lc.includes(q) && !appliedSet.has(lc);
      })
      .sort((a, b) => {
        const la = a.toLowerCase(), lb = b.toLowerCase();
        const pa = la.startsWith(q) ? 0 : 1, pb = lb.startsWith(q) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return la.localeCompare(lb);
      })
      .slice(0, limit);
  }
  const existsExact = all.some(t => normalizeTag(t).toLowerCase() === q);
  const showCreate = q.length > 0 && !existsExact && !appliedSet.has(q);
  return { matches, showCreate, createValue: normalizeTag(query) };
};

// Split a tag name around the first case-insensitive occurrence of `query`,
// for highlighting the matched run: returns [before, match, after].
// No match (or empty query) → [name, '', ''].
export const splitMatch = (name, query) => {
  const n = String(name ?? '');
  const q = normalizeTag(query).toLowerCase();
  if (!q) return [n, '', ''];
  const i = n.toLowerCase().indexOf(q);
  if (i < 0) return [n, '', ''];
  return [n.slice(0, i), n.slice(i, i + q.length), n.slice(i + q.length)];
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
