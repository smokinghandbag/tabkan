// TabKan dashboard — entry module.
// (Converted from a single window-load IIFE to an ES module. Module scripts are
// deferred, so the DOM is ready by the time this runs; top-level await is valid.)
import {
  escapeHtml, getFaviconUrl, DEBUG, log, trace,
  RENDER_DEBOUNCE_MS, WAKE_TAB_POLL_INTERVAL_MS, EXTENSION_CHECK_INTERVAL_MS,
  EXTENSION_CHECK_GRACE_PERIOD_MS, EXTENSION_CHECK_RETRY_COUNT,
  SCROLL_ANIMATION_SPEED, EDGE_SCROLL_ZONE_PX,
  FOLDER_INDENT_REM, BOOKMARK_INDENT_REM, FOLDER_HEADER_BASE_REM, DRAG_HANDLE_OFFSET_PX,
  CHROME_GROUP_COLORS, movedLikeDrag,
  normalizeTag, todoProgress, suggestTags, splitMatch,
  formatSavedAt, computeUngrouped,
} from './utils.js';
import { state, ui } from './state.js';
import {
  cardsContainer, sidebarScrollWrapper, dialogOverlay,
  renameDialog, deleteDialog, warningDialog,
  editNoteDialog, settingsDialog, sessionsDialog, saveSessionDialog, loadSessionDialog,
  tagManagerDialog, windowPickerDialog, searchInput, sidebar, sidebarToggle, sidebarCollapseBtn,
  bookmarksCardContainer, taskRollupContainer,
  searchClearBtn,
} from './dom.js';
import { renderBookmarksIfDirty, invalidateBookmarkCache } from './bookmarks.js';
import { aggregateAllTasks, renderTaskRollup, renderCollapsedTaskRollup } from './tasks.js';
import { renderSessions, saveSession, loadSession, importSession, scheduleAutoSnapshot, restoreSessionToNewWindow } from './sessions.js';
import { getFocusedWindowId, getRenderContext, setFocusedWindow, toggleFocusLock, renameWindow, applyAutoFollow, forgetSnapshots } from './workspaces.js';

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
  let isEditingGroupTitle = false; // true while a group title is being edited inline
  let isEditingWindowLabel = false; // true while a window label is being renamed inline
  let isDragging = false; // Track drag operations
  // Pointer-down origin, used to tell a real click from the end of a drag.
  // A tile click handler consults wasDragGesture() before acting.
  let pointerDownPt = null;
  let lastGestureWasDrag = false;
  let renderTimeout = null; // Debounce timer for render
  let pendingRender = false; // Flag for queued render
  let editDialogAbortController = null; // AbortController for edit dialog cleanup
  let editDialogClose = null; // commit-and-close fn for the open Edit Tab modal (auto-save)
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

  // Apply the colour theme: set/remove data-theme on <html> and mirror the
  // choice to localStorage so theme-init.js can apply it pre-paint next load.
  const applyTheme = (theme) => {
    const t = theme === 'light' ? 'light' : 'dark';
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('tabkan-theme', t); } catch { /* ignore */ }
  };

  const toggleSidebar = () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    sidebar.classList.toggle("collapsed", state.sidebarCollapsed);

    // Update toggle button icon
    const toggleIcon = sidebarToggle.querySelector("i");
    if (state.sidebarCollapsed) {
      toggleIcon.className = "ph ph-caret-right";
    } else {
      toggleIcon.className = "ph ph-caret-left";
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

  // --- drag-vs-click gesture tracking ------------------------------------
  // Tiles are draggable, so a click that follows a small drag must NOT trigger
  // the tile's primary action. We record the pointer-down point and, on the
  // following click, flag whether it moved far enough to count as a drag.
  // Handlers call wasDragGesture() to bail out when true.
  document.addEventListener('pointerdown', (e) => {
    pointerDownPt = { x: e.clientX, y: e.clientY };
    lastGestureWasDrag = false;
  }, true);
  document.addEventListener('pointerup', (e) => {
    if (pointerDownPt) {
      lastGestureWasDrag = movedLikeDrag(pointerDownPt.x, pointerDownPt.y, e.clientX, e.clientY);
    }
  }, true);
  // True if the gesture that produced the current click was actually a drag.
  const wasDragGesture = () => lastGestureWasDrag || isDragging;

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

  // Auto-follow: when the user activates another browser window (and focus isn't
  // locked), switch the dashboard's focused workspace to it. onFocusChanged fires
  // with WINDOW_ID_NONE when Chrome loses focus entirely — ignore that.
  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;
    try {
      // Skip auto-follow briefly after WE programmatically open/focus a session
      // window (restoreSessionToNewWindow sets this), so the dashboard stays on the
      // window the user is actually managing instead of jumping to the new one.
      const { tkAutoFollowSuppressUntil } = await chrome.storage.local.get('tkAutoFollowSuppressUntil');
      if (typeof tkAutoFollowSuppressUntil === 'number' && Date.now() < tkAutoFollowSuppressUntil) return;
      const dash = await chrome.windows.getCurrent();
      await applyAutoFollow(windowId, dash && dash.id);
      render();
    } catch (e) { /* ignore */ }
  });

  // Detect if extension context is invalidated and reload the page
  let extensionCheckFailures = 0;
  let pageLoadTime = Date.now();

  // A genuine liveness probe. `chrome.runtime.id` can read falsy transiently on
  // Chromium-based browsers (notably Brave) while the MV3 service worker is
  // suspended/throttled, even though the context is perfectly valid — gating a
  // page reload on that alone caused spurious "constant refresh" loops. Calling
  // into the API and catching the real "Extension context invalidated" throw is
  // the only reliable signal that the context is actually gone.
  const isExtensionContextValid = () => {
    try {
      // Throws synchronously only when the context is truly invalidated.
      return Boolean(chrome.runtime?.id) && typeof chrome.runtime.getURL('') === 'string';
    } catch {
      return false;
    }
  };

  const checkExtensionContext = () => {
    // Only run while the dashboard is actually visible. A backgrounded tab has
    // no need to self-heal until the user returns to it, and skipping the work
    // avoids reload loops triggered by background-tab throttling on Brave/Chromium.
    if (document.visibilityState !== 'visible') {
      return;
    }

    const timeSinceLoad = Date.now() - pageLoadTime;

    // Don't check immediately after page load to avoid false positives during initialization
    if (timeSinceLoad < EXTENSION_CHECK_GRACE_PERIOD_MS) {
      return;
    }

    // Don't check during Chrome API operations (like creating groups/tabs)
    if (ui.isChromeApiOperationInProgress) {
      return;
    }

    if (!isExtensionContextValid()) {
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
        // The Edit Tab modal auto-saves: route the overlay close through its
        // commit-and-close fn instead of just hiding (which would drop edits).
        if (editDialogClose) {
          editDialogClose();
        } else {
          hideDialog(renameDialog);
          if (editDialogAbortController) { editDialogAbortController.abort(); editDialogAbortController = null; }
        }
      } else if (!tagManagerDialog.element.classList.contains("hidden")) {
        hideDialog(tagManagerDialog);
      } else if (!settingsDialog.element.classList.contains("hidden")) {
        hideDialog(settingsDialog);
      } else if (!sessionsDialog.element.classList.contains("hidden")) {
        hideDialog(sessionsDialog);
      } else if (!windowPickerDialog.element.classList.contains("hidden")) {
        hideDialog(windowPickerDialog);
      }
      // Note: Other dialogs may have specific close handlers, keeping them as-is
    }
  });

  // Window picker (Go-to-tab across windows) — cancel just closes it.
  windowPickerDialog.cancel.addEventListener("click", () => hideDialog(windowPickerDialog));

  // Tag chips for the NOTE dialog (legacy style; the Edit Tab modal renders its
  // own chips inline — see openEditDialog).
  const renderTagChips = (tags, container) => {
    container.innerHTML = '';
    tags.forEach(tag => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.innerHTML = `<span>${escapeHtml(tag)}</span><button class="delete-tag" data-tag="${escapeHtml(tag)}">&times;</button>`;
      container.appendChild(chip);
    });
  };

  // How many tabs (active + sleeping, keyed by URL metadata) carry this tag.
  const countTagUsage = (tag) => {
    const lc = tag.toLowerCase();
    let n = 0;
    Object.values(state.tabMetadata).forEach(m => {
      if (m && Array.isArray(m.tags) && m.tags.some(t => t.toLowerCase() === lc)) n++;
    });
    return n;
  };

  // The Edit Tab modal. Auto-saves: every close path (✕, overlay, Esc) commits
  // the current title/notes/tags/todos via `callback`. No Save button.
  export const openEditDialog = (tab, callback) => {
    const metadata = state.tabMetadata[tab.url] || {};
    let tags = [...(metadata.tags || [])];
    let todos = (metadata.todos || []).map(t => ({ text: t.text, completed: !!t.completed }));

    // Header identity
    renameDialog.favicon.src = getFaviconUrl(tab.url);
    let host = '';
    try { host = new URL(tab.url).hostname.replace(/^www\./, ''); } catch { host = tab.url || ''; }
    renameDialog.host.textContent = host;
    renameDialog.host.title = tab.url || '';

    renameDialog.input.value = metadata.title || tab.title || '';
    renameDialog.notesInput.value = metadata.notes || '';
    renameDialog.tagsInput.value = '';
    renameDialog.tagSuggestions.classList.add('hidden');
    renameDialog.tagSuggestions.innerHTML = '';

    if (editDialogAbortController) editDialogAbortController.abort();
    editDialogAbortController = new AbortController();
    const signal = editDialogAbortController.signal;

    let ddActive = -1; // active autocomplete row index (-1 = none)

    // --- renderers --------------------------------------------------------
    const renderChips = () => {
      renameDialog.tagBox.querySelectorAll('.etm-chip').forEach(c => c.remove());
      tags.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'etm-chip';
        chip.innerHTML = `#${escapeHtml(tag)} <span class="etm-chip-x" data-tag="${escapeHtml(tag)}"><i class="ph ph-x"></i></span>`;
        renameDialog.tagBox.insertBefore(chip, renameDialog.tagsInput);
      });
    };

    const renderTodos = () => {
      const c = renameDialog.todoListContainer;
      c.innerHTML = '';
      todos.forEach((todo, index) => {
        const row = document.createElement('div');
        row.className = `etm-todo ${todo.completed ? 'completed' : ''}`;
        row.innerHTML = `
          <span class="etm-todo-box" data-toggle="${index}">${todo.completed ? '<i class="ph ph-check"></i>' : ''}</span>
          <span class="etm-todo-text">${escapeHtml(todo.text)}</span>
          <button class="etm-todo-del" data-del="${index}" aria-label="Delete to-do"><i class="ph ph-trash"></i></button>`;
        c.appendChild(row);
      });
      const { done, total } = todoProgress(todos);
      renameDialog.todoCount.textContent = total ? `${done} / ${total}` : '';
      c.parentElement.classList.toggle('scrollable', c.scrollHeight > c.clientHeight + 2);
    };

    // --- tag autocomplete -------------------------------------------------
    const ddItems = () => Array.from(renameDialog.tagSuggestions.querySelectorAll('[data-add]'));
    const closeDropdown = () => {
      renameDialog.tagSuggestions.classList.add('hidden');
      renameDialog.tagSuggestions.innerHTML = '';
      ddActive = -1;
    };
    const setActive = (i) => {
      const items = ddItems();
      if (!items.length) { ddActive = -1; return; }
      ddActive = (i + items.length) % items.length;
      items.forEach((el, idx) => el.classList.toggle('active', idx === ddActive));
    };
    const addTag = (raw) => {
      const tag = normalizeTag(raw);
      if (tag && !tags.some(t => t.toLowerCase() === tag.toLowerCase())) {
        tags.push(tag);
        ui.availableTags.add(tag);
        renderChips();
      }
      renameDialog.tagsInput.value = '';
      closeDropdown();
      renameDialog.tagsInput.focus();
    };
    const renderDropdown = () => {
      const query = renameDialog.tagsInput.value;
      const { matches, showCreate, createValue } = suggestTags(ui.availableTags, query, tags);
      if (!matches.length && !showCreate) { closeDropdown(); return; }
      let html = '';
      if (matches.length) {
        html += `<div class="etm-dd-head">Existing tags</div>`;
        matches.forEach(name => {
          const [b, m, a] = splitMatch(name, query);
          const count = countTagUsage(name);
          html += `<div class="etm-dd-row" data-add="${escapeHtml(name)}">` +
            `<i class="ph ph-tag"></i>` +
            `<span class="etm-dd-name">${escapeHtml(b)}<b>${escapeHtml(m)}</b>${escapeHtml(a)}</span>` +
            `<span class="etm-dd-meta">${count} ${count === 1 ? 'tab' : 'tabs'}</span></div>`;
        });
      }
      if (showCreate) {
        html += `<div class="etm-dd-create" data-add="${escapeHtml(createValue)}">` +
          `<i class="ph ph-plus"></i>` +
          `<span class="etm-dd-label">Create <b>#${escapeHtml(createValue)}</b></span></div>`;
      }
      renameDialog.tagSuggestions.innerHTML = html;
      renameDialog.tagSuggestions.classList.remove('hidden');
      setActive(0);
    };

    // --- listeners --------------------------------------------------------
    renameDialog.tagsInput.addEventListener('input', renderDropdown, { signal });
    renameDialog.tagsInput.addEventListener('focus', () => renameDialog.tagBox.classList.add('focus'), { signal });
    renameDialog.tagsInput.addEventListener('blur', () => {
      renameDialog.tagBox.classList.remove('focus');
      setTimeout(closeDropdown, 120); // allow a dropdown mousedown to land first
    }, { signal });
    renameDialog.tagsInput.addEventListener('keydown', (e) => {
      const open = !renameDialog.tagSuggestions.classList.contains('hidden');
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const active = open && ddActive >= 0 ? ddItems()[ddActive] : null;
        addTag(active ? active.dataset.add : renameDialog.tagsInput.value);
      } else if (e.key === 'ArrowDown' && open) {
        e.preventDefault(); setActive(ddActive + 1);
      } else if (e.key === 'ArrowUp' && open) {
        e.preventDefault(); setActive(ddActive - 1);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault(); e.stopPropagation(); closeDropdown();
      } else if (e.key === 'Backspace' && renameDialog.tagsInput.value === '' && tags.length) {
        tags.pop(); renderChips();
      }
    }, { signal });
    // mousedown (not click) so the chip is added before the input's blur fires
    renameDialog.tagSuggestions.addEventListener('mousedown', (e) => {
      const row = e.target.closest('[data-add]');
      if (row) { e.preventDefault(); addTag(row.dataset.add); }
    }, { signal });

    renameDialog.tagBox.addEventListener('click', (e) => {
      const del = e.target.closest('.etm-chip-x');
      if (del) {
        const t = del.dataset.tag;
        tags = tags.filter(x => x !== t);
        renderChips();
        return;
      }
      if (e.target === renameDialog.tagBox) renameDialog.tagsInput.focus();
    }, { signal });

    renameDialog.todoListContainer.addEventListener('click', (e) => {
      const box = e.target.closest('[data-toggle]');
      if (box) {
        const i = parseInt(box.dataset.toggle, 10);
        if (todos[i]) { todos[i].completed = !todos[i].completed; renderTodos(); }
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        const i = parseInt(del.dataset.del, 10);
        todos.splice(i, 1); renderTodos();
      }
    }, { signal });

    renameDialog.addTodoInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && renameDialog.addTodoInput.value.trim() !== '') {
        e.preventDefault();
        todos.push({ text: renameDialog.addTodoInput.value.trim(), completed: false });
        renameDialog.addTodoInput.value = '';
        renderTodos();
        renameDialog.todoListContainer.scrollTop = renameDialog.todoListContainer.scrollHeight;
      }
    }, { signal });

    // --- auto-save + close ------------------------------------------------
    const commitAndClose = () => {
      const newTitle = renameDialog.input.value.trim() || tab.title || host;
      const newNotes = renameDialog.notesInput.value.trim();
      const pending = normalizeTag(renameDialog.tagsInput.value);
      if (pending && !tags.some(t => t.toLowerCase() === pending.toLowerCase())) tags.push(pending);
      tags.forEach(t => ui.availableTags.add(t));
      callback(newTitle, [...tags], newNotes, todos);
      hideDialog(renameDialog);
      closeDropdown();
      if (editDialogAbortController) { editDialogAbortController.abort(); editDialogAbortController = null; }
      editDialogClose = null;
    };
    editDialogClose = commitAndClose;
    renameDialog.closeBtn.onclick = commitAndClose;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !renameDialog.element.classList.contains('hidden') &&
          renameDialog.tagSuggestions.classList.contains('hidden')) {
        commitAndClose();
      }
    }, { signal });

    renderChips();
    renderTodos();
    showDialog(renameDialog);
    renameDialog.input.focus();
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

  const openDeleteDialog = (title, description, callback, confirmLabel = 'Delete', destructive = true) => {
    deleteDialog.title.textContent = title;
    deleteDialog.description.textContent = description;
    deleteDialog.confirm.textContent = confirmLabel;
    deleteDialog.confirm.classList.toggle('btn-destructive', destructive);
    deleteDialog.confirm.classList.toggle('btn-primary', !destructive);
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

  // Render the window switcher into both sidebar containers from the view model.
  // Shows open-window tabs when 2+ windows are open; shows closed sessions when
  // present (persistent "open in new window" + dismiss). Collapsed rail chips only
  // when 2+ open windows. Click a non-focused tab → switch focus (+ lock); click
  // the focused tab → toggle the lock (auto-follow on/off); double-click a label → rename.
  const renderWindowSwitcher = (switcher) => {
    const expanded = document.getElementById('window-switcher');
    const collapsed = document.getElementById('collapsed-window-switcher');
    if (!expanded || !collapsed) return;
    if (!switcher || !switcher.visible) {
      expanded.hidden = true; collapsed.hidden = true;
      expanded.replaceChildren(); collapsed.replaceChildren();
      return;
    }
    if (isEditingWindowLabel) return; // don't tear down a label mid-edit
    expanded.hidden = false;
    const lockIcon = '<i class="ph ph-lock-simple ws-lock" title="Focus locked — click to auto-follow"></i>';

    const children = [];
    const head = document.createElement('div');
    head.className = 'ws-heading';
    head.textContent = 'Windows';
    children.push(head);

    // Open-window tabs (only meaningful with 2+ open windows)
    if (switcher.windows.length >= 2) {
      const tabsEl = document.createElement('div');
      tabsEl.className = 'ws-tabs';
      switcher.windows.forEach(w => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'ws-tab' + (w.isFocused ? ' active' : '');
        tab.dataset.tkId = w.tkId;
        const label = document.createElement('span');
        label.className = 'ws-label';
        label.textContent = w.displayLabel || w.label;
        tab.appendChild(label);
        if (w.isFocused && switcher.locked) tab.insertAdjacentHTML('beforeend', lockIcon);
        tab.addEventListener('click', () => onSwitcherClick(w.tkId, w.isFocused));
        label.addEventListener('dblclick', (e) => { e.stopPropagation(); beginRenameWindow(label, w.tkId); });
        tabsEl.appendChild(tab);
      });
      children.push(tabsEl);
    }

    // Closed sessions: restore into a new window (persistent), or dismiss.
    if (switcher.closedSessions && switcher.closedSessions.length) {
      const wrap = document.createElement('div');
      wrap.className = 'ws-closed';
      switcher.closedSessions.forEach(s => {
        const row = document.createElement('div');
        row.className = 'ws-closed-row';
        const lbl = document.createElement('div');
        lbl.className = 'ws-closed-label';
        lbl.innerHTML = '<span class="ws-closed-name"></span><span class="ws-closed-stats"></span>';
        lbl.querySelector('.ws-closed-name').textContent = formatSavedAt(s.savedAt) || s.label;
        lbl.querySelector('.ws-closed-stats').textContent =
          `${s.groupCount} group${s.groupCount === 1 ? '' : 's'} · ${s.tabCount} tab${s.tabCount === 1 ? '' : 's'}`;
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'ws-closed-open';
        open.innerHTML = '<i class="ph ph-arrow-square-out"></i> Open in new window';
        open.addEventListener('click', () => onOpenClosedSession(s.tkId));
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'ws-closed-dismiss';
        dismiss.setAttribute('aria-label', 'Dismiss saved session');
        dismiss.innerHTML = '<i class="ph ph-x"></i>';
        dismiss.addEventListener('click', () => onDismissClosedSession(s.tkId));
        // Stack vertically: [name/stats … ×] on top, full-width action below — the
        // sidebar is narrow, so a single horizontal row truncates badly.
        const headRow = document.createElement('div');
        headRow.className = 'ws-closed-head';
        headRow.append(lbl, dismiss);
        row.append(headRow, open);
        wrap.appendChild(row);
      });
      children.push(wrap);
    }
    expanded.replaceChildren(...children);

    // Collapsed rail: open-window chips, only when there are 2+ windows to switch.
    if (switcher.windows.length >= 2) {
      collapsed.hidden = false;
      const chips = switcher.windows.map((w, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ws-chip' + (w.isFocused ? ' active' : '');
        chip.dataset.tkId = w.tkId;
        chip.title = w.displayLabel || w.label;
        chip.textContent = String(i + 1);
        if (w.isFocused && switcher.locked) chip.insertAdjacentHTML('beforeend', lockIcon);
        chip.addEventListener('click', () => onSwitcherClick(w.tkId, w.isFocused));
        return chip;
      });
      collapsed.replaceChildren(...chips);
    } else {
      collapsed.hidden = true;
      collapsed.replaceChildren();
    }
  };

  const onOpenClosedSession = async (tkId) => { await restoreSessionToNewWindow(tkId); render(); };
  const onDismissClosedSession = async (tkId) => { await forgetSnapshots([tkId]); render(); };

  const onSwitcherClick = async (tkId, isFocused) => {
    if (isFocused) { await toggleFocusLock(); } else { await setFocusedWindow(tkId); }
    render();
  };

  const beginRenameWindow = (labelEl, tkId) => {
    isEditingWindowLabel = true;
    labelEl.contentEditable = 'true';
    labelEl.focus();
    const sel = window.getSelection();
    if (sel && sel.selectAllChildren) sel.selectAllChildren(labelEl);
    const original = labelEl.textContent;
    let done = false;
    const finish = async (commit) => {
      if (done) return; // guard double-fire (blur after Enter)
      done = true;
      labelEl.contentEditable = 'false';
      isEditingWindowLabel = false;
      const name = labelEl.textContent.trim();
      if (commit && name && name !== original) {
        await renameWindow(tkId, name);
      } else {
        labelEl.textContent = original;
      }
      render();
    };
    labelEl.addEventListener('blur', () => finish(true), { once: true });
    labelEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); labelEl.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); labelEl.textContent = original; labelEl.blur(); }
    });
  };

  // Set a short suppression window so the background ignores the re-render that our
  // OWN group write (rename/collapse/color) would otherwise trigger via
  // tabGroups.onUpdated. Honoured by the tabGroups.onUpdated guard in background.js
  // (which inlines the equivalent of isWithinSuppressionWindow from utils.js).
  const SUPPRESS_GROUP_NOTIFY_MS = 1200;
  const suppressGroupNotify = async () => {
    try {
      await chrome.storage.local.set({ tkGroupMutationUntil: Date.now() + SUPPRESS_GROUP_NOTIFY_MS });
    } catch (e) { /* best-effort */ }
  };

  // Resolve the window the dashboard is currently managing: the focused window, or
  // the dashboard's own window by default. Used by render and every window-scoped
  // mutation so they all act on the same window.
  const resolveTargetWindowId = async () => {
    const w = await chrome.windows.getCurrent();
    return getFocusedWindowId(w && w.id);
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
    // Never tear down a group title that is being edited — defer until the edit ends.
    if (isEditingGroupTitle) { pendingRender = true; return; }
    if (ui.isWakingTab) {
      log('⏸️  RENDER BLOCKED: ui.isWakingTab = true');
      trace('  Call stack:');
      return; // Skip rendering during wake operations
    }
    log('🎨 RENDER START');
    trace('  Called from:');
    isRendering = true;

    try {
      const dashWin = await chrome.windows.getCurrent();
      const { focusedWindowId, switcher } = await getRenderContext(dashWin && dashWin.id);

      await withChromeApiProtection(async () => {
        await enforceTabOrder(focusedWindowId);
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
      updateFilterButtonsState();

      // Per-window board: each dashboard shows ONLY its own window's tabs/groups.
      // (A global all-windows query merged every window's groups onto one board,
      // showing duplicated/merged groups when more than one window was open.) For
      // the common single-window case this is identical to before; with multiple
      // windows each gets its own independent board, and the Go-to-tab dialog
      // handles a tab/URL that happens to be open in more than one window.
      // focusedWindowId resolved once above (before enforceTabOrder) and reused here.

      // Per-window board: query only this window's tabs/groups.
      const [allTabs, allGroups] = await Promise.all([
        chrome.tabs.query({ windowId: focusedWindowId }),
        chrome.tabGroups.query({ windowId: focusedWindowId })
      ]);

      // Exclude EVERY dashboard tab (there is one per window now that each window
      // can have its own), not just the first one found — otherwise a second
      // window's dashboard would render the other window's dashboard as a tile.
      const dashboardUrl = chrome.runtime.getURL("fullpage.html");

      const tabsByGroup = allGroups.reduce((acc, group) => {
        acc[group.id] = [];
        return acc;
      }, { 'unfiled': [] });

      allTabs.forEach(tab => {
        if (tab.url === dashboardUrl) return; // Exclude all dashboard tabs
        const groupId = tab.groupId > -1 ? tab.groupId : 'unfiled';
        if (tabsByGroup[groupId]) {
          tabsByGroup[groupId].push(tab);
        } else {
          tabsByGroup['unfiled'].push(tab);
        }
      });

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

      const isFiltering = !!ui.searchTerm || !ui.activeTagFilters.has('all');
      let visibleTabCount = 0;

      // Ungrouped tabs render as the LAST column of the board (after the
      // "+ New Group" tile). Computed here so its matches count toward the
      // empty-state check; the column itself is appended below. Shown only when
      // ungrouped tabs exist (and, while filtering, only if some match).
      const unfiledTabs = tabsByGroup.unfiled || [];
      const unfiledVisible = unfiledTabs.filter(shouldShowItem).length;
      const showUnfiled = unfiledTabs.length > 0 && (!isFiltering || unfiledVisible > 0);
      if (showUnfiled) visibleTabCount += isFiltering ? unfiledVisible : unfiledTabs.length;

      sortedGroups.forEach((group, index) => {
        const tabs = tabsByGroup[group.id] || [];
        const items = tabs;

        // Count tabs matching the active search/tag filters (for the status bar).
        const matchingCount = items.filter(item => shouldShowItem(item)).length;
        visibleTabCount += isFiltering ? matchingCount : items.length;
        const hasVisibleItems = matchingCount > 0;

        // Skip cards with no visible items when filtering
        if (isFiltering && !hasVisibleItems) {
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

      // Empty state: filtering is active but no tab matched. Show a message
      // instead of a blank board (the "+ New Group" link is hidden here).
      if (isFiltering && visibleTabCount === 0) {
        const empty = document.createElement("div");
        empty.className = "board-empty-state";
        empty.innerHTML = `<i class="ph ph-magnifying-glass"></i><p>No tabs match your search or filters.</p><button class="board-empty-clear">Clear filters</button>`;
        empty.querySelector('.board-empty-clear').addEventListener('click', clearAllFilters);
        cardsContainer.appendChild(empty);
      } else {
        // "+ New Group" is a DROP TARGET: drag a tab onto it to start a new group
        // from that tab (then name it inline). Chrome can't hold an empty group, so
        // groups are seeded from a real tab rather than a blank "New Tab" placeholder.
        const createCardLink = document.createElement("div");
        createCardLink.className = "create-card-link";
        createCardLink.innerHTML = `<span class="ccl-title"><i class="ph ph-plus"></i> New Group</span><span class="ccl-hint">Drag a tab here to start a group, or click to create one</span>`;
        createCardLink.title = "Drag a tab onto this to group it, or click to create a new group";
        createCardLink.addEventListener("dragover", (e) => {
          if (!isDragging) return; // only internal tab drags
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          createCardLink.classList.add('drop-target');
        });
        createCardLink.addEventListener("dragleave", () => createCardLink.classList.remove('drop-target'));
        createCardLink.addEventListener("drop", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          createCardLink.classList.remove('drop-target');
          document.querySelectorAll('.placeholder').forEach(p => p.remove());
          const itemType = e.dataTransfer.getData("item-type");
          const dragData = e.dataTransfer.getData("text/plain");
          if (itemType === 'tab' && dragData) {
            try {
              const { tabId } = JSON.parse(dragData);
              await createGroupFromTab(parseInt(tabId));
            } catch (err) { console.error('[TabKan] create group from drop failed:', err); }
          }
        });
        // Clicking (no drag) still creates a group — but Chrome can't make an empty
        // group, so warn that a starter tab will be opened (a browser restriction).
        createCardLink.addEventListener("click", () => {
          openDeleteDialog(
            "Start a new empty group?",
            "Chrome can't create a tab group with no tabs, so TabKan will open one new tab to start the group — that's a browser restriction, not a bug. You can rename the group inline, then close or replace that tab once you've added what you want. (Tip: dragging a tab onto “+ New Group” avoids the extra tab.)",
            () => createEmptyGroup(),
            "Create group",
            false
          );
        });
        cardsContainer.appendChild(createCardLink);

        // If we just created a group from a dropped tab, focus its title so the
        // user can name it inline straight away.
        if (pendingFocusGroupId != null) {
          const editable = cardsContainer.querySelector(`.editable[data-card-id="${pendingFocusGroupId}"]`);
          pendingFocusGroupId = null;
          if (editable) {
            editable.focus();
            const range = document.createRange();
            range.selectNodeContents(editable);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }

        // Ungrouped column goes LAST — after the "+ New Group" tile.
        if (showUnfiled) {
          cardsContainer.appendChild(createCardElement({ id: 'unfiled', title: 'Ungrouped Tabs', color: null }, unfiledTabs));
        }
      }

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
      renderWindowSwitcher(switcher);

      // Keep a rolling recovery snapshot of the live workspace (debounced inside
      // sessions.js) so a browser quit without "Continue where you left off"
      // doesn't lose the user's tab groups. No-ops on an empty workspace.
      scheduleAutoSnapshot();

    } finally {
      isRendering = false; // Release the lock
    }
  };

  // --- Close tab with undo --------------------------------------------------
  // Closing a tab is immediate (no blocking dialog); a transient "Undo" toast
  // bottom-left lets the user recover an accidental close. Replaces the old
  // drag-to-"Drop to Close" bin. Notes/tags/to-dos are keyed by URL, so a
  // restored tab automatically re-associates with its metadata.
  let undoStack = [];        // closed-tab snapshots, newest last
  let undoTimer = null;
  const UNDO_WINDOW_MS = 6000;

  const removeUndoToast = () => {
    const el = document.getElementById('tk-undo-toast');
    if (el) el.remove();
  };

  const renderUndoToast = () => {
    removeUndoToast();
    if (undoStack.length === 0) return;
    const n = undoStack.length;
    const toast = document.createElement('div');
    toast.id = 'tk-undo-toast';
    toast.className = 'tk-undo-toast';
    const label = document.createElement('span');
    label.className = 'tk-undo-label';
    label.textContent = n === 1 ? 'Tab closed' : `${n} tabs closed`;
    const btn = document.createElement('button');
    btn.className = 'tk-undo-btn';
    btn.innerHTML = '<i class="ph ph-arrow-counter-clockwise"></i> Undo';
    btn.addEventListener('click', async () => {
      const snap = undoStack.pop();
      if (snap) await restoreClosedTab(snap);
      if (undoStack.length === 0) {
        if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
        removeUndoToast();
      } else {
        renderUndoToast();
      }
    });
    toast.appendChild(label);
    toast.appendChild(btn);
    document.body.appendChild(toast);
  };

  const closeTabWithUndo = async (tab) => {
    // Capture enough to put the tab (and, if needed, its group) back.
    let groupInfo = null;
    if (tab.groupId != null && tab.groupId !== -1) {
      try {
        const g = await chrome.tabGroups.get(tab.groupId);
        groupInfo = { id: g.id, title: g.title, color: g.color, windowId: g.windowId };
      } catch (e) { /* group may be gone */ }
    }
    const snap = { url: tab.url, index: tab.index, pinned: !!tab.pinned, windowId: tab.windowId, groupInfo };
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      console.error('[TabKan] could not close tab:', e);
      return;
    }
    undoStack.push(snap);
    renderUndoToast();
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { undoStack = []; removeUndoToast(); undoTimer = null; }, UNDO_WINDOW_MS);
  };

  const restoreClosedTab = async (snap) => {
    try {
      const created = await chrome.tabs.create({
        windowId: snap.windowId, url: snap.url, index: snap.index, pinned: snap.pinned, active: false
      });
      if (snap.groupInfo) {
        let liveGid = null;
        try { await chrome.tabGroups.get(snap.groupInfo.id); liveGid = snap.groupInfo.id; } catch (e) { /* group gone */ }
        if (liveGid != null) {
          await chrome.tabs.group({ groupId: liveGid, tabIds: [created.id] });
        } else {
          // The group was emptied by the close — recreate it with its title/colour.
          const newGid = await chrome.tabs.group({ tabIds: [created.id], createProperties: { windowId: snap.windowId } });
          try { await chrome.tabGroups.update(newGid, { title: snap.groupInfo.title, color: snap.groupInfo.color }); } catch (e) {}
        }
      }
      render();
    } catch (e) {
      console.error('[TabKan] undo restore failed:', e);
    }
  };

  // --- External (browser) bookmark drop -------------------------------------
  // Pull a URL out of a drop that originated OUTSIDE the dashboard — e.g. a
  // bookmark dragged from Chrome's bookmarks bar. Such drags carry no internal
  // item-type/JSON; they expose the URL via these standard drag types.
  const extractExternalDropUrl = (dt) => {
    const candidates = [];
    try {
      const uriList = dt.getData('text/uri-list');
      if (uriList) candidates.push(...uriList.split(/\r?\n/).filter(l => l && !l.startsWith('#')));
    } catch { /* type unavailable */ }
    try {
      const moz = dt.getData('text/x-moz-url'); // "URL\nTitle"
      if (moz) candidates.push(moz.split(/\r?\n/)[0]);
    } catch { /* type unavailable */ }
    try {
      const plain = dt.getData('text/plain');
      if (plain) candidates.push(plain.trim());
    } catch { /* type unavailable */ }
    for (const c of candidates) {
      if (/^https?:\/\//i.test(c)) return c.trim();
    }
    return null;
  };

  // Commit a URL dragged in from the browser's bookmarks bar as a real tab in the
  // target group, then remove the source bookmark — but ONLY when exactly one
  // bookmark has that URL (the drag exposes no bookmark id, so we match by URL and
  // refuse to guess when several share it).
  const commitExternalBookmarkToGroup = async (url, group) => {
    try {
      const newTab = await chrome.tabs.create({ url, active: false });
      if (group.id !== 'unfiled') {
        try { await chrome.tabs.group({ groupId: parseInt(group.id), tabIds: [newTab.id] }); }
        catch (e) { console.error('[TabKan] could not group dropped bookmark tab:', e); }
      }

      const norm = (u) => (u || '').replace(/\/+$/, '');
      const matches = await chrome.bookmarks.search({ url });
      const exact = matches.filter(b => b.url && norm(b.url) === norm(url));
      if (exact.length === 1) {
        await chrome.bookmarks.remove(exact[0].id);
      } else if (exact.length > 1) {
        console.info(`[TabKan] ${exact.length} bookmarks share ${url}; left them in place (won't guess which to remove).`);
      }
    } catch (e) {
      console.error('[TabKan] external bookmark drop failed:', e);
    }
    render();
  };

  // --- Go-to-tab across windows --------------------------------------------
  // Activate a specific tab and bring its window to the front.
  const activateTab = async (t) => {
    try {
      await chrome.tabs.update(t.id, { active: true });
      if (t.windowId != null) await chrome.windows.update(t.windowId, { focused: true });
    } catch (e) {
      console.error('[TabKan] could not activate tab:', e);
    }
  };

  // Go-to-tab handler. The board is a global view across all windows, so the same
  // URL can be open in more than one window ("mirrored"). If it is, ask which
  // window to bring it up in; otherwise switch straight to it.
  const goToTab = async (tab) => {
    let instances = [tab];
    try {
      const all = await chrome.tabs.query({});
      const matches = all.filter(t => t.url === tab.url);
      if (matches.length > 0) instances = matches;
    } catch { /* fall back to the clicked tab */ }

    const windowIds = new Set(instances.map(t => t.windowId));
    if (windowIds.size <= 1) {
      // Single window — prefer the exact tab we clicked.
      await activateTab(instances.find(t => t.id === tab.id) || instances[0]);
      return;
    }
    await showWindowPicker(instances);
  };

  // Present the "which window?" chooser for a URL open in several windows.
  const showWindowPicker = async (instances) => {
    // Stable ordinal labels (Window 1, 2, …) by window id; mark the current one.
    let order = new Map();
    let currentWinId = null;
    try {
      const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
      wins.sort((a, b) => a.id - b.id).forEach((w, i) => order.set(w.id, i + 1));
      currentWinId = (await chrome.windows.getCurrent()).id;
    } catch { /* labels degrade gracefully */ }

    // One entry per window (first instance found in each).
    const byWindow = new Map();
    for (const t of instances) if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, t);

    windowPickerDialog.list.replaceChildren();
    [...byWindow.entries()]
      .sort((a, b) => (order.get(a[0]) || 0) - (order.get(b[0]) || 0))
      .forEach(([winId, t]) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary window-pick-btn';
        const n = order.get(winId);
        const icon = document.createElement('i');
        icon.className = 'ph ph-browser';
        const label = document.createElement('span');
        label.textContent = n ? `Window ${n}` : 'Window';
        btn.appendChild(icon);
        btn.appendChild(label);
        if (winId === currentWinId) {
          const sub = document.createElement('span');
          sub.className = 'window-pick-sub';
          sub.textContent = 'this window';
          btn.appendChild(sub);
        }
        btn.addEventListener('click', async () => {
          hideDialog(windowPickerDialog);
          await activateTab(t);
        });
        windowPickerDialog.list.appendChild(btn);
      });

    showDialog(windowPickerDialog);
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

    // Hover actions: Edit (opens the editor), Go-to-tab (switches to the tab),
    // and Close (removes the tab immediately, with an undo toast). The card body
    // itself is not a click target — see the click handler.
    const linkActions = `<div class="link-actions">` +
      `<button class="action-button tab-edit" title="Edit tab"><i class="ph ph-pencil-simple"></i></button>` +
      `<button class="action-button tab-goto" title="Go to tab"><i class="ph ph-arrow-square-out"></i></button>` +
      `<button class="action-button tab-delete" title="Close tab"><i class="ph ph-trash"></i></button></div>`;
    // Tag chips are clickable filter shortcuts (data-tag drives toggleTagFilter).
    const tagsHTML = tags.length > 0 ? `<div class="tags-container">${tags.map(tag => `<span class="tag" data-tag="${escapeHtml(tag)}" title="Filter by #${escapeHtml(tag)}">${escapeHtml(tag)}</span>`).join('')}</div>` : '';
    // Note preview: full-width, clamped to a few lines with a trailing ellipsis.
    const notesHTML = notes ? `<div class="notes-container" title="Edit notes"><p>${escapeHtml(notes)}</p></div>` : '';
    // To-do legend (bottom-left). Clicking it opens the editor.
    const todosSummaryHTML = todos.length > 0
      ? `<div class="todos-summary" title="Edit to-dos"><i class="ph ph-check-square"></i><span>${todos.filter(t => t.completed).length}/${todos.length}</span></div>`
      : '';
    // Footer row: to-do legend anchored left, tags anchored right.
    const footerHTML = (todos.length > 0 || tags.length > 0)
      ? `<div class="tab-footer">${todosSummaryHTML}${tagsHTML}</div>`
      : '';
    // Always show a favicon: prefer the tab's own favicon when it's a safe
    // http(s)/data URL, otherwise derive one from the tab's hostname. Chrome
    // frequently leaves favIconUrl empty (unloaded/discarded tabs), so gating on
    // it alone left many tabs with a blank placeholder.
    const faviconSrc = (tab.favIconUrl && /^(https?:|data:)/i.test(tab.favIconUrl))
      ? tab.favIconUrl
      : getFaviconUrl(tab.url);
    const faviconHTML = `<img src="${escapeHtml(faviconSrc)}" class="favicon" alt="">`;

    listItem.innerHTML = `<div class="tab-main">${faviconHTML}<span class="title">${escapeHtml(title)}</span>${linkActions}</div>${notesHTML}${footerHTML}`;

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

    // Open the full edit dialog for this tab.
    const openEdit = () => openEditDialog(tab, (newTitle, newTags, newNotes, newTodos) => {
      state.tabMetadata[tab.url] = { title: newTitle, tags: newTags, notes: newNotes, todos: newTodos };
      saveData();
    });

    // One delegated click handler per tile, dispatched by zone. Click-zone model
    // (v5.1): the card body is NOT a click target (it caused confusion). Only the
    // explicit affordances act — tag chip = filter; note / to-do legend = edit;
    // ✎ = edit; ⇗ (go-to) = switch to the tab.
    listItem.addEventListener("click", async (e) => {
      if (wasDragGesture()) return; // ignore the click that ends a drag

      const tagChip = e.target.closest('.tags-container .tag');
      if (tagChip && tagChip.dataset.tag) {
        toggleTagFilter(tagChip.dataset.tag);
        return;
      }
      if (e.target.closest('.tab-edit')) { openEdit(); return; }
      if (e.target.closest('.tab-goto')) {
        await goToTab(tab);
        return;
      }
      if (e.target.closest('.tab-delete')) {
        await closeTabWithUndo(tab);
        return;
      }
      if (e.target.closest('.notes-container') || e.target.closest('.todos-summary')) {
        openEdit();
        return;
      }
      // Anywhere else on the card: no action.
    });

    return listItem;
  }

  // Helper function to generate card actions HTML
  const generateCardActionsHTML = (groupId, isCollapsed, isSidebar) => {
    if (isSidebar) return '';

    return `
      <div class="card-actions">
        <button class="action-button toggle-collapse" title="${isCollapsed ? 'Expand' : 'Collapse'}" data-group-id="${groupId}">
          <i class="ph ph-${isCollapsed ? 'arrows-out-line-horizontal' : 'arrows-in-line-horizontal'}"></i>
        </button>
        <button class="action-button move-left" title="Move Left"><i class="ph ph-arrow-left"></i></button>
        <button class="action-button move-right" title="Move Right"><i class="ph ph-arrow-right"></i></button>
        <button class="action-button delete-card" title="Delete Group"><i class="ph ph-trash"></i></button>
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
          <i class="ph ph-caret-${isSidebarCardCollapsed ? 'right' : 'down'} sidebar-card-toggle"></i>
          <span data-card-id="${group.id}">${escapeHtml(group.title)}</span>
          <span class="card-stats">${totalItems}</span>
        </div>
      `;
    } else if (group.id === 'unfiled') {
      // Ungrouped column: a real grid column for unsorted tabs, but it's not a
      // Chrome group — so its title isn't editable and it has no move/delete/
      // collapse actions. Dropping a tab here ungroups it (handled in the drop
      // logic, which already treats 'unfiled' as ungroup).
      cardElement.classList.add('card-ungrouped');
      cardElement.innerHTML = `
        <div class="card-header">
          <span class="card-title-static">${escapeHtml(group.title)}</span>
          <span class="card-stats card-count">${totalItems}</span>
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
      openTabButton.innerHTML = '<i class="ph ph-plus"></i> Open new tab';
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

        // External drop: a bookmark dragged in from the browser's bookmarks bar
        // (no internal item-type). Commit it as a tab in this group and remove the
        // source bookmark (only when exactly one matches — see helper).
        if (!itemType) {
          const externalUrl = extractExternalDropUrl(e.dataTransfer);
          if (externalUrl) {
            document.querySelectorAll('.placeholder').forEach(p => p.remove());
            await commitExternalBookmarkToGroup(externalUrl, group);
            return;
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
      // The ungrouped column has no editable title and no delete action, so guard
      // both (it's a pseudo-group, not a real Chrome group).
      const cardNameElement = cardElement.querySelector(".card-header .editable");
      if (cardNameElement) {
        cardNameElement.addEventListener("focus", () => { isEditingGroupTitle = true; });
        cardNameElement.addEventListener("blur", async () => {
          isEditingGroupTitle = false;
          if (cardNameElement.dataset.committing) return; // re-entrancy guard (teardown blur)
          const newName = cardNameElement.textContent.trim();
          if (newName && newName !== group.title) {
            cardNameElement.dataset.committing = '1';
            await suppressGroupNotify();
            try {
              await chrome.tabGroups.update(group.id, { title: newName });
              group.title = newName;                 // keep closure + card in sync
              cardNameElement.textContent = newName; // in place — no full render()
            } catch (e) {
              console.error('[TabKan] group rename failed:', e);
              cardNameElement.textContent = group.title;
            }
            delete cardNameElement.dataset.committing;
            if (pendingRender) render();             // flush any render deferred during the edit
          } else {
            cardNameElement.textContent = group.title;
          }
        });

        cardNameElement.addEventListener("keydown", e => {
          if (e.key === "Enter") { e.preventDefault(); cardNameElement.blur(); }
        });
      }

      const deleteCardBtn = cardElement.querySelector(".delete-card");
      if (deleteCardBtn) {
        deleteCardBtn.addEventListener("click", () => openDeleteDialog("Delete Group", `This will ungroup all tabs in "${group.title}". The tabs themselves will not be closed.`, async () => {
          const tabsInGroup = await chrome.tabs.query({ groupId: group.id });
          await chrome.tabs.ungroup(tabsInGroup.map(t => t.id));
          render();
        }));
      }

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
          toggleCollapseBtn.innerHTML = isCurrentlyCollapsed ? '<i class="ph ph-arrows-in-line-horizontal"></i>' : '<i class="ph ph-arrows-out-line-horizontal"></i>';
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
            sidebarToggle.className = 'ph ph-caret-down sidebar-card-toggle';
          } else {
            cardElement.classList.add('collapsed');
            state.collapsedCards[`sidebar-${cardId}`] = true;
            sidebarToggle.className = 'ph ph-caret-right sidebar-card-toggle';
          }

          saveData(false);
        });
      }
    }

    return cardElement;
  }

  // Create a new group seeded from an existing tab (dropped on "+ New Group").
  // Chrome groups can't be empty, so we group a real tab rather than spawning a
  // blank "New Tab". pendingFocusGroupId tells the next render to focus the new
  // group's (inline-editable) title so it can be named immediately.
  let pendingFocusGroupId = null;
  const createGroupFromTab = async (tabId) => {
    try {
      const newGroupId = await withChromeApiProtection(async () => {
        const gid = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: await resolveTargetWindowId() } });
        // Give it a sensible default title so it's never blank; the next render
        // focuses + selects it (below) so typing renames it immediately.
        await suppressGroupNotify();
        await chrome.tabGroups.update(gid, { title: 'New group' });
        return gid;
      });
      pendingFocusGroupId = newGroupId;
      render();
    } catch (error) {
      console.error("Error creating new group from tab:", error);
    }
  };

  // Create a group via the click path (no dragged tab). Chrome requires a tab in
  // every group, so this opens one starter tab — the user is warned first.
  const createEmptyGroup = async () => {
    try {
      const newGroupId = await withChromeApiProtection(async () => {
        const targetWin = await resolveTargetWindowId();
        const newTab = await chrome.tabs.create({ active: false, index: 9999, windowId: targetWin });
        const gid = await chrome.tabs.group({ tabIds: [newTab.id], createProperties: { windowId: targetWin } });
        await suppressGroupNotify();
        await chrome.tabGroups.update(gid, { title: 'New group' });
        return gid;
      });
      pendingFocusGroupId = newGroupId;
      render();
    } catch (error) {
      console.error("Error creating new group:", error);
    }
  };

  // Create bookmark folder dialog

  warningDialog.ok.addEventListener("click", () => hideDialog(warningDialog));

  // Settings dialog handlers
  const settingsBtn = document.getElementById("settings-btn");
  settingsBtn.addEventListener("click", () => {
    // Load current settings into UI
    settingsDialog.autoCollapseCheckbox.checked = state.settings.autoCollapseGroups || false;
    syncThemeToggle();
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

  // --- Theme toggle (Appearance) ---
  const themeOptButtons = Array.from(document.querySelectorAll('#theme-toggle .theme-opt'));
  const syncThemeToggle = () => {
    const current = state.settings.theme === 'light' ? 'light' : 'dark';
    themeOptButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.themeChoice === current));
  };
  themeOptButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const choice = btn.dataset.themeChoice === 'light' ? 'light' : 'dark';
      if (state.settings.theme === choice) return;
      state.settings.theme = choice;
      applyTheme(choice);
      syncThemeToggle();
      saveData(false);
    });
  });

  // --- Sessions Dialog Handlers ---

  // Toggle all cards expand/collapse
  const toggleAllCardsBtn = document.getElementById("toggle-all-cards-btn");
  let allCardsCollapsed = false;

  toggleAllCardsBtn.addEventListener("click", async () => {
    const allGroups = await chrome.tabGroups.query({ windowId: await resolveTargetWindowId() });
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
                toggleBtn.innerHTML = '<i class="ph ph-arrows-in-line-horizontal"></i>';
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
      toggleAllCardsBtn.querySelector("i").className = "ph ph-arrows-in-line-horizontal";
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
                toggleBtn.innerHTML = '<i class="ph ph-arrows-out-line-horizontal"></i>';
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
      toggleAllCardsBtn.querySelector("i").className = "ph ph-arrows-out-line-horizontal";
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
          <i class="ph ph-tag"></i>
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
            <i class="ph ph-trash"></i>
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

  // Sessions now lives inside the Settings dialog ("Save & Restore").
  const openSessionsBtn = document.getElementById("open-sessions-btn");
  openSessionsBtn.addEventListener("click", async () => {
    hideDialog(settingsDialog);
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
    searchClearBtn.classList.toggle('hidden', !ui.searchTerm);
    // Debounce: every keystroke previously triggered a full async render
    // (tab/group queries, tab reordering, storage writes, full DOM rebuild).
    debouncedRender();
  });

  // Clear (×) button inside the search field.
  searchClearBtn.addEventListener("click", () => {
    ui.searchTerm = '';
    searchInput.value = '';
    searchClearBtn.classList.add('hidden');
    searchInput.focus();
    render();
  });

  // Reset both the search term and tag filters (used by the empty-state button).
  const clearAllFilters = () => {
    ui.searchTerm = '';
    searchInput.value = '';
    searchClearBtn.classList.add('hidden');
    ui.activeTagFilters.clear();
    ui.activeTagFilters.add('all');
    render();
  };

  // Toggle a tag in the active filter set. 'all' resets to show everything;
  // any other tag is added/removed (and we fall back to 'all' when none remain).
  // Shared by the toolbar filter buttons and tile tag-chip clicks.
  const toggleTagFilter = (filterValue) => {
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
  };

  const setupFilterButtons = () => {
    document.querySelector('.filters-search-container').addEventListener('click', (e) => {
      if (e.target.classList.contains('tag-filter')) {
        toggleTagFilter(e.target.dataset.tag);
      }
    });
  };
  
  const setupTagFilterButtons = () => setupFilterButtons('.tag-filter', ui.activeTagFilters);

  let isEnforcingOrderInFlight = false;

  // computeUngrouped lives in utils.js (pure + unit-tested) — it now excludes
  // PINNED tabs, which Chrome won't move past groups (that caused an infinite
  // enforce→onMoved→render loop when pinned tabs sat before a group).

  const enforceTabOrder = async (focusedWindowId) => {
    // Skip if the user is dragging, or a previous enforcement is still running
    // (overlapping runs would let one run's finally{} clear the storage flag
    // while another is mid-move, re-triggering the background render loop).
    if (isDragging || isEnforcingOrderInFlight) {
      return;
    }

    // Resolve the target window if not passed in (e.g. when called outside render).
    if (focusedWindowId == null) focusedWindowId = await resolveTargetWindowId();

    // Read-only pre-check. If nothing needs moving (the common case on
    // metadata/search/filter renders) we return WITHOUT writing the storage
    // flag — previously every render did two storage writes regardless.
    const allTabs = await chrome.tabs.query({ windowId: focusedWindowId });
    const dashboardTab = allTabs.find(t => t.url === chrome.runtime.getURL("fullpage.html"));
    // Only try to pin the dashboard to index 0 if it can actually GET there: an
    // unpinned dashboard can't precede the user's pinned tabs (Chrome clamps it),
    // which would leave index !== 0 forever and loop. Pinned dashboard → fine.
    const otherPinnedExist = allTabs.some(t => t.pinned && (!dashboardTab || t.id !== dashboardTab.id));
    const dashboardNeedsMove = dashboardTab && dashboardTab.index !== 0 &&
      (dashboardTab.pinned || !otherPinnedExist);
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
        tabs = await chrome.tabs.query({ windowId: focusedWindowId }); // indices changed
      }

      // 2. Move all ungrouped tabs to the end — in ONE batched move (passing the
      // id array) rather than one call per tab. With many ungrouped tabs the
      // per-tab loop fired a storm of onMoved events and was slow; a single move
      // is faster and shrinks the window where a late onMoved could re-trigger.
      const { ungrouped, needsReordering: stillNeeds } = computeUngrouped(tabs, dashboardTab);
      if (stillNeeds && ungrouped.length) {
        try {
          await chrome.tabs.move(ungrouped.map(t => t.id), { index: -1 });
        } catch (moveError) {
          // Ignore errors when tabs are being dragged by the user
          if (!moveError.message || !moveError.message.includes("cannot be edited right now")) {
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
    // Top-right version label → GitHub release notes for the running version.
    // Built from the manifest version so it auto-tracks every future release with
    // no per-version edit. Guarded (optional chaining + try/catch) so the jsdom
    // smoke harness — whose chrome.runtime mock has no getManifest — is unaffected.
    try {
      const versionLink = document.getElementById('app-version-link');
      const version = chrome.runtime.getManifest?.().version;
      if (versionLink && version) {
        versionLink.textContent = `v ${version}`;
        versionLink.href = `https://github.com/smokinghandbag/tabkan/releases/tag/v${version}`;
      }
    } catch { /* version link is non-essential; ignore */ }

    const data = await chrome.storage.sync.get(["tabMetadata", "sidebarCollapsed", "sleepingTabs", "collapsedCards", "settings"]);
    state.tabMetadata = data.tabMetadata || {};
    state.sidebarCollapsed = data.sidebarCollapsed || false;
    state.sleepingTabs = data.sleepingTabs || [];
    state.collapsedCards = data.collapsedCards || {};

    // Migrate settings for existing users (add default settings if not present)
    state.settings = data.settings || { autoCollapseGroups: false, theme: 'dark' };
    if (!state.settings.theme) state.settings.theme = 'dark'; // pre-theme users default to dark
    if (!data.settings) {
      // First time with settings, save defaults
      await chrome.storage.sync.set({ settings: state.settings });
    }
    // Apply the saved theme (keeps storage.sync the source of truth + refreshes
    // the localStorage mirror that theme-init.js reads pre-paint).
    applyTheme(state.settings.theme);

    // Load bookmark folder ID from local storage
    const localData = await chrome.storage.local.get(["bookmarkFolderId"]);
    state.bookmarkFolderId = localData.bookmarkFolderId || null;

    if (state.sidebarCollapsed) {
      sidebar.classList.add("collapsed");
      // Set initial icon state
      const toggleIcon = sidebarToggle.querySelector("i");
      toggleIcon.className = "ph ph-caret-right";
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

  init();
