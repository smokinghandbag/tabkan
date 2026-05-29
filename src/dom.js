// Cached DOM references and dialog element groups for the dashboard.
// Evaluated at module load; the dashboard HTML is fully parsed before this
// module runs (module scripts are deferred).

export const cardsContainer = document.getElementById("cards-container");
export const unfiledTabsContainer = document.getElementById("centro-card-container");
export const sidebarScrollWrapper = document.querySelector(".sidebar-scroll-wrapper");
export const dialogOverlay = document.getElementById("dialog-overlay");
export const renameDialog = {
    element: document.getElementById("rename-dialog"),
    title: document.querySelector("#rename-dialog .dialog-title"),
    input: document.getElementById("rename-input"),
    tagsInput: document.getElementById("tags-input"),
    notesInput: document.getElementById("notes-input"),
    todoListContainer: document.getElementById("todo-list-container"),
    addTodoInput: document.getElementById("add-todo-input"),
    tagSuggestions: document.getElementById("tag-suggestions"),
    tagChipsContainer: document.getElementById("tag-chips-container"),
    confirm: document.getElementById("rename-confirm"),
  };
export const deleteDialog = {
    element: document.getElementById("delete-dialog"),
    title: document.querySelector("#delete-dialog .dialog-title"),
    description: document.querySelector("#delete-dialog .dialog-description"),
    cancel: document.getElementById("delete-cancel"),
    confirm: document.getElementById("delete-confirm"),
  };
export const warningDialog = {
    element: document.getElementById("warning-dialog"),
    ok: document.getElementById("warning-ok"),
  };
export const taskWarningDialog = {
    element: document.getElementById("task-warning-dialog"),
    list: document.getElementById("task-warning-list"),
    cancel: document.getElementById("task-warning-cancel"),
    complete: document.getElementById("task-warning-complete"),
    closeAnyway: document.getElementById("task-warning-close-anyway"),
  };
export const createCardDialog = {
    element: document.getElementById("create-card-dialog"),
    input: document.getElementById("new-card-name"),
    confirm: document.getElementById("create-card-confirm"),
  };
export const editNoteDialog = {
    element: document.getElementById("edit-note-dialog"),
    contentInput: document.getElementById("note-content-input"),
    tagsInput: document.getElementById("note-tags-input"),
    tagSuggestions: document.getElementById("note-tag-suggestions"),
    tagChipsContainer: document.getElementById("note-tag-chips-container"),
    cancel: document.getElementById("edit-note-cancel"),
    confirm: document.getElementById("edit-note-confirm"),
  };
export const settingsDialog = {
    element: document.getElementById("settings-dialog"),
    autoCollapseCheckbox: document.getElementById("auto-collapse-groups"),
  };
export const sessionsDialog = {
    element: document.getElementById("sessions-dialog"),
    list: document.getElementById("sessions-list"),
  };
export const saveSessionDialog = {
    element: document.getElementById("save-session-dialog"),
    nameInput: document.getElementById("session-name-input"),
    descriptionInput: document.getElementById("session-description-input"),
    cancel: document.getElementById("save-session-cancel"),
    confirm: document.getElementById("save-session-confirm"),
  };
export const loadSessionDialog = {
    element: document.getElementById("load-session-dialog"),
    cancel: document.getElementById("load-session-cancel"),
    confirm: document.getElementById("load-session-confirm"),
  };
export const tagManagerDialog = {
    element: document.getElementById("tag-manager-dialog"),
    list: document.getElementById("tag-manager-list"),
    input: document.getElementById("tag-manager-input"),
  };
export const searchInput = document.getElementById("search-input");
export const sidebar = document.querySelector(".sidebar");
export const sidebarToggle = document.getElementById("sidebar-toggle");
export const sidebarCollapseBtn = document.getElementById("sidebar-collapse-btn");
export const collapsedFavicons = document.getElementById("collapsed-favicons");
export const tabBin = document.getElementById("tab-bin");
export const tabBinCollapsed = document.getElementById("tab-bin-collapsed");
export const bookmarksCardContainer = document.getElementById("bookmarks-card-container");
export const taskRollupContainer = document.getElementById("task-rollup-container");
