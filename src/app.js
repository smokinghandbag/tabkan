// TabKan dashboard — entry module.
// (Converted from a single window-load IIFE to an ES module. Module scripts are
// deferred, so the DOM is ready by the time this runs; top-level await is valid.)
import {
  escapeHtml, getFaviconUrl, DEBUG, log, trace,
  RENDER_DEBOUNCE_MS, WAKE_TAB_POLL_INTERVAL_MS, EXTENSION_CHECK_INTERVAL_MS,
  EXTENSION_CHECK_GRACE_PERIOD_MS, EXTENSION_CHECK_RETRY_COUNT,
  SCROLL_ANIMATION_SPEED, EDGE_SCROLL_ZONE_PX,
  FOLDER_INDENT_REM, BOOKMARK_INDENT_REM, FOLDER_HEADER_BASE_REM, DRAG_HANDLE_OFFSET_PX,
  CHROME_GROUP_COLORS,
} from './utils.js';
import { state, ui } from './state.js';
import {
  cardsContainer, unfiledTabsContainer, sidebarScrollWrapper, dialogOverlay,
  renameDialog, deleteDialog, warningDialog, taskWarningDialog, createCardDialog,
  editNoteDialog, settingsDialog, sessionsDialog, saveSessionDialog, loadSessionDialog,
  tagManagerDialog, searchInput, sidebar, sidebarToggle, sidebarCollapseBtn,
  collapsedFavicons, tabBin, tabBinCollapsed, bookmarksCardContainer, taskRollupContainer,
} from './dom.js';
import { renderBookmarksIfDirty, invalidateBookmarkCache } from './bookmarks.js';
import { hasUnfinishedTasks, getUnfinishedTasks, aggregateAllTasks, renderTaskRollup, renderCollapsedTaskRollup } from './tasks.js';
import { renderSessions, saveSession, loadSession, importSession } from './sessions.js';

  // Auto-pin this dashboard tab as the first tab
  try {
    const currentTab = await chrome.tabs.getCurrent();
    if (currentTab) {
      // Pin the tab and move to position 0
      await chrome.tabs.update(currentTab.id, { pinned: true });
      await chrome.tabs.move(currentTab.id, { index: 0 });
    }
  } catch (error) {
    console.error('Error auto-pinning dashboard tab:', error);
  }



  let isRendering = false; // Rendering lock
  let isDragging = false; // Track drag operations
  let renderTimeout = null; // Debounce timer for render
  let pendingRender = false; // Flag for queued render
  let editDialogAbortController = null; // AbortController for edit dialog cleanup
  let saveDataTimeout = null; // Debounce timer for storage writes
  let bookmarkChangeTimeout = null; // Debounce timer for bookmark changes

  // Debounced storage write to prevent quota exhaustion
  export const saveData = (shouldRender = true) => {
    // Clear existing timeout
    if (saveDataTimeout) {
      clearTimeout(saveDataTimeout);
    }

    // Debounce storage writes by 500ms
    saveDataTimeout = setTimeout(() => {
      const promise = chrome.storage.sync.set({
        tabMetadata: state.tabMetadata,
        sidebarCollapsed: state.sidebarCollapsed,
        collapsedCards: state.collapsedCards,
        settings: state.settings
      });
      if (shouldRender) {
        promise.then(() => {
          collectTags();
          render();
        });
      }
      saveDataTimeout = null;
      return promise;
    }, 500);
  };

  // Show task warning dialog
  const showTaskWarningDialog = (tabUrl, tabTitle, onComplete, onCloseAnyway) => {
    const unfinishedTasks = getUnfinishedTasks(tabUrl);

    // Populate task list
    taskWarningDialog.list.innerHTML = `
      <ul>
        ${unfinishedTasks.map(task => `<li><i class="fas fa-circle"></i><span>${escapeHtml(task.text)}</span></li>`).join('')}
      </ul>
    `;

    // Show dialog
    dialogOverlay.classList.remove("hidden");
    taskWarningDialog.element.classList.remove("hidden");

    // Set up button handlers (remove any existing listeners)
    const cancelHandler = () => {
      hideDialog(taskWarningDialog);
    };

    const completeHandler = () => {
      // Mark all tasks as completed
      if (state.tabMetadata[tabUrl] && state.tabMetadata[tabUrl].todos) {
        state.tabMetadata[tabUrl].todos.forEach(todo => todo.completed = true);
        saveData(false); // Don't re-render yet
      }
      hideDialog(taskWarningDialog);
      onComplete();
    };

    const closeAnywayHandler = () => {
      hideDialog(taskWarningDialog);
      onCloseAnyway();
    };

    // Remove old listeners and add new ones
    taskWarningDialog.cancel.replaceWith(taskWarningDialog.cancel.cloneNode(true));
    taskWarningDialog.complete.replaceWith(taskWarningDialog.complete.cloneNode(true));
    taskWarningDialog.closeAnyway.replaceWith(taskWarningDialog.closeAnyway.cloneNode(true));

    // Re-get references after cloning
    taskWarningDialog.cancel = document.getElementById("task-warning-cancel");
    taskWarningDialog.complete = document.getElementById("task-warning-complete");
    taskWarningDialog.closeAnyway = document.getElementById("task-warning-close-anyway");

    taskWarningDialog.cancel.addEventListener("click", cancelHandler);
    taskWarningDialog.complete.addEventListener("click", completeHandler);
    taskWarningDialog.closeAnyway.addEventListener("click", closeAnywayHandler);
  };

  // Helper function to get sleeping tab data before sleeping
  const toggleSidebar = () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    sidebar.classList.toggle("collapsed", state.sidebarCollapsed);

    // Update toggle button icon
    const toggleIcon = sidebarToggle.querySelector("i");
    if (state.sidebarCollapsed) {
      toggleIcon.className = "fas fa-chevron-right";
    } else {
      toggleIcon.className = "fas fa-chevron-left";
    }

    saveData(false); // Don't re-render, just save the state
  };

  sidebarToggle.addEventListener("click", toggleSidebar);
  sidebarCollapseBtn.addEventListener("click", toggleSidebar);

  // Event delegation for "Open new tab" buttons
  cardsContainer.addEventListener("click", async (e) => {
    const openTabBtn = e.target.closest('.open-tab-btn');
    if (openTabBtn) {
      const groupId = parseInt(openTabBtn.dataset.groupId);

      // Create new tab and make it active
      const newTab = await chrome.tabs.create({
        active: true,
        url: 'chrome://newtab'
      });

      // Add to group if not unfiled
      if (groupId !== 'unfiled' && groupId > -1) {
        await chrome.tabs.group({
          tabIds: newTab.id,
          groupId: groupId
        });
      }

      // Render will be triggered by background script
    }
  });

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "render") {
      log('📨 Render message from background (ui.isWakingTab:', ui.isWakingTab, ')');
      // Don't render if we're in the middle of waking a tab.
      // Debounced so bursts (e.g. session restore creating many tabs) coalesce.
      if (!ui.isWakingTab) {
        debouncedRender();
      }
    }
  });

  // Detect if extension context is invalidated and reload the page
  let extensionCheckFailures = 0;
  let pageLoadTime = Date.now();

  const checkExtensionContext = () => {
    const timeSinceLoad = Date.now() - pageLoadTime;

    // Don't check immediately after page load to avoid false positives during initialization
    if (timeSinceLoad < EXTENSION_CHECK_GRACE_PERIOD_MS) {
      return;
    }

    // Don't check during Chrome API operations (like creating groups/tabs)
    if (ui.isChromeApiOperationInProgress) {
      return;
    }

    if (!chrome.runtime?.id) {
      extensionCheckFailures++;

      // Only reload after multiple consecutive failures
      if (extensionCheckFailures >= EXTENSION_CHECK_RETRY_COUNT) {
        console.log('Extension context invalidated, reloading page...');
        location.reload();
      }
    } else {
      // Reset failure count if context is valid
      extensionCheckFailures = 0;
    }
  };

  // Check context periodically and on visibility change
  setInterval(checkExtensionContext, EXTENSION_CHECK_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    // Reset page load time on visibility change to give extension time to reconnect
    if (document.visibilityState === 'visible') {
      pageLoadTime = Date.now();
      extensionCheckFailures = 0;
    }
    checkExtensionContext();
  });

  // Helper function to wrap Chrome API operations with context check protection
  const withChromeApiProtection = async (operation) => {
    ui.isChromeApiOperationInProgress = true;
    try {
      return await operation();
    } finally {
      ui.isChromeApiOperationInProgress = false;
    }
  };

  export const showDialog = (dialog) => {
    dialogOverlay.classList.remove("hidden");
    dialog.element.classList.remove("hidden");
  };

  export const hideDialog = (dialog) => {
    dialogOverlay.classList.add("hidden");
    dialog.element.classList.add("hidden");
  };

  // Close dialog when clicking overlay (outside dialog)
  dialogOverlay.addEventListener("click", (e) => {
    if (e.target === dialogOverlay) {
      // Find which dialog is currently open and close it
      if (!renameDialog.element.classList.contains("hidden")) {
        hideDialog(renameDialog);
        // Clean up event listeners using AbortController
        if (editDialogAbortController) {
          editDialogAbortController.abort();
          editDialogAbortController = null;
        }
      } else if (!tagManagerDialog.element.classList.contains("hidden")) {
        hideDialog(tagManagerDialog);
      } else if (!settingsDialog.element.classList.contains("hidden")) {
        hideDialog(settingsDialog);
      } else if (!sessionsDialog.element.classList.contains("hidden")) {
        hideDialog(sessionsDialog);
      } else if (!createCardDialog.element.classList.contains("hidden")) {
        hideDialog(createCardDialog);
      }
      // Note: Other dialogs may have specific close handlers, keeping them as-is
    }
  });

  const updateTagSuggestions = () => {
    renameDialog.tagSuggestions.innerHTML = '';
    Array.from(ui.availableTags).sort().forEach(tag => {
      const option = document.createElement('option');
      option.value = tag;
      renameDialog.tagSuggestions.appendChild(option);
    });
  };

  const renderTagChips = (tags, container) => {
    container.innerHTML = '';
    tags.forEach(tag => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.innerHTML = `<span>${escapeHtml(tag)}</span><button class="delete-tag" data-tag="${escapeHtml(tag)}">&times;</button>`;
      container.appendChild(chip);
    });
  };

  export const openEditDialog = (tab, callback) => {
    const metadata = state.tabMetadata[tab.url] || {};
    const currentTitle = metadata.title || tab.title;
    const currentTags = metadata.tags || [];
    const currentNotes = metadata.notes || "";
    const currentTodos = metadata.todos || [];

    renameDialog.title.textContent = "Edit Tab";
    renameDialog.input.value = currentTitle;
    renameDialog.notesInput.value = currentNotes;
    let tags = [...currentTags];
    let todos = [...currentTodos];
    renderTagChips(tags, renameDialog.tagChipsContainer);
    renderTodoList(todos, renameDialog.todoListContainer);
    updateTagSuggestions();

    // Abort previous dialog's listeners if any
    if (editDialogAbortController) {
      editDialogAbortController.abort();
    }

    // Use AbortController for automatic cleanup
    editDialogAbortController = new AbortController();
    const signal = editDialogAbortController.signal;

    const handleTodoChange = (e) => {
      if (e.target.type === 'checkbox') {
        const index = parseInt(e.target.id.split('-')[1]);
        todos[index].completed = e.target.checked;
        renderTodoList(todos, renameDialog.todoListContainer);
      }
      if (e.target.classList.contains('delete-todo')) {
        const index = parseInt(e.target.dataset.index);
        todos.splice(index, 1);
        renderTodoList(todos, renameDialog.todoListContainer);
      }
    };

    const handleAddTodo = (e) => {
      if (e.key === 'Enter' && renameDialog.addTodoInput.value.trim() !== '') {
        e.preventDefault();
        todos.push({ text: renameDialog.addTodoInput.value.trim(), completed: false });
        renameDialog.addTodoInput.value = '';
        renderTodoList(todos, renameDialog.todoListContainer);
      }
    };

    renameDialog.todoListContainer.addEventListener('click', handleTodoChange, { signal });
    renameDialog.addTodoInput.addEventListener('keydown', handleAddTodo, { signal });

    const handleTagChipDelete = (e) => {
      if (e.target.classList.contains('delete-tag')) {
        const tagToDelete = e.target.dataset.tag;
        tags = tags.filter(t => t !== tagToDelete);
        renderTagChips(tags, renameDialog.tagChipsContainer);
      }
    };

    const handleTagInput = (e) => {
      if (e.key === 'Enter' && renameDialog.tagsInput.value.trim() !== '') {
        e.preventDefault();
        const newTags = renameDialog.tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
        newTags.forEach(newTag => {
          if (!tags.includes(newTag)) {
            tags.push(newTag);
          }
        });
        renderTagChips(tags, renameDialog.tagChipsContainer);
        renameDialog.tagsInput.value = '';
      }
    };

    renameDialog.tagChipsContainer.addEventListener('click', handleTagChipDelete, { signal });
    renameDialog.tagsInput.addEventListener('keydown', handleTagInput, { signal });

    showDialog(renameDialog);

    renameDialog.confirm.onclick = () => {
      const newTitle = renameDialog.input.value.trim();
      const newNotes = renameDialog.notesInput.value.trim();
      const remainingTagsFromInput = renameDialog.tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
      const finalTags = [...new Set([...tags, ...remainingTagsFromInput])];
      finalTags.forEach(tag => ui.availableTags.add(tag));
      if (newTitle) {
        callback(newTitle, finalTags, newNotes, todos);
        hideDialog(renameDialog);
        editDialogAbortController.abort(); // Clean up all event listeners
        editDialogAbortController = null;
      }
    };
  };

  const openEditNoteDialog = (note, callback) => {
    const currentContent = note.content || "";
    const currentTags = note.tags || [];

    editNoteDialog.contentInput.value = currentContent;
    let tags = [...currentTags];
    renderTagChips(tags, editNoteDialog.tagChipsContainer);

    // Update tag suggestions from available tags
    editNoteDialog.tagSuggestions.innerHTML = '';
    Array.from(ui.availableTags).sort().forEach(tag => {
      const option = document.createElement('option');
      option.value = tag;
      editNoteDialog.tagSuggestions.appendChild(option);
    });

    const handleTagChipDelete = (e) => {
      if (e.target.classList.contains('delete-tag')) {
        const tagToDelete = e.target.dataset.tag;
        tags = tags.filter(t => t !== tagToDelete);
        renderTagChips(tags, editNoteDialog.tagChipsContainer);
      }
    };

    const handleTagInput = (e) => {
      if (e.key === 'Enter' && editNoteDialog.tagsInput.value.trim() !== '') {
        e.preventDefault();
        const newTags = editNoteDialog.tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
        tags = [...new Set([...tags, ...newTags])];
        renderTagChips(tags, editNoteDialog.tagChipsContainer);
        editNoteDialog.tagsInput.value = '';
      }
    };

    editNoteDialog.tagChipsContainer.addEventListener('click', handleTagChipDelete);
    editNoteDialog.tagsInput.addEventListener('keydown', handleTagInput);

    showDialog(editNoteDialog);

    editNoteDialog.confirm.onclick = () => {
      const newContent = editNoteDialog.contentInput.value.trim();
      const remainingTagsFromInput = editNoteDialog.tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
      const finalTags = [...new Set([...tags, ...remainingTagsFromInput])];
      finalTags.forEach(tag => ui.availableTags.add(tag));
      if (newContent) {
        callback(newContent, finalTags);
        hideDialog(editNoteDialog);
        editNoteDialog.tagChipsContainer.removeEventListener('click', handleTagChipDelete);
        editNoteDialog.tagsInput.removeEventListener('keydown', handleTagInput);
      }
    };

    editNoteDialog.cancel.onclick = () => {
      hideDialog(editNoteDialog);
      editNoteDialog.tagChipsContainer.removeEventListener('click', handleTagChipDelete);
      editNoteDialog.tagsInput.removeEventListener('keydown', handleTagInput);
    };
  };

  const renderTodoList = (todos, container) => {
    container.innerHTML = '';
    todos.forEach((todo, index) => {
      const todoItem = document.createElement('div');
      todoItem.className = `todo-item ${todo.completed ? 'completed' : ''}`;
      todoItem.innerHTML = `
        <input type="checkbox" id="todo-${index}" ${todo.completed ? 'checked' : ''}>
        <label for="todo-${index}">${escapeHtml(todo.text)}</label>
        <button class="delete-todo" data-index="${index}">&times;</button>
      `;
      container.appendChild(todoItem);
    });
  };

  const openDeleteDialog = (title, description, callback) => {
    deleteDialog.title.textContent = title;
    deleteDialog.description.textContent = description;
    showDialog(deleteDialog);
    deleteDialog.confirm.onclick = () => {
      callback();
      hideDialog(deleteDialog);
    };
    deleteDialog.cancel.onclick = () => hideDialog(deleteDialog);
  };

  const shouldShowItem = (item) => {
    if (item.url && item.index !== undefined) {
      // It's an active tab
      const metadata = state.tabMetadata[item.url] || {};
      const tagPass = ui.activeTagFilters.has('all') || (metadata.tags && metadata.tags.some(tag => ui.activeTagFilters.has(tag)));

      // Search in title, URL, notes, and to-dos
      const searchLower = ui.searchTerm.toLowerCase();
      const searchPass = !ui.searchTerm ||
        (item.title && item.title.toLowerCase().includes(searchLower)) ||
        (item.url && item.url.toLowerCase().includes(searchLower)) ||
        (metadata.notes && metadata.notes.toLowerCase().includes(searchLower)) ||
        (metadata.todos && metadata.todos.some(todo => todo.text && todo.text.toLowerCase().includes(searchLower)));

      return tagPass && searchPass;
    } else if (item.url && item.bookmarkId) {
      // It's a sleeping tab
      const metadata = item.metadata || {};
      const tagPass = ui.activeTagFilters.has('all') || (metadata.tags && metadata.tags.some(tag => ui.activeTagFilters.has(tag)));

      // Search in title, URL, notes, and to-dos
      const searchLower = ui.searchTerm.toLowerCase();
      const searchPass = !ui.searchTerm ||
        (item.title && item.title.toLowerCase().includes(searchLower)) ||
        (item.url && item.url.toLowerCase().includes(searchLower)) ||
        (metadata.notes && metadata.notes.toLowerCase().includes(searchLower)) ||
        (metadata.todos && metadata.todos.some(todo => todo.text && todo.text.toLowerCase().includes(searchLower)));

      return tagPass && searchPass;
    }
    return false;
  };

  const collectTags = () => {
    ui.availableTags.clear();
    // Collect tags from active tabs
    Object.values(state.tabMetadata).forEach(meta => meta.tags?.forEach(tag => ui.availableTags.add(tag)));
    updateTagFilters();
  };

  const updateFilterButtonsState = () => {
    document.querySelectorAll('.tag-filter').forEach(btn => {
      btn.classList.toggle('active', ui.activeTagFilters.has(btn.dataset.tag));
    });
  };

  const updateTagFilters = () => {
    const tagFiltersContainer = document.getElementById('tag-filters');
    if (!tagFiltersContainer) return;
    const validActiveFilters = new Set(['all']);
    ui.activeTagFilters.forEach(tag => {
      if (tag === 'all' || ui.availableTags.has(tag)) validActiveFilters.add(tag);
    });
    ui.activeTagFilters = validActiveFilters;
    tagFiltersContainer.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.className = 'filter-btn tag-filter';
    allBtn.dataset.tag = 'all';
    allBtn.textContent = 'All';
    tagFiltersContainer.appendChild(allBtn);
    Array.from(ui.availableTags).sort().forEach(tag => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn tag-filter';
      btn.dataset.tag = tag;
      btn.textContent = tag;
      tagFiltersContainer.appendChild(btn);
    });
    updateFilterButtonsState();
  };

  // Helper function to render collapsed sidebar favicons
  const renderCollapsedSidebarFavicons = (unfiledTabs) => {
    collapsedFavicons.replaceChildren();
    const faviconFragment = document.createDocumentFragment();

    unfiledTabs.forEach((tab, index) => {
      const faviconContainer = document.createElement("div");
      faviconContainer.className = "collapsed-favicon";
      faviconContainer.style.animationDelay = `${index * 0.03}s`;
      faviconContainer.title = tab.title;

      const favicon = document.createElement("img");
      favicon.src = (tab.favIconUrl && /^(https?:|data:)/i.test(tab.favIconUrl))
        ? tab.favIconUrl
        : getFaviconUrl(tab.url);
      favicon.alt = "";
      faviconContainer.appendChild(favicon);

      faviconContainer.addEventListener("click", () => {
        chrome.tabs.update(tab.id, { active: true });
      });

      faviconFragment.appendChild(faviconContainer);
    });

    collapsedFavicons.appendChild(faviconFragment);
  };

  // Debounced render wrapper
  const debouncedRender = () => {
    // Clear existing timeout
    if (renderTimeout) {
      clearTimeout(renderTimeout);
    }

    // Mark that a render is pending
    pendingRender = true;

    // Set new timeout
    renderTimeout = setTimeout(() => {
      pendingRender = false;
      render();
    }, RENDER_DEBOUNCE_MS);
  };

  const render = async () => {
    if (isRendering) {
      log('🔄 Render already in progress, queueing...');
      // Queue another render if one is already in progress
      if (!pendingRender) {
        debouncedRender();
      }
      return;
    }
    if (ui.isWakingTab) {
      log('⏸️  RENDER BLOCKED: ui.isWakingTab = true');
      trace('  Call stack:');
      return; // Skip rendering during wake operations
    }
    log('🎨 RENDER START');
    trace('  Called from:');
    isRendering = true;

    try {
      await withChromeApiProtection(async () => {
        await enforceTabOrder();
      });

      // Save scroll positions before clearing
      const horizontalScrollPosition = cardsContainer.scrollLeft;
      const sidebarScrollPosition = sidebarScrollWrapper ? sidebarScrollWrapper.scrollTop : 0;

      // Save vertical scroll position for each card
      const cardScrollPositions = {};
      const existingCards = cardsContainer.querySelectorAll('.card');
      existingCards.forEach(card => {
        const cardId = card.dataset.cardId;
        const cardList = card.querySelector('ul');
        if (cardId && cardList) {
          cardScrollPositions[cardId] = cardList.scrollTop;
        }
      });

      cardsContainer.replaceChildren();
      unfiledTabsContainer.replaceChildren();
      updateFilterButtonsState();

      // Fetch all data in parallel
      const [allTabs, allGroups] = await Promise.all([
        chrome.tabs.query({}),
        chrome.tabGroups.query({})
      ]);

      // Find dashboard tab from the already-fetched tabs
      const dashboardUrl = chrome.runtime.getURL("fullpage.html");
      const dashboardTabId = allTabs.find(tab => tab.url === dashboardUrl)?.id;

      const tabsByGroup = allGroups.reduce((acc, group) => {
        acc[group.id] = [];
        return acc;
      }, { 'unfiled': [] });

      allTabs.forEach(tab => {
        if (tab.id === dashboardTabId) return; // Exclude the dashboard itself
        const groupId = tab.groupId > -1 ? tab.groupId : 'unfiled';
        if (tabsByGroup[groupId]) {
          tabsByGroup[groupId].push(tab);
        } else {
          tabsByGroup['unfiled'].push(tab);
        }
      });

      // Render unfiled tabs into the sidebar
      const unfiledCard = createCardElement({ id: 'unfiled', title: 'Unfiled Tabs' }, tabsByGroup.unfiled, true);
      unfiledTabsContainer.appendChild(unfiledCard);

      // Populate collapsed sidebar with favicons
      const unfiledTabs = tabsByGroup.unfiled || [];
      renderCollapsedSidebarFavicons(unfiledTabs);

      // Render grouped tabs into the main grid, ensuring they are in the correct order
      const groupOrderMap = allGroups.reduce((acc, group) => {
        const tabsInGroup = allTabs.filter(t => t.groupId === group.id);

        // Include groups with active tabs
        if (tabsInGroup.length > 0) {
          acc[group.id] = Math.min(...tabsInGroup.map(t => t.index));
        }
        return acc;
      }, {});

      // Filter out groups that have no content (no active tabs)
      const groupsWithContent = allGroups.filter(group => {
        const hasActiveTabs = tabsByGroup[group.id] && tabsByGroup[group.id].length > 0;
        return hasActiveTabs;
      });

      const sortedGroups = groupsWithContent.sort((a, b) => groupOrderMap[a.id] - groupOrderMap[b.id]);

      sortedGroups.forEach((group, index) => {
        const tabs = tabsByGroup[group.id] || [];
        const items = tabs;

        // Check if any items match search/tag filters
        const hasVisibleItems = items.some(item => shouldShowItem(item));

        // Skip cards with no visible items when filtering
        if ((ui.searchTerm || !ui.activeTagFilters.has('all')) && !hasVisibleItems) {
          return; // Don't render this card
        }

        // Auto-expand collapsed cards that have matches while filtering — but do NOT
        // mutate persisted state (previously this permanently cleared the user's
        // collapsed flag, losing their layout once the search was cleared).
        const filtering = ui.searchTerm || !ui.activeTagFilters.has('all');
        const forceExpand = filtering && hasVisibleItems && state.collapsedCards[group.id];
        if (forceExpand) state.collapsedCards[group.id] = false; // temporary

        const cardElement = createCardElement(group, tabs);

        if (forceExpand) state.collapsedCards[group.id] = true; // restore; never saved
        
        const moveLeftButton = cardElement.querySelector('.move-left');
        const moveRightButton = cardElement.querySelector('.move-right');
  
        // Hide arrows at the boundaries
        if (moveLeftButton && index === 0) {
          moveLeftButton.style.display = 'none';
        }
        if (moveRightButton && index === sortedGroups.length - 1) {
          moveRightButton.style.display = 'none';
        }
  
        // Attach listeners using the correct window tab indices from groupOrderMap
        if (moveLeftButton) {
          moveLeftButton.addEventListener('click', async () => {
            const previousGroup = sortedGroups[index - 1];
            if (previousGroup) {
              // Move the current group to the window index of the previous group's first tab.
              const targetIndex = groupOrderMap[previousGroup.id];
              await chrome.tabGroups.move(group.id, { index: targetIndex });
              render();
            }
          });
        }
  
        if (moveRightButton) {
          moveRightButton.addEventListener('click', async () => {
            const nextGroup = sortedGroups[index + 1];
            if (nextGroup) {
              // To swap, move the next group to the window index of the current group's first tab.
              const targetIndex = groupOrderMap[group.id];
              await chrome.tabGroups.move(nextGroup.id, { index: targetIndex });
              render();
            }
          });
        }
        
        cardsContainer.appendChild(cardElement);
      });
      const createCardLink = document.createElement("div");
      createCardLink.className = "create-card-link";
      createCardLink.innerHTML = `+ New Group`;
      createCardLink.addEventListener("click", openCreateCardDialog);
      cardsContainer.appendChild(createCardLink);

      // Restore scroll positions after rendering
      cardsContainer.scrollLeft = horizontalScrollPosition;
      if (sidebarScrollWrapper) {
        sidebarScrollWrapper.scrollTop = sidebarScrollPosition;
      }

      // Restore vertical scroll position for each card
      const renderedCards = cardsContainer.querySelectorAll('.card');
      renderedCards.forEach(card => {
        const cardId = card.dataset.cardId;
        const cardList = card.querySelector('ul');
        if (cardId && cardList && cardScrollPositions[cardId] !== undefined) {
          cardList.scrollTop = cardScrollPositions[cardId];
        }
      });

      // Render Bookmarks Card — only when bookmarks changed or the search term
      // changed (search filters bookmarks too). Skipped on unrelated tab/group
      // events, leaving the existing bookmark DOM untouched.
      await renderBookmarksIfDirty();

      // Render Task Roll-Up (aggregate tasks once, reusing the tabs already fetched)
      const aggregatedTasks = await aggregateAllTasks(allTabs);
      await renderTaskRollup(aggregatedTasks);
      await renderCollapsedTaskRollup(aggregatedTasks);

    } finally {
      isRendering = false; // Release the lock
    }
  };

  // Create a sleeping tab element
  const createTabElement = (tab, group) => {
    const listItem = document.createElement("li");
    listItem.className = "tab-item";
    listItem.draggable = true;
    listItem.dataset.tabId = tab.id;

    const metadata = state.tabMetadata[tab.url] || {};
    // Normalize "New Tab 2", "New Tab 3", etc. to just "New Tab"
    let tabTitle = tab.title;
    if (tabTitle && tabTitle.match(/^New Tab( \d+)?$/)) {
      tabTitle = "New Tab";
    }
    const title = metadata.title || tabTitle;
    const tags = metadata.tags || [];
    const notes = metadata.notes || "";
    const todos = metadata.todos || [];

    const incompleteTasks = todos.filter(t => !t.completed).length;
    const allTasksComplete = todos.length > 0 && incompleteTasks === 0;
    const taskBadgeClass = allTasksComplete ? 'task-badge-complete' : (incompleteTasks > 0 ? 'task-badge-incomplete' : '');
    const taskBadgeHTML = todos.length > 0 ? `<span class="task-badge ${taskBadgeClass}" title="${incompleteTasks} incomplete task${incompleteTasks !== 1 ? 's' : ''}"><i class="fas fa-tasks"></i> ${incompleteTasks}</span>` : '';

    const linkActions = `<div class="link-actions">${taskBadgeHTML}<button class="action-button open-tab" title="Open Tab"><i class="fas fa-external-link-alt"></i></button></div>`;
    const tagsHTML = tags.length > 0 ? `<div class="tags-container">${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : '';
    const notesHTML = notes ? `<div class="notes-container"><p>${escapeHtml(notes)}</p></div>` : '';
    const todosSummaryHTML = todos.length > 0 ? `
      <div class="todos-summary">
        <i class="fas fa-check-square"></i>
        <span>${todos.filter(t => t.completed).length}/${todos.length}</span>
      </div>
    ` : '';
    // Always show a favicon: prefer the tab's own favicon when it's a safe
    // http(s)/data URL, otherwise derive one from the tab's hostname. Chrome
    // frequently leaves favIconUrl empty (unloaded/discarded tabs), so gating on
    // it alone left many tabs with a blank placeholder.
    const faviconSrc = (tab.favIconUrl && /^(https?:|data:)/i.test(tab.favIconUrl))
      ? tab.favIconUrl
      : getFaviconUrl(tab.url);
    const faviconHTML = `<img src="${escapeHtml(faviconSrc)}" class="favicon" alt="">`;

    listItem.innerHTML = `<div class="link-content">${faviconHTML}<div class="link-details"><span class="title">${escapeHtml(title)}</span>${tagsHTML}${notesHTML}${todosSummaryHTML}</div></div>${linkActions}`;

    listItem.addEventListener("dragstart", e => {
      isDragging = true;
      document.body.classList.add('dnd-active'); // suppress layout transitions while dragging
      cachedContainerRect = cardsContainer.getBoundingClientRect(); // Cache rect on drag start
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData("text/plain", JSON.stringify({ tabId: tab.id, sourceGroupId: group.id }));
      e.dataTransfer.setData("item-type", "tab");
      listItem.classList.add('dragging');
    });

    listItem.addEventListener("dragend", () => {
      isDragging = false;
      document.body.classList.remove('dnd-active');
      cachedContainerRect = null; // Clear cache on drag end
      listItem.classList.remove('dragging');
      document.querySelectorAll('.placeholder').forEach(p => p.remove());
      cardsContainer.classList.remove('active-drag');
    });

    // dragover fires ~continuously; throttle the layout read + placeholder
    // insertion to once per animation frame to avoid reflow-on-every-event jank.
    let dragoverScheduled = false;
    let dragoverClientY = 0;
    listItem.addEventListener("dragover", e => {
      e.preventDefault();      // must stay synchronous to allow the drop
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      dragoverClientY = e.clientY;
      if (dragoverScheduled) return;
      dragoverScheduled = true;
      requestAnimationFrame(() => {
        dragoverScheduled = false;
        const draggingItem = document.querySelector('.dragging');
        if (!draggingItem || draggingItem === listItem) return;
        const rect = listItem.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const isAbove = dragoverClientY < midpoint;
        const existingPlaceholder = listItem.parentElement.querySelector('.placeholder');

        // Only touch the DOM if the placeholder isn't already where it belongs.
        const needsUpdate = !existingPlaceholder ||
                           (isAbove && existingPlaceholder.nextSibling !== listItem) ||
                           (!isAbove && existingPlaceholder !== listItem.nextSibling);
        if (!needsUpdate) return;

        if (existingPlaceholder) existingPlaceholder.remove();
        const placeholder = document.createElement('div');
        placeholder.className = 'placeholder';
        placeholder.addEventListener('dragover', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          ev.dataTransfer.dropEffect = 'move';
        });
        listItem.parentElement.insertBefore(placeholder, isAbove ? listItem : listItem.nextSibling);
      });
    });

    listItem.querySelector(".title").addEventListener("click", () => {
      openEditDialog(tab, (newTitle, newTags, newNotes, newTodos) => {
        state.tabMetadata[tab.url] = { title: newTitle, tags: newTags, notes: newNotes, todos: newTodos };
        saveData();
      });
    });

    listItem.querySelector(".open-tab").addEventListener("click", async () => {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    });

    return listItem;
  }

  // Helper function to generate card actions HTML
  const generateCardActionsHTML = (groupId, isCollapsed, isSidebar) => {
    if (isSidebar) return '';

    return `
      <div class="card-actions">
        <button class="action-button toggle-collapse" title="${isCollapsed ? 'Expand' : 'Collapse'}" data-group-id="${groupId}">
          <i class="fas fa-${isCollapsed ? 'expand-arrows-alt' : 'compress-arrows-alt'}"></i>
        </button>
        <button class="action-button move-left" title="Move Left"><i class="fas fa-arrow-left"></i></button>
        <button class="action-button move-right" title="Move Right"><i class="fas fa-arrow-right"></i></button>
        <button class="action-button delete-card" title="Delete Group"><i class="fas fa-trash"></i></button>
      </div>
    `;
  };

  const createCardElement = (group, tabs, isSidebar = false) => {
    const cardElement = document.createElement("div");
    const isCollapsed = state.collapsedCards[group.id] || false;
    cardElement.className = isSidebar ? "card" : (isCollapsed ? "card card-collapsed" : "card");
    cardElement.dataset.cardId = group.id;

    // Expose the Chrome tab-group colour as a CSS variable so each column can
    // show a matching top-accent bar (purely visual; falls back to --primary).
    const groupColorHex = CHROME_GROUP_COLORS[group.color];
    if (groupColorHex) cardElement.style.setProperty('--group-color', groupColorHex);

    // Calculate tab counts once for use in both header and badge
    const totalItems = tabs.length;

    const cardActions = generateCardActionsHTML(group.id, isCollapsed, isSidebar);
    const collapsedBadge = isCollapsed ? `<div class="card-collapsed-badge">${totalItems} item${totalItems !== 1 ? 's' : ''}</div>` : '';

    if (isSidebar) {
      const isSidebarCardCollapsed = state.collapsedCards[`sidebar-${group.id}`] || false;
      cardElement.className = `card ${isSidebarCardCollapsed ? 'collapsed' : ''}`;
      cardElement.innerHTML = `
        <div class="card-header sidebar-card-header" data-sidebar-card-id="${group.id}">
          <i class="fas fa-chevron-${isSidebarCardCollapsed ? 'right' : 'down'} sidebar-card-toggle"></i>
          <span data-card-id="${group.id}">${escapeHtml(group.title)}</span>
          <span class="card-stats">${totalItems}</span>
        </div>
      `;
    } else {
      cardElement.innerHTML = `
        <div class="card-header">
          <span class="editable" contenteditable="true" data-card-id="${group.id}">${escapeHtml(group.title)}</span>
          <span class="card-stats card-count">${totalItems}</span>
          ${cardActions}
        </div>
        ${collapsedBadge}
      `;
    }

    const linksList = document.createElement("ul");

    tabs.forEach(tab => {
      if (shouldShowItem(tab)) {
        const listItem = createTabElement(tab, group);
        if (listItem) {
          linksList.appendChild(listItem);
        }
      }
    });
    
    cardElement.appendChild(linksList);

    // Add "Open new tab" button below the list (only for group cards, not sidebar)
    if (!isSidebar) {
      const openTabButton = document.createElement("button");
      openTabButton.className = "open-tab-btn";
      openTabButton.innerHTML = '<i class="fas fa-plus"></i> Open new tab';
      openTabButton.dataset.groupId = group.id;
      cardElement.appendChild(openTabButton);
    }

    if (linksList.children.length === 0 && !isSidebar) {
        const emptyMessage = document.createElement("div");
        emptyMessage.className = "empty-card-message";
        emptyMessage.textContent = "Drag tabs here to group them.";
        cardElement.appendChild(emptyMessage);
    }
     if (linksList.children.length === 0 && isSidebar) {
        const emptyMessage = document.createElement("div");
        emptyMessage.className = "empty-sidebar-message";
        emptyMessage.textContent = "Tabs not in a group will show here.";
        cardElement.appendChild(emptyMessage);
    }


    // Vertical auto-scroll state for this card
    let verticalScrollAnimationFrame = null;
    let verticalScrollSpeed = 0;
    const VERTICAL_EDGE_ZONE = 80; // pixels from top/bottom to trigger scroll
    const VERTICAL_MIN_SPEED = 3;
    const VERTICAL_MAX_SPEED = 10;

    const calculateVerticalScrollSpeed = (distanceFromEdge) => {
      const normalizedDistance = Math.max(0, VERTICAL_EDGE_ZONE - distanceFromEdge) / VERTICAL_EDGE_ZONE;
      return VERTICAL_MIN_SPEED + (normalizedDistance * (VERTICAL_MAX_SPEED - VERTICAL_MIN_SPEED));
    };

    const getVerticalScrollDirection = (mouseY, listElement) => {
      const listRect = listElement.getBoundingClientRect();
      const topEdge = listRect.top;
      const bottomEdge = listRect.bottom;

      // Check top edge
      if (mouseY < topEdge + VERTICAL_EDGE_ZONE && mouseY > topEdge) {
        const distance = mouseY - topEdge;
        return { direction: 'up', distance };
      }

      // Check bottom edge
      if (mouseY > bottomEdge - VERTICAL_EDGE_ZONE && mouseY < bottomEdge) {
        const distance = bottomEdge - mouseY;
        return { direction: 'down', distance };
      }

      return null;
    };

    const verticalAutoScroll = () => {
      if (verticalScrollSpeed === 0) {
        verticalScrollAnimationFrame = null;
        return;
      }

      const canScrollUp = linksList.scrollTop > 0;
      const canScrollDown = linksList.scrollTop < (linksList.scrollHeight - linksList.clientHeight);

      if ((verticalScrollSpeed < 0 && canScrollUp) || (verticalScrollSpeed > 0 && canScrollDown)) {
        linksList.scrollTop += verticalScrollSpeed;
        verticalScrollAnimationFrame = requestAnimationFrame(verticalAutoScroll);
      } else {
        verticalScrollSpeed = 0;
        verticalScrollAnimationFrame = null;
      }
    };

    const startVerticalAutoScroll = (speed) => {
      verticalScrollSpeed = speed;
      if (!verticalScrollAnimationFrame) {
        verticalScrollAnimationFrame = requestAnimationFrame(verticalAutoScroll);
      }
    };

    const stopVerticalAutoScroll = () => {
      verticalScrollSpeed = 0;
      if (verticalScrollAnimationFrame) {
        cancelAnimationFrame(verticalScrollAnimationFrame);
        verticalScrollAnimationFrame = null;
      }
    };

    // Same rAF throttle as the per-item handler: this fires for the card
    // background / gaps / placeholder and previously ran a getBoundingClientRect
    // (vertical-scroll check) plus an array scan on every dragover event.
    let cardDragScheduled = false;
    let cardDragY = 0;
    let cardOverItem = false;
    cardElement.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cardDragY = e.clientY;
      const targetIsPlaceholder = e.target.classList && e.target.classList.contains('placeholder');
      cardOverItem = !!(e.target.closest && e.target.closest('li')) && !targetIsPlaceholder;
      if (cardDragScheduled) return;
      cardDragScheduled = true;
      requestAnimationFrame(() => {
        cardDragScheduled = false;

        // Handle vertical auto-scroll for long lists
        if (isDragging && linksList.scrollHeight > linksList.clientHeight) {
          const scrollInfo = getVerticalScrollDirection(cardDragY, linksList);
          if (scrollInfo) {
            const speed = calculateVerticalScrollSpeed(scrollInfo.distance);
            startVerticalAutoScroll(scrollInfo.direction === 'up' ? -speed : speed);
          } else {
            stopVerticalAutoScroll();
          }
        }

        // If not hovering over a list item, ensure the placeholder is at the end
        if (!cardOverItem) {
          const existingPlaceholder = linksList.querySelector('.placeholder');
          const listItems = Array.from(linksList.children).filter(child => child.tagName === 'LI');
          const lastListItem = listItems[listItems.length - 1];
          const placeholderShouldBeAfterLast = !existingPlaceholder || (lastListItem && existingPlaceholder.previousElementSibling !== lastListItem);
          if (placeholderShouldBeAfterLast) {
            if (existingPlaceholder) existingPlaceholder.remove();
            const placeholder = document.createElement('div');
            placeholder.className = 'placeholder';
            placeholder.addEventListener('dragover', (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              ev.dataTransfer.dropEffect = 'move';
            });
            linksList.appendChild(placeholder);
          }
        }
      });
    });

    cardElement.addEventListener("dragleave", e => {
      const rect = cardElement.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        cardElement.querySelector('.placeholder')?.remove();
        stopVerticalAutoScroll();
      }
    });

    cardElement.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      stopVerticalAutoScroll();

      // Clean up drag state immediately (before any async operations)
      const draggingElement = document.querySelector('.dragging');
      if (draggingElement) {
        draggingElement.classList.remove('dragging');
      }
      cardsContainer.classList.remove('active-drag');

      try {
        // Check if it's a bookmark being dragged
        const itemType = e.dataTransfer.getData("item-type");
        if (itemType === 'bookmark') {
          const dragData = e.dataTransfer.getData('text/plain');
          if (dragData) {
            const { bookmarkId, bookmarkUrl } = JSON.parse(dragData);
            if (bookmarkUrl && bookmarkId) {
              // Open bookmark as a tab in this group (bookmark remains intact)
              const newTab = await chrome.tabs.create({ url: bookmarkUrl, active: false });

              // Group the tab if not unfiled
              if (group.id !== 'unfiled') {
                await chrome.tabs.group({ groupId: parseInt(group.id), tabIds: [newTab.id] });
              }

              // NOTE: Bookmark is NOT deleted - it remains in the bookmarks folder
              // This allows users to open bookmarks as tabs while keeping the bookmark for future use

              // Remove placeholders before re-rendering
              document.querySelectorAll('.placeholder').forEach(p => p.remove());

              render();
              return;
            }
          }
        }

        // For regular tab drops, we need the placeholder
        const placeholder = cardElement.querySelector('.placeholder');
        if (!placeholder) {
          return;
        }

        const dropIndex = Array.from(placeholder.parentElement.children).filter(child => child.tagName === 'LI' && !child.classList.contains('dragging')).indexOf(placeholder.previousElementSibling) + 1;

        // Optimistically move the dragged element into the drop slot NOW so the UI
        // reflects the drop immediately. Without this, the element snaps back to its
        // pre-drag position and only jumps to the dropped position ~1s later when the
        // background tab-move round-trip triggers a full re-render. The later render
        // rebuilds to this same layout, so it's visually a no-op.
        if (draggingElement && draggingElement.tagName === 'LI' && placeholder.parentElement) {
          placeholder.parentElement.insertBefore(draggingElement, placeholder);
        }

        const dragData = e.dataTransfer.getData("text/plain");
        if (!dragData) return;
        const { tabId, sourceGroupId } = JSON.parse(dragData);
        const destGroupId = group.id;

        if (tabId) {
          const tabIdInt = parseInt(tabId);

          // If the tab is moved to a new group, handle the grouping change first.
          if (sourceGroupId != destGroupId) {
              if (destGroupId === 'unfiled') {
                  await chrome.tabs.ungroup(tabIdInt);
              } else {
                  await chrome.tabs.group({ groupId: parseInt(destGroupId), tabIds: [tabIdInt] });
              }
          }

          // Now, calculate the correct window index to move the tab to.
          const queryInfo = destGroupId === 'unfiled'
            ? { groupId: -1 }
            : { groupId: parseInt(destGroupId) };
          const tabsInDestGroup = await chrome.tabs.query(queryInfo);
          const sortedTabs = tabsInDestGroup.sort((a, b) => a.index - b.index);

          let targetWindowIndex = -1;

          if (dropIndex < sortedTabs.length) {
              const referenceTab = sortedTabs[dropIndex];
              if (referenceTab.id !== tabIdInt) {
                targetWindowIndex = referenceTab.index;
              } else if (dropIndex + 1 < sortedTabs.length) {
                targetWindowIndex = sortedTabs[dropIndex + 1].index;
              }
          } else {
            // Dropping at the end
            const lastTab = sortedTabs[sortedTabs.length - 1];
            if (lastTab && lastTab.id !== tabIdInt) {
              const draggedTab = sortedTabs.find(t => t.id === tabIdInt);
              if (draggedTab && draggedTab.index < lastTab.index) {
                targetWindowIndex = lastTab.index;
              } else {
                targetWindowIndex = lastTab.index + 1;
              }
            } else if (lastTab && lastTab.id === tabIdInt) {
              targetWindowIndex = -2;
            } else {
              targetWindowIndex = -2;
            }
          }

          // Perform the move operation
          if (targetWindowIndex !== -1 && targetWindowIndex !== -2) {
            await chrome.tabs.move(tabIdInt, { index: targetWindowIndex });
          }
        }

        // Remove placeholders
        document.querySelectorAll('.placeholder').forEach(p => p.remove());

        // Don't re-render - let Chrome's native tab reordering handle the UI update
        // Just save the state to storage
        saveData(false);

      } catch (error) {
        console.error('Card drop failed:', error);
        // Clean up on error too
        document.querySelectorAll('.placeholder').forEach(p => p.remove());
        render(); // Re-render to correct any visual glitches
      }
    });

    if (!isSidebar) {
      const cardNameElement = cardElement.querySelector(".card-header .editable");
      cardNameElement.addEventListener("blur", async () => {
        const newName = cardNameElement.textContent.trim();
        if (newName && newName !== group.title) {
          await chrome.tabGroups.update(group.id, { title: newName });
          render();
        } else {
          cardNameElement.textContent = group.title;
        }
      });

      cardNameElement.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          e.preventDefault();
          cardNameElement.blur();
        }
      });

      cardElement.querySelector(".delete-card").addEventListener("click", () => openDeleteDialog("Delete Group", `This will ungroup all tabs in "${group.title}". The tabs themselves will not be closed.`, async () => {
        const tabsInGroup = await chrome.tabs.query({ groupId: group.id });
        await chrome.tabs.ungroup(tabsInGroup.map(t => t.id));
        render();
      }));

      // Toggle collapse listener (only for non-sidebar cards)
      const toggleCollapseBtn = cardElement.querySelector(".toggle-collapse");
      if (toggleCollapseBtn) {
        toggleCollapseBtn.addEventListener("click", () => {
          const groupId = toggleCollapseBtn.dataset.groupId;
          const isCurrentlyCollapsed = cardElement.classList.contains('card-collapsed');

          // Toggle the CSS class immediately for smooth animation
          if (isCurrentlyCollapsed) {
            cardElement.classList.remove('card-collapsed');
            delete state.collapsedCards[groupId];
          } else {
            cardElement.classList.add('card-collapsed');
            state.collapsedCards[groupId] = true;
          }

          // Update the icon
          toggleCollapseBtn.innerHTML = isCurrentlyCollapsed ? '<i class="fas fa-compress-alt"></i>' : '<i class="fas fa-expand-alt"></i>';
          toggleCollapseBtn.title = isCurrentlyCollapsed ? 'Collapse' : 'Expand';

          // Update the badge
          const sleepingTabsForGroup = state.sleepingTabs.filter(st => st.groupId === groupId);
          const totalItems = tabs.length + sleepingTabsForGroup.length;
          const sleepingCount = sleepingTabsForGroup.length;

          let existingBadge = cardElement.querySelector('.card-collapsed-badge');
          if (!isCurrentlyCollapsed) {
            // Now collapsed - add badge if it doesn't exist
            if (!existingBadge) {
              const badge = document.createElement('div');
              badge.className = 'card-collapsed-badge';
              badge.textContent = `${totalItems} item${totalItems !== 1 ? 's' : ''}${sleepingCount > 0 ? `, ${sleepingCount} sleeping` : ''}`;
              cardElement.insertBefore(badge, cardElement.querySelector('ul'));
            }
          } else {
            // Now expanded - remove badge
            if (existingBadge) {
              existingBadge.remove();
            }
          }

          // Save to storage without re-rendering
          saveData(false);
        });
      }
    } else {
      // Add collapse/expand functionality for sidebar cards
      const sidebarHeader = cardElement.querySelector('.sidebar-card-header');
      if (sidebarHeader) {
        const sidebarToggle = sidebarHeader.querySelector('.sidebar-card-toggle');
        sidebarHeader.addEventListener('click', (e) => {
          // Don't toggle if clicking on the stats
          if (e.target.closest('.card-stats')) return;

          const cardId = sidebarHeader.dataset.sidebarCardId;
          const isCollapsed = cardElement.classList.contains('collapsed');

          if (isCollapsed) {
            cardElement.classList.remove('collapsed');
            delete state.collapsedCards[`sidebar-${cardId}`];
            sidebarToggle.className = 'fas fa-chevron-down sidebar-card-toggle';
          } else {
            cardElement.classList.add('collapsed');
            state.collapsedCards[`sidebar-${cardId}`] = true;
            sidebarToggle.className = 'fas fa-chevron-right sidebar-card-toggle';
          }

          saveData(false);
        });
      }
    }

    return cardElement;
  }

  const openCreateCardDialog = () => {
    createCardDialog.input.value = "";
    showDialog(createCardDialog);
    createCardDialog.input.focus();
  };

  const createCard = async () => {
    const cardName = createCardDialog.input.value.trim();
    if (cardName) {
      try {
        await withChromeApiProtection(async () => {
          // Create a new tab in the background without switching to it, forcing it to the end.
          // Opens browser's default new tab page (chrome://newtab)
          const newTab = await chrome.tabs.create({
            active: false,
            index: 9999
          });
          // Create a new group with this tab.
          const newGroupId = await chrome.tabs.group({ tabIds: [newTab.id] });
          // Set the desired title for the new group.
          await chrome.tabGroups.update(newGroupId, { title: cardName });
        });

        hideDialog(createCardDialog);
        render();
      } catch (error) {
        console.error("Error creating new group:", error);
        hideDialog(createCardDialog);
      }
    }
  };

  createCardDialog.confirm.addEventListener("click", createCard);
  createCardDialog.input.addEventListener("keypress", e => {
    if (e.key === "Enter") createCard();
  });

  // Create bookmark folder dialog

  warningDialog.ok.addEventListener("click", () => hideDialog(warningDialog));

  // Settings dialog handlers
  const settingsBtn = document.getElementById("settings-btn");
  settingsBtn.addEventListener("click", () => {
    // Load current settings into UI
    settingsDialog.autoCollapseCheckbox.checked = state.settings.autoCollapseGroups || false;
    showDialog(settingsDialog);
  });

  // Save settings when checkbox changes
  settingsDialog.autoCollapseCheckbox.addEventListener("change", (e) => {
    state.settings.autoCollapseGroups = e.target.checked;
    // The background service worker reads `settings` from storage on
    // tabGroups.onUpdated, so persisting is sufficient — no message needed
    // (the old runtime.sendMessage had no handler and was silently dropped).
    saveData(false);
  });

  // Open sidebar button handler
  const openSidebarBtn = document.getElementById("open-sidebar-btn");
  openSidebarBtn.addEventListener("click", async () => {
    try {
      // Check if Side Panel API is available
      if (!chrome.sidePanel || !chrome.sidePanel.open) {
        throw new Error('Side Panel API not available');
      }

      // Get current window ID
      const currentWindow = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: currentWindow.id });
    } catch (error) {
      console.error('[Tab Ban] Error opening side panel:', error);

      // Show user-friendly message with more details
      const message = 'Unable to open sidebar.\n\n' +
        'The Side Panel API requires Chrome 114 or higher.\n\n' +
        'Instructions:\n' +
        '1. Check chrome://version/ to verify your Chrome version\n' +
        '2. Update Chrome if needed (chrome://settings/help)\n' +
        '3. Alternatively, right-click the Tab Ban icon and select "Open side panel"';

      alert(message);
    }
  });

  // --- Sessions Dialog Handlers ---

  // Toggle all cards expand/collapse
  const toggleAllCardsBtn = document.getElementById("toggle-all-cards-btn");
  let allCardsCollapsed = false;

  toggleAllCardsBtn.addEventListener("click", async () => {
    const allGroups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    const allCards = document.querySelectorAll('.card[data-card-id]');

    if (allCardsCollapsed) {
      // Expand all cards
      allGroups.forEach(group => {
        delete state.collapsedCards[group.id];
      });

      // Animate cards with slight stagger
      allCards.forEach((card, index) => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            const groupId = card.dataset.cardId;
            if (groupId && groupId !== 'unfiled') {
              card.classList.remove('card-collapsed');

              // Update the toggle button icon for this card
              const toggleBtn = card.querySelector('.toggle-collapse');
              if (toggleBtn) {
                toggleBtn.innerHTML = '<i class="fas fa-compress-alt"></i>';
                toggleBtn.title = 'Collapse';
              }

              // Remove badge
              const badge = card.querySelector('.card-collapsed-badge');
              if (badge) {
                badge.remove();
              }
            }
          }, index * 20); // 20ms stagger between cards
        });
      });

      allCardsCollapsed = false;
      toggleAllCardsBtn.title = "Collapse All Cards";
      toggleAllCardsBtn.querySelector("i").className = "fas fa-compress-alt";
    } else {
      // Collapse all cards
      allGroups.forEach(group => {
        state.collapsedCards[group.id] = true;
      });

      // Animate cards with slight stagger
      allCards.forEach((card, index) => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            const groupId = card.dataset.cardId;
            if (groupId && groupId !== 'unfiled') {
              card.classList.add('card-collapsed');

              // Update the toggle button icon for this card
              const toggleBtn = card.querySelector('.toggle-collapse');
              if (toggleBtn) {
                toggleBtn.innerHTML = '<i class="fas fa-expand-alt"></i>';
                toggleBtn.title = 'Expand';
              }

              // Add badge if it doesn't exist
              let badge = card.querySelector('.card-collapsed-badge');
              if (!badge) {
                const tabs = card.querySelectorAll('li').length;
                const sleepingTabsForGroup = state.sleepingTabs.filter(st => st.groupId === groupId);
                const totalItems = tabs + sleepingTabsForGroup.length;
                const sleepingCount = sleepingTabsForGroup.length;

                badge = document.createElement('div');
                badge.className = 'card-collapsed-badge';
                badge.textContent = `${totalItems} item${totalItems !== 1 ? 's' : ''}${sleepingCount > 0 ? `, ${sleepingCount} sleeping` : ''}`;
                card.insertBefore(badge, card.querySelector('ul'));
              }
            }
          }, index * 20); // 20ms stagger between cards
        });
      });

      allCardsCollapsed = true;
      toggleAllCardsBtn.title = "Expand All Cards";
      toggleAllCardsBtn.querySelector("i").className = "fas fa-expand-alt";
    }

    // Save to storage without re-rendering
    saveData(false);
  });

  // Tag Manager
  const renderTagManager = () => {
    const allTags = Array.from(ui.availableTags).sort();

    if (allTags.length === 0) {
      tagManagerDialog.list.innerHTML = `
        <div class="empty-tag-manager">
          <i class="fas fa-tags"></i>
          <p>No tags yet</p>
          <p style="font-size: 0.875rem;">Tags will appear here when you add them to tabs or notes.</p>
        </div>
      `;
      return;
    }

    // Count usage of each tag
    const tagCounts = {};
    allTags.forEach(tag => {
      tagCounts[tag] = 0;
      // Count in active tabs
      Object.values(state.tabMetadata).forEach(metadata => {
        if (metadata.tags && metadata.tags.includes(tag)) {
          tagCounts[tag]++;
        }
      });
      // Count in sleeping tabs
      state.sleepingTabs.forEach(st => {
        if (st.metadata && st.metadata.tags && st.metadata.tags.includes(tag)) {
          tagCounts[tag]++;
        }
      });
    });

    tagManagerDialog.list.innerHTML = allTags.map(tag => `
      <div class="tag-manager-item" data-tag="${escapeHtml(tag)}">
        <div class="tag-manager-item-left">
          <span class="tag-manager-item-name">${escapeHtml(tag)}</span>
          <span class="tag-manager-item-count">${tagCounts[tag]} item${tagCounts[tag] !== 1 ? 's' : ''}</span>
        </div>
        <div class="tag-manager-item-actions">
          <button class="action-button delete-tag-btn" title="Delete Tag">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
      </div>
    `).join('');

    // Add delete handlers
    tagManagerDialog.list.querySelectorAll('.delete-tag-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tagItem = e.target.closest('.tag-manager-item');
        const tagName = tagItem.dataset.tag;
        deleteTag(tagName);
      });
    });
  };

  const addTag = (tagName) => {
    const trimmedTag = tagName.trim();
    if (!trimmedTag) return;

    // Add to available tags
    ui.availableTags.add(trimmedTag);

    // Clear input and re-render
    tagManagerDialog.input.value = '';
    renderTagManager();
    updateTagSuggestions();
  };

  const deleteTag = (tagName) => {
    // Remove from active tabs
    Object.keys(state.tabMetadata).forEach(url => {
      const metadata = state.tabMetadata[url];
      if (metadata.tags) {
        metadata.tags = metadata.tags.filter(t => t !== tagName);
      }
    });

    // Remove from sleeping tabs
    state.sleepingTabs.forEach(st => {
      if (st.metadata && st.metadata.tags) {
        st.metadata.tags = st.metadata.tags.filter(t => t !== tagName);
      }
    });

    // Update available tags
    ui.availableTags.delete(tagName);

    saveData();
    renderTagManager();
    updateTagSuggestions();
  };

  const tagManagerBtn = document.getElementById("tag-manager-btn");
  tagManagerBtn.addEventListener("click", () => {
    renderTagManager();
    showDialog(tagManagerDialog);
  });

  tagManagerDialog.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(tagManagerDialog.input.value);
    }
  });

  const sessionsBtn = document.getElementById("sessions-btn");
  sessionsBtn.addEventListener("click", async () => {
    await renderSessions();
    showDialog(sessionsDialog);
  });

  document.getElementById("save-new-session-btn").addEventListener("click", () => {
    saveSessionDialog.nameInput.value = '';
    saveSessionDialog.descriptionInput.value = '';
    hideDialog(sessionsDialog);
    showDialog(saveSessionDialog);
  });

  // Import session button and file input
  document.getElementById("import-session-btn").addEventListener("click", () => {
    document.getElementById("import-session-file").click();
  });

  document.getElementById("import-session-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) {
      await importSession(file);
      // Clear the file input so the same file can be imported again
      e.target.value = '';
    }
  });

  saveSessionDialog.cancel.addEventListener("click", () => {
    hideDialog(saveSessionDialog);
    showDialog(sessionsDialog);
  });

  saveSessionDialog.confirm.addEventListener("click", async () => {
    const name = saveSessionDialog.nameInput.value.trim();
    if (!name) {
      alert('Please enter a session name');
      return;
    }

    const description = saveSessionDialog.descriptionInput.value.trim();
    await saveSession(name, description);

    hideDialog(saveSessionDialog);
    await renderSessions();
    showDialog(sessionsDialog);
  });

  loadSessionDialog.cancel.addEventListener("click", () => {
    hideDialog(loadSessionDialog);
    showDialog(sessionsDialog);
  });

  loadSessionDialog.confirm.addEventListener("click", async () => {
    const mode = document.querySelector('input[name="load-mode"]:checked').value;
    await loadSession(ui.currentSessionToLoad, mode);
    hideDialog(loadSessionDialog);
  });

  searchInput.addEventListener("input", e => {
    ui.searchTerm = e.target.value;
    // Debounce: every keystroke previously triggered a full async render
    // (tab/group queries, tab reordering, storage writes, full DOM rebuild).
    debouncedRender();
  });

  const setupFilterButtons = () => {
    document.querySelector('.filters-search-container').addEventListener('click', (e) => {
      if (e.target.classList.contains('tag-filter')) {
        const filterValue = e.target.dataset.tag;
        if (filterValue === 'all') {
          ui.activeTagFilters.clear();
          ui.activeTagFilters.add('all');
        } else {
          ui.activeTagFilters.delete('all');
          if (ui.activeTagFilters.has(filterValue)) ui.activeTagFilters.delete(filterValue);
          else ui.activeTagFilters.add(filterValue);
          if (ui.activeTagFilters.size === 0) ui.activeTagFilters.add('all');
        }
        render();
      }
    });
  };
  
  const setupTagFilterButtons = () => setupFilterButtons('.tag-filter', ui.activeTagFilters);

  let isEnforcingOrderInFlight = false;

  // Compute whether the ungrouped tabs need to be pushed past the grouped tabs.
  const computeUngrouped = (allTabs, dashboardTab) => {
    const ungrouped = allTabs
      .filter(tab => tab.groupId === -1 && (!dashboardTab || tab.id !== dashboardTab.id))
      .sort((a, b) => a.index - b.index);
    const lastGroupedTabIndex = Math.max(
      ...allTabs.filter(tab => tab.groupId !== -1).map(tab => tab.index),
      0
    );
    const needsReordering = allTabs.some(tab => tab.groupId !== -1) &&
      ungrouped.some(tab => tab.index <= lastGroupedTabIndex);
    return { ungrouped, needsReordering };
  };

  const enforceTabOrder = async () => {
    // Skip if the user is dragging, or a previous enforcement is still running
    // (overlapping runs would let one run's finally{} clear the storage flag
    // while another is mid-move, re-triggering the background render loop).
    if (isDragging || isEnforcingOrderInFlight) {
      return;
    }

    // Read-only pre-check. If nothing needs moving (the common case on
    // metadata/search/filter renders) we return WITHOUT writing the storage
    // flag — previously every render did two storage writes regardless.
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const dashboardTab = allTabs.find(t => t.url === chrome.runtime.getURL("fullpage.html"));
    const dashboardNeedsMove = dashboardTab && dashboardTab.index !== 0;
    const { needsReordering } = computeUngrouped(allTabs, dashboardTab);

    if (!dashboardNeedsMove && !needsReordering) {
      return;
    }

    isEnforcingOrderInFlight = true;
    try {
      // Set flag to prevent the background render loop while we move tabs.
      await chrome.storage.local.set({ isEnforcingTabOrder: true });

      let tabs = allTabs;

      // 1. Pin the dashboard tab to the first position.
      if (dashboardNeedsMove) {
        await chrome.tabs.move(dashboardTab.id, { index: 0 });
        tabs = await chrome.tabs.query({ currentWindow: true }); // indices changed
      }

      // 2. Move all ungrouped tabs to the end (recomputed on current indices).
      const { ungrouped, needsReordering: stillNeeds } = computeUngrouped(tabs, dashboardTab);
      if (stillNeeds) {
        for (const tab of ungrouped) {
          try {
            await chrome.tabs.move(tab.id, { index: -1 });
          } catch (moveError) {
            // Ignore errors when tabs are being dragged by the user
            if (moveError.message && moveError.message.includes("cannot be edited right now")) {
              continue;
            }
            throw moveError;
          }
        }
      }
    } catch (error) {
      // Only log errors that aren't related to user dragging tabs
      if (!error.message || !error.message.includes("cannot be edited right now")) {
        console.error("Error enforcing tab order:", error);
      }
    } finally {
      // Always clear the flag
      await chrome.storage.local.set({ isEnforcingTabOrder: false });
      isEnforcingOrderInFlight = false;
    }
  };

  // --- Drag to Scroll Logic ---
  let isDown = false;
  let startX;
  let scrollLeft;

  cardsContainer.addEventListener('mousedown', (e) => {
    // Don't activate drag-to-scroll if clicking on a draggable element or an action button
    if (e.target.closest('li[draggable="true"]') || e.target.closest('.action-button')) return;
    isDown = true;
    cardsContainer.classList.add('active-drag');
    startX = e.pageX - cardsContainer.offsetLeft;
    scrollLeft = cardsContainer.scrollLeft;
  });

  cardsContainer.addEventListener('mouseleave', () => {
    isDown = false;
    cardsContainer.classList.remove('active-drag');
  });

  cardsContainer.addEventListener('mouseup', () => {
    isDown = false;
    cardsContainer.classList.remove('active-drag');
  });

  cardsContainer.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - cardsContainer.offsetLeft;
    const walk = (x - startX) * 2;
    cardsContainer.scrollLeft = scrollLeft - walk;
  });

  // --- Auto-Scroll on Drag Logic ---
  let autoScrollAnimationFrame = null;
  let autoScrollSpeed = 0;
  const MAX_SCROLL_SPEED = 15;
  let cachedContainerRect = null; // Cache for getBoundingClientRect

  // Calculate scroll speed based on proximity to edge (closer = faster)
  const calculateScrollSpeed = (distanceFromEdge) => {
    const normalizedDistance = Math.max(0, EDGE_SCROLL_ZONE_PX - distanceFromEdge) / EDGE_SCROLL_ZONE_PX;
    return SCROLL_ANIMATION_SPEED + (normalizedDistance * (MAX_SCROLL_SPEED - SCROLL_ANIMATION_SPEED));
  };

  // Check if mouse is in scroll zone and return direction
  const getScrollDirection = (mouseX) => {
    // Use cached rect if available, otherwise calculate and cache
    if (!cachedContainerRect) {
      cachedContainerRect = cardsContainer.getBoundingClientRect();
    }
    const leftEdge = cachedContainerRect.left;
    const rightEdge = cachedContainerRect.right;

    // Check left edge
    if (mouseX < leftEdge + EDGE_SCROLL_ZONE_PX) {
      const distance = mouseX - leftEdge;
      if (distance >= 0) {
        return { direction: 'left', distance };
      }
    }

    // Check right edge
    if (mouseX > rightEdge - EDGE_SCROLL_ZONE_PX) {
      const distance = rightEdge - mouseX;
      if (distance >= 0) {
        return { direction: 'right', distance };
      }
    }

    return null;
  };

  // Auto-scroll animation loop
  const autoScroll = () => {
    if (autoScrollSpeed === 0) {
      autoScrollAnimationFrame = null;
      return;
    }

    // Check if we can scroll further
    const canScrollLeft = cardsContainer.scrollLeft > 0;
    const canScrollRight = cardsContainer.scrollLeft < (cardsContainer.scrollWidth - cardsContainer.clientWidth);

    if ((autoScrollSpeed < 0 && canScrollLeft) || (autoScrollSpeed > 0 && canScrollRight)) {
      cardsContainer.scrollLeft += autoScrollSpeed;
      autoScrollAnimationFrame = requestAnimationFrame(autoScroll);
    } else {
      // Reached boundary, stop scrolling
      autoScrollSpeed = 0;
      autoScrollAnimationFrame = null;
    }
  };

  // Start auto-scroll if not already running
  const startAutoScroll = (speed) => {
    autoScrollSpeed = speed;
    if (!autoScrollAnimationFrame) {
      autoScrollAnimationFrame = requestAnimationFrame(autoScroll);
    }
  };

  // Stop auto-scroll
  const stopAutoScroll = () => {
    autoScrollSpeed = 0;
    if (autoScrollAnimationFrame) {
      cancelAnimationFrame(autoScrollAnimationFrame);
      autoScrollAnimationFrame = null;
    }
  };

  // Listen for dragover on cards container
  cardsContainer.addEventListener('dragover', (e) => {
    // Only auto-scroll when dragging items (not during manual drag-to-scroll)
    if (isDragging) {
      const scrollInfo = getScrollDirection(e.clientX);

      if (scrollInfo) {
        const speed = calculateScrollSpeed(scrollInfo.distance);
        startAutoScroll(scrollInfo.direction === 'left' ? -speed : speed);
      } else {
        stopAutoScroll();
      }
    }
  });

  // Stop auto-scroll when drag ends
  document.addEventListener('dragend', () => {
    stopAutoScroll();
    document.body.classList.remove('dnd-active'); // safety net for any drag source
  });

  // Stop auto-scroll when drop happens
  cardsContainer.addEventListener('drop', () => {
    stopAutoScroll();
  });

  const init = async () => {
    const data = await chrome.storage.sync.get(["tabMetadata", "sidebarCollapsed", "sleepingTabs", "collapsedCards", "settings"]);
    state.tabMetadata = data.tabMetadata || {};
    state.sidebarCollapsed = data.sidebarCollapsed || false;
    state.sleepingTabs = data.sleepingTabs || [];
    state.collapsedCards = data.collapsedCards || {};

    // Migrate settings for existing users (add default settings if not present)
    state.settings = data.settings || { autoCollapseGroups: false };
    if (!data.settings) {
      // First time with settings, save defaults
      await chrome.storage.sync.set({ settings: state.settings });
    }

    // Load bookmark folder ID from local storage
    const localData = await chrome.storage.local.get(["bookmarkFolderId"]);
    state.bookmarkFolderId = localData.bookmarkFolderId || null;

    if (state.sidebarCollapsed) {
      sidebar.classList.add("collapsed");
      // Set initial icon state
      const toggleIcon = sidebarToggle.querySelector("i");
      toggleIcon.className = "fas fa-chevron-right";
    }

    collectTags();
    setupTagFilterButtons();

    // Debounced bookmark change handler to prevent race conditions
    // When multiple bookmark operations happen rapidly, we batch the cache invalidation and render
    const handleBookmarkChange = () => {
      // Clear any pending timeout
      if (bookmarkChangeTimeout) {
        clearTimeout(bookmarkChangeTimeout);
      }

      // Invalidate cache immediately (cheap operation)
      invalidateBookmarkCache();

      // Debounce the expensive render operation by 100ms
      bookmarkChangeTimeout = setTimeout(() => {
        render();
        bookmarkChangeTimeout = null;
      }, 100);
    };

    // Set up bookmark change listeners for cache invalidation
    chrome.bookmarks.onCreated.addListener(handleBookmarkChange);
    chrome.bookmarks.onRemoved.addListener(handleBookmarkChange);
    chrome.bookmarks.onChanged.addListener(handleBookmarkChange);
    chrome.bookmarks.onMoved.addListener(handleBookmarkChange);

    render();
  };

  // --- Tab Bin Drag & Drop Logic ---
  const setupTabBin = (binElement) => {
    binElement.addEventListener('dragover', (e) => {
      e.preventDefault();
      binElement.classList.add('drag-over');
    });

    binElement.addEventListener('dragleave', (e) => {
      binElement.classList.remove('drag-over');
    });

    binElement.addEventListener('drop', async (e) => {
      e.preventDefault();
      binElement.classList.remove('drag-over');

      const dragData = e.dataTransfer.getData("text/plain");
      const itemType = e.dataTransfer.getData("item-type");

      if (itemType === 'tab' && dragData) {
        // Parse JSON to get tab ID and URL
        try {
          const { tabId } = JSON.parse(dragData);
          const tab = await chrome.tabs.get(tabId);

          // Check for unfinished tasks
          if (hasUnfinishedTasks(tab.url)) {
            showTaskWarningDialog(
              tab.url,
              tab.title,
              // onComplete - mark all complete and close
              async () => {
                await chrome.tabs.remove(tabId);
                render();
              },
              // onCloseAnyway - just close
              async () => {
                await chrome.tabs.remove(tabId);
                render();
              }
            );
          } else {
            // No tasks, close immediately
            await chrome.tabs.remove(tabId);
            render();
          }
        } catch (error) {
          console.error('Error closing tab:', error);
        }
      } else if (itemType === 'sleeping-tab') {
        // Handle sleeping tab deletion
        const sleepingTabUrl = e.dataTransfer.getData("sleeping-tab-url");
        const sleepingTab = state.sleepingTabs.find(st => st.url === sleepingTabUrl);

        if (sleepingTab) {
          // Check for unfinished tasks
          if (hasUnfinishedTasks(sleepingTabUrl)) {
            showTaskWarningDialog(
              sleepingTabUrl,
              sleepingTab.title,
              // onComplete - mark all complete and delete
              async () => {
                try {
                  await chrome.bookmarks.remove(sleepingTab.bookmarkId);
                } catch (error) {
                  console.error('Error deleting bookmark:', error);
                }
                state.sleepingTabs = state.sleepingTabs.filter(st => st.url !== sleepingTabUrl);
                saveData();
              },
              // onCloseAnyway - just delete
              async () => {
                try {
                  await chrome.bookmarks.remove(sleepingTab.bookmarkId);
                } catch (error) {
                  console.error('Error deleting bookmark:', error);
                }
                state.sleepingTabs = state.sleepingTabs.filter(st => st.url !== sleepingTabUrl);
                saveData();
              }
            );
          } else {
            // No tasks, delete immediately
            try {
              await chrome.bookmarks.remove(sleepingTab.bookmarkId);
            } catch (error) {
              console.error('Error deleting bookmark:', error);
            }
            state.sleepingTabs = state.sleepingTabs.filter(st => st.url !== sleepingTabUrl);
            saveData();
          }
        }
      } else if (itemType === 'bookmark' && dragData) {
        // Handle bookmark deletion. The bookmark id lives inside the JSON `text/plain`
        // payload set by the bookmark dragstart — there is no separate 'bookmarkId'
        // dataTransfer key, so the previous getData('bookmarkId') always came back
        // empty and deletion silently no-oped.
        try {
          const { bookmarkId } = JSON.parse(dragData);
          if (bookmarkId) {
            await chrome.bookmarks.remove(bookmarkId);
            render();
          }
        } catch (error) {
          console.error('Error deleting bookmark:', error);
        }
      }
      // Note: bookmark folders are not draggable (no folder dragstart exists), so the
      // former 'bookmark-folder' branch was dead code and has been removed.
    });
  };

  setupTabBin(tabBin);
  setupTabBin(tabBinCollapsed);

  init();
