// TabKan - Side Panel Script
// This script runs in the browser's side panel (single instance, persistent across tabs)

(function() {
  'use strict';

  // Constants
  const SIDEBAR_WIDTH = '220px';

  // Chrome tab group color mapping (official Chromium colors)
  const CHROME_GROUP_COLORS = {
    'grey': '#5F6368',
    'blue': '#1A73E8',
    'red': '#D93025',
    'yellow': '#F9AB00',
    'green': '#1E8E3E',
    'pink': '#D01884',
    'purple': '#9334E6',
    'cyan': '#12B5CB',
    'orange': '#FA903E'
  };

  // Resolve a tab favicon: prefer the tab's own icon when it's a safe
  // http(s)/data URL, otherwise fetch one by hostname (Chrome often leaves
  // favIconUrl empty). Falls back to the extension icon only for bad URLs.
  const faviconFor = (favIconUrl, url) => {
    if (favIconUrl && /^(https?:|data:)/i.test(favIconUrl)) return favIconUrl;
    try {
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(url).hostname)}&sz=32`;
    } catch {
      return chrome.runtime.getURL('icons/icon16.png');
    }
  };

  // State
  let currentWindowId = null;
  let allGroupsCollapsed = false;
  let listenersInstalled = false;

  // Debounced re-render: high-frequency tab/group events (esp. onActivated, which
  // fires on every tab switch) would otherwise rebuild the whole panel synchronously.
  let renderDebounceTimer = null;
  const scheduleRender = () => {
    if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
    renderDebounceTimer = setTimeout(() => {
      renderDebounceTimer = null;
      renderSidebar();
    }, 150);
  };

  // Initialize sidebar
  const initSidebar = async () => {
    // Get current window
    const currentWindow = await chrome.windows.getCurrent();
    currentWindowId = currentWindow.id;

    // Render sidebar content
    await renderSidebar();

    // Set up message listeners for real-time updates
    setupMessageListeners();

    // Set up search
    const searchInput = document.getElementById('sidebar-search-input');
    searchInput.addEventListener('input', handleSearch);

    // Set up dashboard button
    const dashboardBtn = document.getElementById('open-dashboard-btn');
    dashboardBtn.addEventListener('click', async () => {
      try {
        const dashboardUrl = chrome.runtime.getURL('fullpage.html');
        // Check if dashboard is already open
        const tabs = await chrome.tabs.query({ url: dashboardUrl });
        if (tabs.length > 0) {
          // Dashboard is already open, focus it
          await chrome.tabs.update(tabs[0].id, { active: true });
        } else {
          // Open new dashboard tab
          await chrome.tabs.create({ url: dashboardUrl });
        }
      } catch (error) {
        console.error('[TabKan Sidebar] Error opening dashboard:', error);
      }
    });

    // Set up toggle all groups button
    const toggleAllGroupsBtn = document.getElementById('toggle-all-groups-btn');
    toggleAllGroupsBtn.addEventListener('click', () => {
      const groups = document.querySelectorAll('.sidebar-group');
      const icon = toggleAllGroupsBtn.querySelector('i');

      if (allGroupsCollapsed) {
        // Expand all
        groups.forEach(group => group.classList.remove('collapsed'));
        icon.className = 'fas fa-compress-alt';
        toggleAllGroupsBtn.title = 'Collapse All Groups';
        allGroupsCollapsed = false;
      } else {
        // Collapse all
        groups.forEach(group => group.classList.add('collapsed'));
        icon.className = 'fas fa-expand-alt';
        toggleAllGroupsBtn.title = 'Expand All Groups';
        allGroupsCollapsed = true;
      }
    });
  };

  // Render sidebar content with tabs and groups
  const renderSidebar = async () => {
    try {
      // Get tabs and groups for current window
      const [tabs, groups] = await Promise.all([
        chrome.tabs.query({ windowId: currentWindowId }),
        chrome.tabGroups.query({ windowId: currentWindowId })
      ]);

      // Find the active tab
      const activeTab = tabs.find(tab => tab.active);
      const activeTabId = activeTab ? activeTab.id : null;

      // Get sleeping tabs from storage
      const result = await chrome.storage.sync.get(['sleepingTabs']);
      const sleepingTabs = result.sleepingTabs || [];

      // Filter out TabKan dashboard
      const dashboardUrl = chrome.runtime.getURL('fullpage.html');
      const filteredTabs = tabs.filter(tab => tab.url !== dashboardUrl);
      filteredTabs.sort((a, b) => a.index - b.index);

      // Organize tabs by group
      const ungroupedTabs = [];
      const groupedTabs = {};

      filteredTabs.forEach(tab => {
        if (!tab.groupId || tab.groupId === -1) {
          ungroupedTabs.push(tab);
        } else {
          if (!groupedTabs[tab.groupId]) {
            groupedTabs[tab.groupId] = [];
          }
          groupedTabs[tab.groupId].push(tab);
        }
      });

      // Render content
      const contentContainer = document.getElementById('sidebar-content');
      if (!contentContainer) {
        console.error('[TabKan Sidebar] Content container not found!');
        return;
      }

      contentContainer.replaceChildren(); // Clear existing content

      // Sort groups by their first tab's index
      groups.sort((a, b) => {
        const aFirstTab = groupedTabs[a.id]?.[0];
        const bFirstTab = groupedTabs[b.id]?.[0];
        if (!aFirstTab) return 1;
        if (!bFirstTab) return -1;
        return aFirstTab.index - bFirstTab.index;
      });

      // Render grouped tabs first
      groups.forEach(group => {
        const groupTabs = groupedTabs[group.id] || [];
        if (groupTabs.length > 0) {
          const groupElement = createGroupElement(group, groupTabs, sleepingTabs, activeTabId);
          contentContainer.appendChild(groupElement);
        }
      });

      // Render ungrouped tabs last (if any)
      if (ungroupedTabs.length > 0) {
        const ungroupedSection = createGroupElement({
          id: 'ungrouped',
          title: 'Unfiled Tabs',
          color: 'grey',
          collapsed: false
        }, ungroupedTabs, sleepingTabs, activeTabId);
        contentContainer.appendChild(ungroupedSection);
      }

    } catch (error) {
      console.error('[TabKan Sidebar] Error rendering sidebar:', error);
    }
  };

  // Create group element with tabs
  const createGroupElement = (group, tabs, sleepingTabs, activeTabId) => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'sidebar-group';
    groupDiv.dataset.groupId = group.id;

    // Count total items (active + sleeping tabs)
    const groupSleepingTabs = sleepingTabs.filter(st => st.groupId === group.id);
    const totalCount = tabs.length + groupSleepingTabs.length;

    // Group header
    const header = document.createElement('div');
    header.className = 'group-header';

    // Apply Chrome group color to border (and subtle background tint)
    // TODO: Bug - group colors not matching Chrome browser colors exactly
    const groupColor = CHROME_GROUP_COLORS[group.color] || '#5F6368';
    header.style.borderLeftColor = groupColor;

    // Add a very subtle background tint of the group color (5% opacity)
    if (group.color) {
      header.style.background = `linear-gradient(to right, ${groupColor}08, #1d2026 40%)`;
    }

    // Create icon element (using Unicode, no Font Awesome needed)
    const icon = document.createElement('span');
    icon.className = 'group-toggle';

    // Create title element
    const titleSpan = document.createElement('span');
    titleSpan.className = 'group-title';
    titleSpan.textContent = group.title || 'Ungrouped';

    // Create count element
    const countSpan = document.createElement('span');
    countSpan.className = 'group-count';
    countSpan.textContent = totalCount.toString();

    header.appendChild(icon);
    header.appendChild(titleSpan);
    header.appendChild(countSpan);

    // Group content (tabs)
    const content = document.createElement('div');
    content.className = 'group-content';

    // Render active tabs (already sorted by index)
    tabs.forEach(tab => {
      const tabElement = createTabElement(tab, activeTabId);
      content.appendChild(tabElement);
    });

    // Render sleeping tabs for this group
    groupSleepingTabs.forEach(sleepingTab => {
      const tabElement = createSleepingTabElement(sleepingTab);
      content.appendChild(tabElement);
    });

    groupDiv.appendChild(header);
    groupDiv.appendChild(content);

    // Preserve gradient on hover
    if (group.color) {
      header.addEventListener('mouseenter', () => {
        header.style.background = `linear-gradient(to right, ${groupColor}12, #262a31 40%)`;
      });
      header.addEventListener('mouseleave', () => {
        header.style.background = `linear-gradient(to right, ${groupColor}08, #1d2026 40%)`;
      });
    }

    // Toggle collapse/expand
    header.addEventListener('click', () => {
      groupDiv.classList.toggle('collapsed');
    });

    // Allow drops on the group div
    groupDiv.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    // Drop handler on the group div (like dashboard's cardElement)
    groupDiv.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const placeholder = groupDiv.querySelector('.placeholder');
      if (!placeholder) {
        console.log('[TabKan Sidebar] No placeholder found on drop');
        // Clean up and return if no valid placeholder
        document.querySelectorAll('.placeholder').forEach(p => p.remove());
        document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
        return;
      }

      // Calculate drop index from placeholder position
      const dropIndex = Array.from(placeholder.parentElement.children)
        .filter(child => child.classList.contains('sidebar-tab') && !child.classList.contains('dragging'))
        .indexOf(placeholder.previousElementSibling) + 1;

      try {
        const tabId = parseInt(e.dataTransfer.getData('tabId'));
        const sourceGroupId = e.dataTransfer.getData('sourceGroupId');
        const targetGroupId = group.id;

        console.log('[TabKan Sidebar] Drop:', { tabId, sourceGroupId, targetGroupId, dropIndex });

        // Move tab to target group if different
        if (sourceGroupId !== targetGroupId.toString()) {
          if (targetGroupId === 'ungrouped') {
            await chrome.tabs.ungroup(tabId);
          } else {
            await chrome.tabs.group({ groupId: parseInt(targetGroupId), tabIds: [tabId] });
          }
        }

        // Get tabs in destination group after grouping change
        const queryInfo = targetGroupId === 'ungrouped'
          ? { windowId: currentWindowId, groupId: chrome.tabGroups.TAB_GROUP_ID_NONE }
          : { windowId: currentWindowId, groupId: parseInt(targetGroupId) };

        const tabsInDestGroup = await chrome.tabs.query(queryInfo);
        const sortedTabs = tabsInDestGroup.sort((a, b) => a.index - b.index);

        console.log('[TabKan Sidebar] Tabs in dest group:', sortedTabs.map(t => ({ id: t.id, index: t.index })));

        let targetWindowIndex = -1;

        if (dropIndex < sortedTabs.length) {
          const referenceTab = sortedTabs[dropIndex];
          if (referenceTab.id !== tabId) {
            targetWindowIndex = referenceTab.index;
          } else if (dropIndex + 1 < sortedTabs.length) {
            targetWindowIndex = sortedTabs[dropIndex + 1].index;
          }
        } else {
          // Dropping at the very end of the group (previously a silent no-op).
          const lastTab = sortedTabs[sortedTabs.length - 1];
          if (lastTab && lastTab.id !== tabId) {
            const draggedTab = sortedTabs.find(t => t.id === tabId);
            // If the dragged tab is already above the last tab, account for its removal.
            targetWindowIndex = (draggedTab && draggedTab.index < lastTab.index)
              ? lastTab.index
              : lastTab.index + 1;
          }
        }

        console.log('[TabKan Sidebar] Moving to index:', targetWindowIndex);

        // Move tab to calculated position
        if (targetWindowIndex !== -1) {
          await chrome.tabs.move(tabId, { index: targetWindowIndex });
        }

        // Clean up
        document.querySelectorAll('.placeholder').forEach(p => p.remove());
        document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));

        // Re-render sidebar to reflect the changes
        await renderSidebar();

      } catch (error) {
        console.error('[TabKan Sidebar] Error moving tab:', error);
        // Clean up on error
        document.querySelectorAll('.placeholder').forEach(p => p.remove());
        document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
        // Re-render on error to reset UI
        await renderSidebar();
      }
    });

    return groupDiv;
  };

  // Create tab element
  const createTabElement = (tab, activeTabId) => {
    const tabDiv = document.createElement('div');
    tabDiv.className = 'sidebar-tab';
    tabDiv.dataset.tabId = tab.id;
    tabDiv.dataset.groupId = tab.groupId || 'ungrouped';

    // Make tab draggable
    tabDiv.draggable = true;

    // Add active class if this is the active tab
    if (tab.id === activeTabId) {
      tabDiv.classList.add('active');
    }

    const title = tab.title || 'Untitled';
    const favicon = faviconFor(tab.favIconUrl, tab.url);

    // Build via DOM APIs (not innerHTML) so a hostile page title can't inject markup.
    const faviconImg = document.createElement('img');
    faviconImg.className = 'tab-favicon';
    faviconImg.src = favicon;
    faviconImg.alt = '';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = title;

    tabDiv.appendChild(faviconImg);
    tabDiv.appendChild(titleSpan);

    // Drag start
    tabDiv.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tab.id.toString());
      e.dataTransfer.setData('tabId', tab.id.toString());
      e.dataTransfer.setData('sourceGroupId', (tab.groupId || 'ungrouped').toString());
      tabDiv.classList.add('dragging');
    });

    // Drag end
    tabDiv.addEventListener('dragend', () => {
      tabDiv.classList.remove('dragging');
      // Remove all placeholders
      document.querySelectorAll('.placeholder').forEach(p => p.remove());
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    // Drag over - show placeholder
    tabDiv.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const draggingItem = document.querySelector('.dragging');
      if (draggingItem && draggingItem !== tabDiv) {
        const rect = tabDiv.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const isAbove = e.clientY < midpoint;

        // Remove existing placeholders
        document.querySelectorAll('.placeholder').forEach(p => p.remove());

        // Create new placeholder
        const placeholder = document.createElement('div');
        placeholder.className = 'placeholder';
        if (isAbove) {
          tabDiv.parentElement.insertBefore(placeholder, tabDiv);
        } else {
          tabDiv.parentElement.insertBefore(placeholder, tabDiv.nextSibling);
        }
      }
    });

    // Click to activate tab
    tabDiv.addEventListener('click', async (e) => {
      // Don't activate if dragging
      if (tabDiv.classList.contains('dragging')) return;

      try {
        await chrome.tabs.update(tab.id, { active: true });
      } catch (error) {
        console.error('[TabKan Sidebar] Error activating tab:', error);
      }
    });

    return tabDiv;
  };

  // Create sleeping tab element
  const createSleepingTabElement = (sleepingTab) => {
    const tabDiv = document.createElement('div');
    tabDiv.className = 'sidebar-tab sleeping';

    const title = sleepingTab.title || 'Untitled';
    const favicon = faviconFor(sleepingTab.favicon, sleepingTab.url);

    // Create elements
    const faviconImg = document.createElement('img');
    faviconImg.className = 'tab-favicon';
    faviconImg.src = favicon;
    faviconImg.alt = '';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = title;

    const moonIcon = document.createElement('span');
    moonIcon.className = 'sleeping-icon';
    moonIcon.textContent = '☾'; // Unicode crescent moon

    tabDiv.appendChild(faviconImg);
    tabDiv.appendChild(titleSpan);
    tabDiv.appendChild(moonIcon);

    // Click to wake sleeping tab (not implemented yet)
    tabDiv.addEventListener('click', async () => {
      // TODO: Implement wake functionality
      console.log('[TabKan Sidebar] Wake tab not yet implemented:', sleepingTab.title);
    });

    return tabDiv;
  };

  // Handle search
  const handleSearch = (e) => {
    const searchTerm = e.target.value.toLowerCase().trim();
    const groups = document.querySelectorAll('.sidebar-group');

    // If search is empty, show all tabs and reset groups
    if (searchTerm === '') {
      document.querySelectorAll('.sidebar-tab').forEach(tab => {
        tab.style.display = 'flex';
      });
      groups.forEach(group => {
        group.style.display = 'block';
      });
      return;
    }

    // Track which groups have matches
    const groupsWithMatches = new Set();

    // Filter tabs and track their groups
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
      const title = tab.querySelector('.tab-title').textContent.toLowerCase();
      const matchesSearch = title.includes(searchTerm);

      if (matchesSearch) {
        tab.style.display = 'flex';
        // Find parent group and mark it as having a match
        const parentGroup = tab.closest('.sidebar-group');
        if (parentGroup) {
          groupsWithMatches.add(parentGroup);
        }
      } else {
        tab.style.display = 'none';
      }
    });

    // Expand groups with matches, collapse others
    groups.forEach(group => {
      if (groupsWithMatches.has(group)) {
        group.style.display = 'block';
        group.classList.remove('collapsed');
      } else {
        group.classList.add('collapsed');
      }
    });
  };

  // Set up message listeners
  const setupMessageListeners = () => {
    // Guard against double-installation (would cause N x redundant renders per event).
    if (listenersInstalled) return;
    listenersInstalled = true;

    // Listen for tab/group changes to trigger a (debounced) re-render
    chrome.tabs.onCreated.addListener(() => scheduleRender());
    chrome.tabs.onRemoved.addListener(() => scheduleRender());
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      // Only re-render on meaningful changes
      if (changeInfo.title || changeInfo.favIconUrl) {
        scheduleRender();
      }
    });
    chrome.tabs.onActivated.addListener(() => scheduleRender());

    chrome.tabGroups.onCreated.addListener(() => scheduleRender());
    chrome.tabGroups.onRemoved.addListener(() => scheduleRender());
    chrome.tabGroups.onUpdated.addListener(() => scheduleRender());

    // Listen for storage changes (sleeping tabs, etc.)
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes.sleepingTabs) {
        scheduleRender();
      }
    });
  };

  // Initialize on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
  } else {
    initSidebar();
  }

})();
