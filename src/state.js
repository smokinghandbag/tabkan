// Shared, mutable application state for the TabKan dashboard.
//
// `state` holds persisted data (mirrored to chrome.storage). `ui` holds
// transient runtime flags/values that are read and written across modules;
// keeping them on a single exported object lets modules share them (ES module
// bindings can't be reassigned across module boundaries, but object properties
// can be mutated freely).

export const state = {
  tabMetadata: {},
  sidebarCollapsed: false,
  bookmarkFolderId: null,
  collapsedCards: {},
  sleepingTabs: [],
  settings: { autoCollapseGroups: false },
};

// Only values that are read/written across module boundaries live here.
// Render-engine-local flags (isRendering, isDragging, timers, etc.) stay
// private to app.js.
export const ui = {
  taskRollupFilter: 'all',        // 'all' | 'incomplete' | 'completed'
  activeTagFilters: new Set(['all']),
  availableTags: new Set(),
  searchTerm: '',
  isWakingTab: false,             // wake operation in progress
  isChromeApiOperationInProgress: false,
  currentSessionToLoad: null,     // session id queued by the sessions dialog
};
