// Session management: capture / save / restore / import-export of full
// workspaces (tabs, groups, bookmarks) plus the sessions dialog rendering.
import { state, ui } from './state.js';
import { escapeHtml } from './utils.js';
import { sessionsDialog, loadSessionDialog } from './dom.js';
import { saveData, showDialog, hideDialog } from './app.js';
import { captureAllWindowSnapshots, bindRestoredWindow, loadRegistry, referencedGroupIds, isSnapshotAlreadyOpen } from './workspaces.js';

  // --- Session Management Functions ---
  let sessions = [];

  // Load sessions from storage
export const loadSessions = async () => {
    const data = await chrome.storage.local.get(['sessions']);
    sessions = data.sessions || [];
    return sessions;
  };

  // Save sessions to storage
export const saveSessions = async () => {
    await chrome.storage.local.set({ sessions });
  };

  // Capture current workspace state
export const captureCurrentWorkspace = async () => {
    const [allTabs, allGroups, bookmarkTree] = await Promise.all([
      chrome.tabs.query({ currentWindow: true }),
      chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }),
      chrome.bookmarks.getTree()
    ]);

    // Filter out the dashboard tab itself
    const dashboardTab = allTabs.find(tab => tab.url && tab.url.includes('fullpage.html'));
    const tabs = allTabs.filter(tab => (!dashboardTab || tab.id !== dashboardTab.id));

    // Capture bookmarks (recursively capture the entire tree)
    const captureBookmarkNode = (node) => {
      const captured = {
        title: node.title,
        url: node.url,
        dateAdded: node.dateAdded
      };

      if (node.children) {
        captured.children = node.children.map(child => captureBookmarkNode(child));
      }

      return captured;
    };

    return {
      groups: allGroups.map(group => ({
        id: group.id,
        title: group.title || 'Untitled Group',
        color: group.color,
        collapsed: group.collapsed
      })),
      tabs: tabs.map(tab => ({
        url: tab.url,
        title: tab.title,
        groupId: tab.groupId,
        index: tab.index,
        pinned: tab.pinned,
        favicon: tab.favIconUrl
      })),
      bookmarks: bookmarkTree.map(node => captureBookmarkNode(node)),
      metadata: state.tabMetadata,
      collapsedCards: state.collapsedCards
    };
  };

  // Helper to count bookmarks recursively
export const countBookmarks = (bookmarkNodes) => {
    let count = 0;
    const traverse = (node) => {
      if (node.url) {
        count++; // It's a bookmark
      }
      if (node.children) {
        node.children.forEach(child => traverse(child));
      }
    };

    bookmarkNodes.forEach(node => traverse(node));
    return count;
  };

  // Save current workspace as a session
export const saveSession = async (name, description = '') => {
    const workspace = await captureCurrentWorkspace();
    const session = {
      id: Date.now(),
      name,
      description,
      created: Date.now(),
      lastUsed: Date.now(),
      workspace,
      stats: {
        groups: workspace.groups.length,
        tabs: workspace.tabs.length,
        bookmarks: countBookmarks(workspace.bookmarks || [])
      }
    };

    sessions.push(session);
    await saveSessions();
    return session;
  };

  // Delete a session
export const deleteSession = async (sessionId) => {
    sessions = sessions.filter(s => s.id !== sessionId);
    await saveSessions();
  };

  // Load/restore a session
export const loadSession = async (sessionId, mode = 'replace') => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return false;

    const workspace = session.workspace;

    if (mode === 'new-window') {
      // Open in new window
      const newWindow = await chrome.windows.create({ focused: true });
      await restoreWorkspaceToWindow(workspace, newWindow.id);
    } else {
      // Replace current tabs
      await restoreWorkspaceToWindow(workspace, chrome.windows.WINDOW_ID_CURRENT);
    }

    // Update last used timestamp
    session.lastUsed = Date.now();
    await saveSessions();

    return true;
  };

  // Restore workspace to a specific window
export const restoreWorkspaceToWindow = async (workspace, windowId) => {
    // Get all tabs in the target window
    const existingTabs = await chrome.tabs.query({ windowId });

    // Close all existing tabs except the dashboard (if in replace mode)
    const dashboardTab = existingTabs.find(tab => tab.url && tab.url.includes('fullpage.html'));
    const tabsToClose = existingTabs.filter(tab => !dashboardTab || tab.id !== dashboardTab.id);

    for (const tab of tabsToClose) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (error) {
        console.error('Error closing tab:', error);
      }
    }

    // Recreate groups and map old group IDs to new ones
    const groupIdMap = new Map(); // Map old group IDs to new group IDs
    const tempTabsToRemove = []; // Track temporary tabs to remove at the end

    for (const group of workspace.groups) {
      try {
        // Create a temporary tab for the group
        const tempTab = await chrome.tabs.create({ windowId, active: false, url: 'about:blank' });
        const newGroupId = await chrome.tabs.group({ tabIds: [tempTab.id] });

        // Update group properties
        await chrome.tabGroups.update(newGroupId, {
          title: group.title,
          color: group.color,
          collapsed: group.collapsed
        });

        groupIdMap.set(group.id, newGroupId);

        // Store temp tab to remove later (AFTER adding real tabs)
        tempTabsToRemove.push(tempTab.id);
      } catch (error) {
        console.error('Error creating group:', error);
      }
    }

    // Recreate tabs and add them to their groups
    for (const tabData of workspace.tabs) {
      try {
        const newTab = await chrome.tabs.create({
          windowId,
          url: tabData.url,
          pinned: tabData.pinned,
          active: false
        });

        // Add to group if it had one
        if (tabData.groupId !== -1 && groupIdMap.has(tabData.groupId)) {
          await chrome.tabs.group({
            groupId: groupIdMap.get(tabData.groupId),
            tabIds: [newTab.id]
          });
        }
      } catch (error) {
        console.error('Error creating tab:', error);
      }
    }

    // Now remove all temporary tabs (groups will remain because they have real tabs now)
    for (const tempTabId of tempTabsToRemove) {
      try {
        await chrome.tabs.remove(tempTabId);
      } catch (error) {
        // Temp tab might already be gone, ignore error
      }
    }

    // Restore bookmarks if present in the workspace
    if (workspace.bookmarks && workspace.bookmarks.length > 0) {
      try {
        // Get the current bookmark tree
        const currentTree = await chrome.bookmarks.getTree();

        // Clear all existing user bookmarks (keep root structure)
        // Root nodes are: 0=root, 1=Bookmarks Bar, 2=Other Bookmarks, 3=Mobile Bookmarks
        for (const rootNode of currentTree[0].children) {
          if (rootNode.children) {
            for (const child of rootNode.children) {
              try {
                if (child.children) {
                  // It's a folder, remove with removeTree
                  await chrome.bookmarks.removeTree(child.id);
                } else {
                  // It's a bookmark
                  await chrome.bookmarks.remove(child.id);
                }
              } catch (error) {
                // Ignore errors for items that can't be deleted
              }
            }
          }
        }

        // Recursively restore bookmarks
        const restoreBookmarkNode = async (node, parentId) => {
          // Skip the root node (id: "0")
          if (!node.title && !node.url && node.children) {
            // This is the root, process children
            for (const child of node.children) {
              await restoreBookmarkNode(child, parentId);
            }
            return;
          }

          // Skip Chrome's root folders by title, but process their children
          const rootFolderTitles = ['Bookmarks Bar', 'Other Bookmarks', 'Mobile Bookmarks', 'Bookmarks bar', 'Other bookmarks', 'Mobile bookmarks'];
          if (rootFolderTitles.includes(node.title) && node.children) {
            // Find matching root folder in Chrome
            const tree = await chrome.bookmarks.getTree();
            const matchingRoot = tree[0].children.find(root =>
              root.title.toLowerCase() === node.title.toLowerCase()
            );

            if (matchingRoot) {
              // Restore children to this root folder
              for (const child of node.children) {
                await restoreBookmarkNode(child, matchingRoot.id);
              }
            }
            return;
          }

          if (node.children) {
            // It's a folder
            const newFolder = await chrome.bookmarks.create({
              parentId: parentId,
              title: node.title
            });

            // Recursively restore children
            for (const child of node.children) {
              await restoreBookmarkNode(child, newFolder.id);
            }
          } else if (node.url) {
            // It's a bookmark
            await chrome.bookmarks.create({
              parentId: parentId,
              title: node.title,
              url: node.url
            });
          }
        };

        // Restore all bookmarks from the session
        for (const bookmarkRoot of workspace.bookmarks) {
          await restoreBookmarkNode(bookmarkRoot, '1'); // Start with Bookmarks Bar
        }

      } catch (error) {
        console.error('Error restoring bookmarks:', error);
      }
    }

    // Restore state data
    state.tabMetadata = workspace.metadata || {};
    state.collapsedCards = workspace.collapsedCards || {};

    await saveData();
  };

  // Export session as JSON
export const exportSession = (sessionId) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return null;

    const jsonStr = JSON.stringify(session, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `tab-ban-session-${session.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();

    URL.revokeObjectURL(url);
  };

  // Import session from JSON file
export const importSession = async (file) => {
    try {
      const text = await file.text();
      const importedSession = JSON.parse(text);

      // Validate session structure
      if (!importedSession.name || !importedSession.workspace || !importedSession.id) {
        throw new Error('Invalid session file: missing required fields');
      }

      // Check if session already exists with same ID
      const existingIndex = sessions.findIndex(s => s.id === importedSession.id);

      if (existingIndex !== -1) {
        // Ask user if they want to replace existing session
        const replace = confirm(`A session named "${sessions[existingIndex].name}" already exists. Replace it with the imported session?`);

        if (replace) {
          sessions[existingIndex] = importedSession;
        } else {
          // Generate new ID and add as new session
          importedSession.id = Date.now();
          importedSession.name += ' (imported)';
          sessions.push(importedSession);
        }
      } else {
        // Add as new session
        sessions.push(importedSession);
      }

      // Save to storage
      await saveSessions();

      // Refresh the sessions list
      renderSessions();

      alert(`Session "${importedSession.name}" imported successfully!`);

    } catch (error) {
      console.error('Import error:', error);
      alert(`Failed to import session: ${error.message}`);
    }
  };

export const renderSessions = async () => {
    await loadSessions();

    if (sessions.length === 0) {
      sessionsDialog.list.innerHTML = `
        <div class="empty-sessions">
          <i class="ph ph-floppy-disk"></i>
          <p>No saved sessions yet</p>
          <p style="font-size: 0.875rem;">Save your current workspace to quickly restore it later</p>
        </div>
      `;
      return;
    }

    sessionsDialog.list.innerHTML = sessions.map(session => {
      const date = new Date(session.created);
      const lastUsed = new Date(session.lastUsed);
      const formatDate = (d) => d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      return `
        <div class="session-card" data-session-id="${session.id}">
          <div>
            <div class="session-card-title">${escapeHtml(session.name)}</div>
            <div class="session-card-meta">
              <span><i class="ph ph-calendar-blank"></i> ${formatDate(date)}</span>
              <span><i class="ph ph-clock"></i> Used ${formatDate(lastUsed)}</span>
            </div>
            ${session.description ? `<div class="session-card-description">${escapeHtml(session.description)}</div>` : ''}
            <div class="session-card-stats">
              <span class="session-card-stat"><i class="ph ph-folder"></i> ${session.stats.groups} groups</span>
              <span class="session-card-stat"><i class="ph ph-browser"></i> ${session.stats.tabs} tabs</span>
              ${session.stats.bookmarks > 0 ? `<span class="session-card-stat"><i class="ph ph-bookmark-simple"></i> ${session.stats.bookmarks} bookmarks</span>` : ''}
            </div>
          </div>
          <div class="session-card-actions">
            <button class="btn btn-primary session-load-btn" data-session-id="${session.id}">
              <i class="ph ph-play"></i> Load
            </button>
            <button class="btn btn-secondary session-export-btn" data-session-id="${session.id}">
              <i class="ph ph-download-simple"></i> Export
            </button>
            <button class="btn btn-destructive session-delete-btn" data-session-id="${session.id}">
              <i class="ph ph-trash"></i> Delete
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Add event listeners to session cards
    sessionsDialog.list.querySelectorAll('.session-load-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        ui.currentSessionToLoad = parseInt(btn.dataset.sessionId);
        hideDialog(sessionsDialog);
        showDialog(loadSessionDialog);
      });
    });

    sessionsDialog.list.querySelectorAll('.session-export-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        exportSession(parseInt(btn.dataset.sessionId));
      });
    });

    sessionsDialog.list.querySelectorAll('.session-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to delete this session?')) {
          await deleteSession(parseInt(btn.dataset.sessionId));
          renderSessions();
        }
      });
    });
  };

  // --- Crash / quit recovery -------------------------------------------------
  let autoSnapshotTimer = null;

  // Debounced background snapshot. Called from the dashboard's render loop, so it
  // coalesces bursts of tab/group changes into a single capture a few seconds
  // after things settle.
  export const scheduleAutoSnapshot = () => {
    if (autoSnapshotTimer) clearTimeout(autoSnapshotTimer);
    autoSnapshotTimer = setTimeout(async () => {
      autoSnapshotTimer = null;
      try {
        const dash = await chrome.windows.getCurrent();
        await captureAllWindowSnapshots(dash && dash.id);
      } catch (e) {
        // best-effort: snapshotting must never break a render
      }
    }, 4000);
  };

  // Restore a stored session into its OWN window. The switcher's closed-session
  // cards are the single restore UI (no separate startup dialog any more).
  //
  // Guards against duplicating a session that is already on screen: if a live
  // window already holds most of the snapshot's URLs (e.g. Chrome restored it on
  // launch), we re-bind that window to this entry and focus it instead of opening
  // a second copy — which is what produced the "everything doubled" bug. Otherwise
  // we open a fresh window anchored to the first reachable tab and restore into it.
  export const restoreSessionToNewWindow = async (tkId) => {
    const reg = await loadRegistry();
    const entry = (reg.windows || []).find(w => w.tkId === tkId);
    if (!entry || !entry.lastSnapshot) return false;
    const snapTabs = entry.lastSnapshot.tabs || [];
    const snapUrls = snapTabs.map(t => t && t.url).filter(Boolean);

    // Suppress the dashboard's auto-follow for a moment: opening (or focusing) the
    // session window makes it the OS-focused window, which would otherwise switch
    // the dashboard's board to show that session — making it look like the session
    // also "opened" in the primary/dashboard window. Honoured by the
    // windows.onFocusChanged listener in app.js. The user can still click the
    // window's switcher tab to view it deliberately.
    try { await chrome.storage.local.set({ tkAutoFollowSuppressUntil: Date.now() + 3000 }); } catch (e) { /* best-effort */ }

    // Already open somewhere? Adopt that window rather than duplicate it — but ONLY
    // an UNBOUND window (one Chrome restored that re-association hasn't claimed yet).
    // A window already bound to another entry (e.g. the primary/dashboard window)
    // must never be adopted: incidental URL overlap would otherwise re-bind this
    // session onto it, clobber that entry, open no new window, and drop the card.
    const boundElsewhere = new Set(
      (reg.windows || []).filter(w => w.tkId !== tkId && w.liveWindowId != null).map(w => w.liveWindowId)
    );
    try {
      const liveTabs = await chrome.tabs.query({});
      const byWin = new Map();
      for (const t of liveTabs) {
        if (!t.url) continue;
        if (!byWin.has(t.windowId)) byWin.set(t.windowId, new Set());
        byWin.get(t.windowId).add(t.url);
      }
      for (const [winId, urls] of byWin) {
        if (winId === entry.liveWindowId || boundElsewhere.has(winId)) continue;
        if (isSnapshotAlreadyOpen(snapUrls, [urls])) {
          await bindRestoredWindow(tkId, winId);
          try { await chrome.windows.update(winId, { focused: true }); } catch (e) { /* best-effort */ }
          return true;
        }
      }
    } catch (e) { /* fall through to a fresh window */ }

    // Anchor the new window to the first reachable (http/https) tab so it opens
    // reliably with real content. That window-create tab is a disposable SEED: we
    // restore every snapshot tab as a fresh, stable tab (excludeTabIds keeps the
    // seed out of the by-URL claim), then drop the seed last — guarded so the
    // window is never momentarily empty. Operating on the seed directly while it's
    // still committing can make Chrome discard it and close a single-tab window.
    const anchorUrl = (snapTabs.find(t => t && t.url && /^https?:\/\//i.test(t.url)) || {}).url;
    const win = await chrome.windows.create(anchorUrl ? { url: anchorUrl, focused: true } : { focused: true });
    const seedIds = (win.tabs || []).map(t => t.id);
    await restoreSnapshotToWindow(entry.lastSnapshot, win.id, { excludeTabIds: seedIds });
    await bindRestoredWindow(tkId, win.id);
    // Drop the seed tab(s) now that the real restored tabs exist — but only if
    // doing so won't empty (and thus close) the window.
    try {
      const after = await chrome.tabs.query({ windowId: win.id });
      if (after.length > seedIds.length) {
        for (const id of seedIds) { try { await chrome.tabs.remove(id); } catch (e) { /* gone */ } }
      }
    } catch (e) { /* best-effort */ }
    return true;
  };

  // Recovery restore — deliberately leaner and safer than loadSession's
  // restoreWorkspaceToWindow:
  //   • Reconciles by URL: if a tab is already open (e.g. Chrome restored a few
  //     late), we CLAIM it into the right group instead of creating a duplicate.
  //   • Tabs + groups ONLY — it does NOT touch bookmarks or overwrite tabMetadata
  //     (the live copies in storage are already the latest; restoreWorkspaceToWindow
  //     would have wiped and rewritten all bookmarks, which is wrong for recovery).
  //   • opts.excludeTabIds: tab ids that must NOT be claimed/reused — used for the
  //     fresh window's volatile create-tab (the "seed"). Operating on that
  //     still-committing tab (group/ungroup/move) can make Chrome discard it, and
  //     a single-tab window then closes; instead we rebuild every snapshot tab as
  //     a fresh, stable tab and let the caller drop the seed afterwards.
export const restoreSnapshotToWindow = async (workspace, windowId = chrome.windows.WINDOW_ID_CURRENT, opts = {}) => {
    const dashUrl = chrome.runtime.getURL('fullpage.html');
    const excludeTabIds = new Set(opts.excludeTabIds || []);

    // Index already-open tabs by URL so we can claim rather than duplicate.
    const claimable = new Map(); // url -> [tabId, …]
    const existing = await chrome.tabs.query({ windowId });
    for (const t of existing) {
      if (t.url === dashUrl || excludeTabIds.has(t.id)) continue;
      if (!claimable.has(t.url)) claimable.set(t.url, []);
      claimable.get(t.url).push(t.id);
    }
    const claimUrl = (url) => {
      const ids = claimable.get(url);
      return (ids && ids.length) ? ids.shift() : null;
    };

    // Recreate groups; map snapshot groupId → new groupId. Seed each with a temp
    // tab (removed once real tabs are in) so the group survives until populated.
    const groupIdMap = new Map();
    const tempTabIds = [];
    const usedGroupIds = referencedGroupIds(workspace.tabs);
    for (const g of (workspace.groups || [])) {
      if (!usedGroupIds.has(g.id)) continue;
      try {
        const temp = await chrome.tabs.create({ windowId, active: false, url: 'about:blank' });
        const newGroupId = await chrome.tabs.group({ tabIds: [temp.id] });
        await chrome.tabGroups.update(newGroupId, { title: g.title, color: g.color, collapsed: g.collapsed });
        groupIdMap.set(g.id, newGroupId);
        tempTabIds.push(temp.id);
      } catch (e) { console.error('[TabKan] recovery: group create failed', e); }
    }

    // Place each snapshot tab: claim an existing same-URL tab if available,
    // otherwise create it; then move it to its group (or ungroup if it was loose).
    for (const tab of (workspace.tabs || [])) {
      try {
        let tabId = claimUrl(tab.url);
        if (tabId == null) {
          const created = await chrome.tabs.create({ windowId, url: tab.url, pinned: !!tab.pinned, active: false });
          tabId = created.id;
        }
        if (tab.groupId !== -1 && groupIdMap.has(tab.groupId)) {
          await chrome.tabs.group({ groupId: groupIdMap.get(tab.groupId), tabIds: [tabId] });
        } else {
          try { await chrome.tabs.ungroup(tabId); } catch { /* already ungrouped */ }
        }
      } catch (e) { console.error('[TabKan] recovery: tab restore failed', e); }
    }

    // Remove the temporary group-seed tabs (groups now hold real tabs).
    for (const id of tempTabIds) { try { await chrome.tabs.remove(id); } catch { /* gone */ } }
  };
