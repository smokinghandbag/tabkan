// Session management: capture / save / restore / import-export of full
// workspaces (tabs, groups, bookmarks) plus the sessions dialog rendering.
import { state, ui } from './state.js';
import { escapeHtml } from './utils.js';
import { sessionsDialog, loadSessionDialog } from './dom.js';
import { saveData, showDialog, hideDialog } from './app.js';

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
  // Chrome won't let an extension show a custom dialog when the browser closes,
  // and if the user hasn't enabled "Continue where you left off", quitting wipes
  // every tab and group. As a safety net we keep ONE rolling snapshot of the live
  // workspace in chrome.storage.local while the dashboard is open, then offer to
  // restore it on next open if the window came back empty.
  const AUTO_SESSION_KEY = 'autoSession';
  let autoSnapshotTimer = null;

  // Debounced background snapshot. Called from the dashboard's render loop, so it
  // coalesces bursts of tab/group changes into a single capture a few seconds
  // after things settle.
  export const scheduleAutoSnapshot = () => {
    if (autoSnapshotTimer) clearTimeout(autoSnapshotTimer);
    autoSnapshotTimer = setTimeout(async () => {
      autoSnapshotTimer = null;
      try {
        const workspace = await captureCurrentWorkspace();
        // Never clobber a good snapshot with an empty one (e.g. captured mid
        // session-restore, or on a transient blank window).
        if (workspace.tabs.length === 0 && workspace.groups.length === 0) return;
        await chrome.storage.local.set({
          [AUTO_SESSION_KEY]: { workspace, savedAt: Date.now() }
        });
      } catch (e) {
        // Best-effort: snapshotting must never break a render.
      }
    }, 4000);
  };

  const clearAutoSnapshot = async () => {
    try { await chrome.storage.local.remove(AUTO_SESSION_KEY); } catch (e) { /* ignore */ }
  };

  const removeRestoreBanner = () => {
    const el = document.getElementById('tk-recovery-banner');
    if (el) el.remove();
  };

  // Wait for the window to stop changing before we judge it "lost". When Chrome
  // is set to "Continue where you left off" it restores tabs ASYNCHRONOUSLY over
  // a second or two; deciding too early sees an empty window, offers a restore,
  // and then Chrome's own restore lands on top → duplicates. We poll until the
  // tab count holds steady for two consecutive checks (or a hard timeout).
  const waitForWindowToSettle = async () => {
    let last = -1;
    for (let i = 0; i < 15; i++) { // ~6s ceiling
      let count;
      try { count = (await chrome.tabs.query({ currentWindow: true })).length; }
      catch { return; }
      if (count === last) return; // stable
      last = count;
      await new Promise(r => setTimeout(r, 400));
    }
  };

  // "Lost" = Chrome reopened this window without the workspace: no groups and at
  // most one real (non-dashboard, non-new-tab) tab. Used both before showing the
  // banner AND re-checked at click time (Chrome may have restored in between).
  const windowLooksLost = async () => {
    const dashUrl = chrome.runtime.getURL('fullpage.html');
    const [tabs, groups] = await Promise.all([
      chrome.tabs.query({ currentWindow: true }),
      chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT })
    ]);
    const realTabs = tabs.filter(t => {
      const u = t.url || '';
      return u !== dashUrl && !/^chrome:\/\/(newtab|new-tab-page)/i.test(u);
    });
    return groups.length === 0 && realTabs.length <= 1;
  };

  // Recovery restore — deliberately leaner and safer than loadSession's
  // restoreWorkspaceToWindow:
  //   • Reconciles by URL: if a tab is already open (e.g. Chrome restored a few
  //     late), we CLAIM it into the right group instead of creating a duplicate.
  //   • Tabs + groups ONLY — it does NOT touch bookmarks or overwrite tabMetadata
  //     (the live copies in storage are already the latest; restoreWorkspaceToWindow
  //     would have wiped and rewritten all bookmarks, which is wrong for recovery).
  const restoreRecoverySnapshot = async (workspace) => {
    const windowId = chrome.windows.WINDOW_ID_CURRENT;
    const dashUrl = chrome.runtime.getURL('fullpage.html');

    // Index already-open tabs by URL so we can claim rather than duplicate.
    const existing = await chrome.tabs.query({ windowId });
    const claimable = new Map(); // url -> [tabId, …]
    for (const t of existing) {
      if (t.url === dashUrl) continue;
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
    for (const g of (workspace.groups || [])) {
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

  const showRestoreBanner = (snapshot, savedAt) => {
    removeRestoreBanner();

    const groupCount = snapshot.groups.length;
    const tabCount = snapshot.tabs.length;
    const stats = `${groupCount} group${groupCount === 1 ? '' : 's'} · ${tabCount} tab${tabCount === 1 ? '' : 's'}`;
    const when = savedAt
      ? new Date(savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : '';

    const banner = document.createElement('div');
    banner.id = 'tk-recovery-banner';
    banner.className = 'tk-recovery-banner';

    const info = document.createElement('div');
    info.className = 'tk-recovery-info';
    const icon = document.createElement('i');
    icon.className = 'ph ph-clock-counter-clockwise tk-recovery-icon';
    const textWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'tk-recovery-title';
    title.textContent = 'Restore your previous workspace?';
    const sub = document.createElement('div');
    sub.className = 'tk-recovery-sub';
    sub.textContent = when
      ? `Chrome reopened without your tabs. Snapshot from ${when} (${stats}).`
      : `Chrome reopened without your tabs. (${stats}).`;
    textWrap.appendChild(title);
    textWrap.appendChild(sub);
    info.appendChild(icon);
    info.appendChild(textWrap);

    const actions = document.createElement('div');
    actions.className = 'tk-recovery-actions';

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'btn btn-secondary';
    dismissBtn.textContent = 'Dismiss';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn btn-primary';
    restoreBtn.innerHTML = '<i class="ph ph-arrow-counter-clockwise"></i> Restore';

    restoreBtn.addEventListener('click', async () => {
      restoreBtn.disabled = true;
      dismissBtn.disabled = true;
      restoreBtn.innerHTML = '<i class="ph ph-circle-notch"></i> Restoring…';
      try {
        // Re-check at click time: Chrome may have finished restoring the session
        // between the banner appearing and the click. If the window is no longer
        // empty, Chrome already handled it — don't restore on top (that's what
        // produced duplicates). Just clear the snapshot and dismiss.
        if (!(await windowLooksLost())) {
          await clearAutoSnapshot();
        } else {
          await restoreRecoverySnapshot(snapshot);
        }
      } catch (e) {
        console.error('[TabKan] Workspace restore failed:', e);
      }
      removeRestoreBanner();
      // The freshly restored workspace becomes the next snapshot on the next render.
    });

    dismissBtn.addEventListener('click', async () => {
      // The user chose a fresh start — drop the snapshot so we don't nag on reload.
      await clearAutoSnapshot();
      removeRestoreBanner();
    });

    actions.appendChild(dismissBtn);
    actions.appendChild(restoreBtn);
    banner.appendChild(info);
    banner.appendChild(actions);
    document.body.appendChild(banner);
  };

  // Called once on dashboard init. Shows the restore banner only when there is a
  // non-empty snapshot AND the current window looks "lost" (Chrome came back with
  // no groups and at most one real tab) — otherwise it stays silent.
  export const maybeOfferRestore = async () => {
    try {
      const data = await chrome.storage.local.get(AUTO_SESSION_KEY);
      const auto = data[AUTO_SESSION_KEY];
      if (!auto || !auto.workspace) return;

      const snap = auto.workspace;
      const snapHasContent =
        (snap.tabs && snap.tabs.length > 0) || (snap.groups && snap.groups.length > 0);
      if (!snapHasContent) return;

      // Let Chrome's own session restore finish before deciding — otherwise we
      // race it and end up duplicating everything.
      await waitForWindowToSettle();

      // Only offer if the window genuinely came back empty (Chrome didn't restore).
      if (!(await windowLooksLost())) return;

      showRestoreBanner(snap, auto.savedAt);
    } catch (e) {
      // Recovery is best-effort; never block dashboard load.
    }
  };
