// Task roll-up: aggregates to-dos across all tabs and renders the sidebar card.
import { state, ui } from './state.js';
import { escapeHtml, getFaviconUrl } from './utils.js';
import { taskRollupContainer } from './dom.js';
import { saveData, openEditDialog } from './app.js';

export const hasUnfinishedTasks = (tabUrl) => {
    const metadata = state.tabMetadata[tabUrl] || {};
    const todos = metadata.todos || [];
    return todos.some(todo => !todo.completed);
  };

  // Helper function to get unfinished tasks for a tab
export const getUnfinishedTasks = (tabUrl) => {
    const metadata = state.tabMetadata[tabUrl] || {};
    const todos = metadata.todos || [];
    return todos.filter(todo => !todo.completed);
  };

  // Aggregate all tasks from all tabs
export const aggregateAllTasks = async (allTabs = null) => {
    const allTasks = [];

    // Reuse the caller's tab list if provided (render() already queried it),
    // otherwise fetch. Avoids a redundant chrome.tabs.query per render.
    if (!allTabs) {
      allTabs = await chrome.tabs.query({});
    }

    // Collect tasks from active tabs
    allTabs.forEach(tab => {
      const metadata = state.tabMetadata[tab.url] || {};
      const todos = metadata.todos || [];

      todos.forEach((todo, index) => {
        allTasks.push({
          text: todo.text,
          completed: todo.completed,
          tabUrl: tab.url,
          tabTitle: metadata.title || tab.title,
          tabFavicon: tab.favIconUrl,
          tabId: tab.id,
          groupId: tab.groupId,
          todoIndex: index,
          source: 'active'
        });
      });
    });

    // Collect tasks from sleeping tabs
    return allTasks;
  };

  // Render Collapsed Task Roll-Up Summary
export const renderCollapsedTaskRollup = async (allTasks = null) => {
    // Use cached tasks if provided, otherwise fetch
    if (!allTasks) {
      allTasks = await aggregateAllTasks();
    }
    const totalTasks = allTasks.length;
    const completedTasks = allTasks.filter(t => t.completed).length;
    const incompleteTasks = totalTasks - completedTasks;

    const collapsedTaskRollup = document.getElementById('collapsed-task-rollup');
    if (!collapsedTaskRollup) return;

    if (totalTasks === 0) {
      collapsedTaskRollup.innerHTML = '';
      return;
    }

    const hasIncomplete = incompleteTasks > 0;
    collapsedTaskRollup.innerHTML = `
      <div class="collapsed-task-icon">
        <i class="fas fa-tasks"></i>
      </div>
      <div class="collapsed-task-stats ${hasIncomplete ? 'has-incomplete' : ''}">
        ${completedTasks}/${totalTasks}
      </div>
    `;

    // Click handler to expand sidebar and show task rollup
    collapsedTaskRollup.onclick = () => {
      state.sidebarCollapsed = false;
      saveData(false);
      render();
      // Scroll to task rollup
      setTimeout(() => {
        const taskRollupContainer = document.getElementById('task-rollup-container');
        if (taskRollupContainer) {
          taskRollupContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 300);
    };
  };

  // Render Task Roll-Up Card
export const renderTaskRollup = async (allTasks = null) => {
    // Use cached tasks if provided, otherwise fetch
    if (!allTasks) {
      allTasks = await aggregateAllTasks();
    }

    // Check if card is collapsed
    const isCardCollapsed = state.collapsedCards['task-rollup-card'] || false;

    // Filter tasks based on current filter
    const filteredTasks = allTasks.filter(task => {
      if (ui.taskRollupFilter === 'incomplete') return !task.completed;
      if (ui.taskRollupFilter === 'completed') return task.completed;
      return true; // 'all'
    });

    // Calculate statistics
    const totalTasks = allTasks.length;
    const incompleteTasks = allTasks.filter(t => !t.completed).length;
    const completedTasks = allTasks.filter(t => t.completed).length;

    taskRollupContainer.innerHTML = `
      <div class="task-rollup-card ${isCardCollapsed ? 'collapsed' : ''}">
        <div class="task-rollup-header" data-card-id="task-rollup-card">
          <i class="fas fa-chevron-${isCardCollapsed ? 'right' : 'down'} task-rollup-toggle"></i>
          <div class="task-rollup-title">
            <span>All Tasks</span>
          </div>
          <div class="task-rollup-stats">
            ${completedTasks}/${totalTasks}
          </div>
        </div>
        <div class="task-rollup-content">
          <div class="task-rollup-filters">
            <button class="task-rollup-filter-btn ${ui.taskRollupFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
            <button class="task-rollup-filter-btn ${ui.taskRollupFilter === 'incomplete' ? 'active' : ''}" data-filter="incomplete">Incomplete</button>
            <button class="task-rollup-filter-btn ${ui.taskRollupFilter === 'completed' ? 'active' : ''}" data-filter="completed">Completed</button>
          </div>
          <ul class="task-rollup-list">
            ${filteredTasks.length > 0 ? filteredTasks.map((task, idx) => `
              <li class="task-rollup-item ${task.completed ? 'completed' : ''}" data-task-index="${idx}" data-tab-url="${escapeHtml(task.tabUrl)}" data-tab-id="${task.tabId}" data-todo-index="${task.todoIndex}" data-source="${escapeHtml(task.source)}">
                <input type="checkbox" class="task-rollup-checkbox" ${task.completed ? 'checked' : ''}>
                <div class="task-rollup-content-inner">
                  <div class="task-rollup-text">${escapeHtml(task.text)}</div>
                  <div class="task-rollup-source">
                    ${task.tabFavicon ? `<img src="${getFaviconUrl(task.tabUrl)}" alt="">` : '<i class="fas fa-file"></i>'}
                    <span>${escapeHtml(task.tabTitle)}</span>
                  </div>
                </div>
              </li>
            `).join('') : '<div class="task-rollup-empty">No tasks to display</div>'}
          </ul>
        </div>
      </div>
    `;

    // Toggle entire card collapse/expand
    const cardHeader = taskRollupContainer.querySelector('.task-rollup-header');
    const cardToggle = cardHeader.querySelector('.task-rollup-toggle');
    cardHeader.addEventListener('click', (e) => {
      // Don't toggle if clicking on stats area
      if (e.target.closest('.task-rollup-stats')) return;

      const card = taskRollupContainer.querySelector('.task-rollup-card');
      card.classList.toggle('collapsed');
      const isCollapsed = card.classList.contains('collapsed');
      state.collapsedCards['task-rollup-card'] = isCollapsed;
      cardToggle.className = `fas fa-chevron-${isCollapsed ? 'right' : 'down'} task-rollup-toggle`;
      saveData(false);
    });

    // Add event listeners for filter buttons
    taskRollupContainer.querySelectorAll('.task-rollup-filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        ui.taskRollupFilter = btn.dataset.filter;
        renderTaskRollup();
      });
    });

    // Add event listeners for task items (checkbox and navigation)
    taskRollupContainer.querySelectorAll('.task-rollup-item').forEach(item => {
      const checkbox = item.querySelector('.task-rollup-checkbox');
      const tabUrl = item.dataset.tabUrl;
      const tabId = item.dataset.tabId;
      const todoIndex = parseInt(item.dataset.todoIndex);
      const source = item.dataset.source;

      // Toggle task completion
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        // Use the checkbox's resulting checked state rather than toggling the model,
        // so the DOM and stored state can never diverge.
        const isChecked = e.target.checked;

        if (source === 'active') {
          const metadata = state.tabMetadata[tabUrl];
          if (metadata && metadata.todos && metadata.todos[todoIndex]) {
            metadata.todos[todoIndex].completed = isChecked;
            saveData();
          }
        } else if (source === 'sleeping') {
          const sleepingTab = state.sleepingTabs.find(st => st.url === tabUrl);
          if (sleepingTab && sleepingTab.metadata && sleepingTab.metadata.todos && sleepingTab.metadata.todos[todoIndex]) {
            sleepingTab.metadata.todos[todoIndex].completed = isChecked;
            saveData();
          }
        }
      });

      // Open edit dialog on click (except checkbox)
      item.addEventListener('click', async (e) => {
        if (e.target.type === 'checkbox') return;

        if (source === 'active' && tabId) {
          try {
            const tab = await chrome.tabs.get(parseInt(tabId));
            openEditDialog(tab, (newTitle, newTags, newNotes, newTodos) => {
              state.tabMetadata[tab.url] = { title: newTitle, tags: newTags, notes: newNotes, todos: newTodos };
              saveData();
            });
          } catch (error) {
            console.error('Error opening edit dialog:', error);
          }
        }
      });
    });
  };
