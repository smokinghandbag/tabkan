# Software Design Document: Tab Ban

## 1. Introduction

### 1.1. Purpose
The purpose of this document is to provide a detailed design for a Chrome extension that provides a Kanban-style interface for managing open browser tabs and tab groups. The extension will allow users to organize, view, and interact with their tabs in a more visual and structured way.

### 1.2. Scope
The extension will be developed for the Google Chrome browser. Its primary functions will be to:
- Automatically detect and display all open tab groups as Kanban-style cards.
- List all tabs within their respective groups.
- Provide a dedicated sidebar for tabs that are not part of any group.
- Allow users to manage tabs (open, close, move between groups) and tab groups (create, rename, delete) directly from the dashboard.
- Store user-added metadata for tabs (tags, notes, to-do lists) using `chrome.storage`.

### 1.3. Target Audience
The target audience is any Chrome user who frequently works with many tabs and tab groups and desires a more powerful and intuitive way to organize their browsing session.

## 2. System Architecture

The extension will be composed of the following components:

- **`manifest.json`**: The core configuration file that defines the extension's permissions (`tabs`, `storage`, `tabGroups`), background scripts, and action handlers.
- **`background.js`**: A background script that listens for tab and tab group updates to keep the dashboard view in sync.
- **`fullpage.html`**: The HTML file for the main dashboard interface.
- **`fullpage.js`**: The JavaScript file that implements the logic for the dashboard UI.
- **`styles.css`**: The CSS file for styling the dashboard UI.
- **`icons/`**: A directory for extension icons.

## 3. Features

### 3.1. Tab Group Kanban Board
The core feature of the extension is a Kanban board where each user-created tab group is represented as a card (a column). The tabs within that group are listed as items in the card.

### 3.2. Unfiled Tabs Sidebar
A fixed sidebar on the left of the interface will display all open tabs that do not belong to a tab group, providing a clear overview of unorganized tabs.

### 3.3. Tab and Group Management
- **Drag-and-Drop**: Users can drag and drop tabs between groups, into a new group, or out of a group into the "Unfiled" sidebar.
- **Group Creation**: Users can create new tab groups directly from the dashboard.
- **Rename/Delete**: Users can rename or delete tab groups.
- **Tab Interaction**: Clicking a tab in the dashboard will focus the corresponding tab in the browser.

### 3.4. Data Persistence
- The extension uses `chrome.storage.local` to persist the UI state (such as scroll position) and any user-created content (like standalone notes).
- The state is saved automatically and reliably when changes are made.

### 3.5. Search and Filtering
- **Search**: A universal search bar allows users to filter all visible tabs and notes in real-time based on their title or content.

### 3.6. Standalone Kanban Notes
- In addition to managing tabs, users can create standalone notes directly within any Kanban card (including the "Unfiled" sidebar).
- These notes behave like other items on the card: they can be dragged and dropped between groups and are persistent.
- Notes are stored in `chrome.storage.local` and are not tied to any specific tab or URL.
- The content of notes will be searchable via the main search bar.

### 3.7. "Open Dashboard" Action
- Clicking the extension's icon in the Chrome toolbar will always open the full-page dashboard, providing one-click access to the tab management interface.

### 3.8. Tab Sleep/Wake Feature
- **Purpose**: Allow users to "sleep" tabs to free up system resources while preserving their place in the workflow.
- **Sleep Mechanism**: When a tab is put to sleep, it is converted to a bookmark and the active tab is closed, reducing Chrome's memory and CPU usage.
- **Visual Indication**: Sleeping tabs are displayed with a distinct visual style (dimmed/faded appearance with a "sleeping" icon) to differentiate them from active tabs.
- **Metadata Preservation**: All user-added metadata (tags, notes, to-dos) is preserved when a tab is slept.
- **Wake Mechanism**: Clicking on a sleeping tab will restore it by opening the bookmarked URL in a new tab within the same group and position, then deleting the temporary bookmark.
- **Bookmark Storage**: Sleeping tabs are stored in a dedicated bookmark folder (e.g., "Tab Ban - Sleeping Tabs") to keep them organized and separate from the user's regular bookmarks.
- **Group Association**: The bookmark metadata includes the original tab group ID, allowing the tab to be restored to the correct group.
- **Search Integration**: Sleeping tabs remain searchable via the universal search bar.

## 4. User Interface (UI) and User Experience (UX)

### 4.1. Main Layout
The UI is a full-page dashboard with a two-column layout:
1.  **Fixed Sidebar (320px):** The left sidebar is always visible. It contains the extension's branding and the list of currently open, ungrouped tabs. This list is vertically scrollable.
2.  **Main Content Area:** The right area contains the main Kanban board. It has a filter and search bar at the top, and a horizontally scrollable grid of cards, where each card represents a tab group.

### 4.2. Card (Tab Group) Creation
New cards/groups are created by clicking a `+ New Group` text link at the end of the horizontal card grid, which opens a dialog for the user to name the new group.

### 4.3. Drag-to-Scroll
The main card grid can be scrolled horizontally by clicking and dragging the mouse, improving usability for users without trackpads.

### 4.4. Visual Cues
- **Favicons:** Each tab item will display the favicon of its corresponding website to allow for quick identification.
- **Empty State:** The sidebar and tab group cards will provide clear, centered messages when they contain no tabs.

### 4.5. Note Creation
- Each card header will contain an "Add Note" button (`+` icon).
- Clicking this button will create a new, editable note item at the top of that card's list.

## 5. Data Model

The extension will primarily rely on the Chrome Tabs and Tab Groups API for its state. The data stored in `chrome.storage.local` will be for persistent UI state and user-created notes, structured within a single `kanbanState` object.

```json
{
  "kanbanState": {
    "sidebarCollapsed": false,
    "scrollLeft": 0,
    "kanbanNotes": [
      {
        "id": 1663882800000,
        "content": "This is a standalone note about this project.",
        "groupId": 12345
      },
      {
        "id": 1663882801000,
        "content": "Another note for the unfiled section.",
        "groupId": "unfiled"
      }
    ],
    "archivedGroups": [],
    "sleepingTabs": [
      {
        "url": "https://example.com/article",
        "title": "Example Article",
        "bookmarkId": "12345",
        "groupId": 12345,
        "position": 2,
        "favicon": "https://example.com/favicon.ico",
        "sleptAt": 1663882800000
      }
    ]
  }
}
```

## 6. Technical Stack

- **HTML5**
- **CSS3**
- **JavaScript (ES6+)**
- **Chrome Extension APIs** (`tabs`, `storage`, `tabGroups`, `contextMenus`, `bookmarks`)
- **Font Awesome** (for icons)
- **Montserrat Font** (for typography)

## 7. UI/UX Enhancements

### 7.1. Visual Design
- **Clean Aesthetic**: A modern, dark-themed interface with consistent styling.
- **Drag & Drop**: Clear visual feedback during drag-and-drop operations.
- **Inline Editing**: Tab group names can be edited directly inline.

### 7.2. Full Page View
- Kanban-style horizontal scrolling layout for tab groups.
- Better use of screen real estate for managing a large number of tabs and groups.

## 8. Feature Roadmap

The following features are planned for future releases:

### 8.1. Tab Sleep/Wake Implementation (v2.1)
**Status:** ✅ COMPLETED - 2025-09-30
**Priority:** High
**Objective:** Implement the tab sleep/wake feature to allow users to temporarily close tabs while preserving their metadata and position.

**Implementation Plan:**

#### Phase 1: Setup & Prerequisites
1. **Update Manifest**
   - Add `"bookmarks"` permission to `manifest.json`
   - Verify existing permissions are sufficient

2. **Initialize Bookmark Folder**
   - Create a dedicated bookmark folder on extension install/first run
   - Store folder ID in `chrome.storage.local` for quick access
   - Handle case where folder already exists

#### Phase 2: Data Model & State Management
3. **Extend State Object**
   - Add `sleepingTabs` array to the state object in `fullpage.js`
   - Define sleeping tab structure: `{ url, title, bookmarkId, groupId, position, favicon, sleptAt, metadata }`
   - Add `bookmarkFolderId` to state for tracking the sleeping tabs folder

4. **Create Sleep/Wake Functions**
   - `sleepTab(tabId)`: Close tab, create bookmark, store in state
   - `wakeTab(sleepingTabData)`: Open bookmark as new tab, restore to correct group/position, delete bookmark
   - `getSleepingTabData(tabId)`: Helper to retrieve all tab metadata before sleeping

#### Phase 3: UI Changes
5. **Add Sleep Button to Tab Items**
   - Add sleep icon button (🌙 or similar) to `.link-actions` in tab items
   - Position it next to existing action buttons
   - Add tooltip: "Sleep tab (frees memory)"

6. **Create Sleeping Tab Visual Style**
   - Add CSS class `.tab-item-sleeping` with dimmed/faded appearance
   - Use different background color (darker/muted)
   - Add sleeping icon indicator
   - Reduce opacity of favicon and text

7. **Update Tab Rendering Logic**
   - Modify `createTabElement()` to check if tab is sleeping
   - Render sleeping tabs with appropriate styling
   - Show wake action instead of sleep action for sleeping tabs
   - Display "sleeping" badge or timestamp

#### Phase 4: Core Functionality
8. **Implement Sleep Function**
   - Capture all tab data (URL, title, favicon, group, position, metadata)
   - Create bookmark in dedicated folder
   - Store sleeping tab data in `chrome.storage.local`
   - Close the actual browser tab
   - Trigger re-render to show sleeping state

9. **Implement Wake Function**
   - Retrieve sleeping tab data from storage
   - Create new tab with stored URL
   - Move tab to correct group and position
   - Restore any metadata (tags, notes, todos)
   - Delete bookmark
   - Remove from sleeping tabs array
   - Trigger re-render

10. **Handle Edge Cases**
    - Tab already closed when sleep is clicked
    - Bookmark folder deleted by user
    - Tab metadata preservation across sleep/wake cycles
    - Multiple tabs sleeping/waking simultaneously
    - Group no longer exists when waking tab

#### Phase 5: Integration & Polish
11. **Search Integration**
    - Ensure sleeping tabs appear in search results
    - Display sleeping indicator in search matches

12. **Drag & Drop Support**
    - Allow sleeping tabs to be dragged between groups
    - Update groupId in sleeping tab data
    - Maintain sleeping state during moves

13. **Context Menu (Optional Enhancement)**
    - Add "Sleep Tab" option to browser's tab context menu
    - Allow bulk sleep operation on multiple tabs

14. **Statistics & Feedback (Optional Enhancement)**
    - Show count of sleeping tabs per group
    - Display memory saved (approximate)
    - Add "Wake All" button for groups

#### Phase 6: Testing & Refinement
15. **Test Scenarios**
    - Sleep/wake single tab
    - Sleep multiple tabs in different groups
    - Sleep unfiled tabs
    - Wake tabs after browser restart
    - Search for sleeping tabs
    - Drag sleeping tabs between groups
    - Archive group with sleeping tabs
    - Handle corrupted sleeping tab data

16. **Performance Optimization**
    - Ensure sleeping tabs don't cause UI lag
    - Optimize bookmark operations
    - Test with many sleeping tabs (50+)

**Technical Considerations:**
- Bookmark titles should include metadata to aid recovery if state is lost
- Consider adding a "last slept" timestamp for user reference
- Implement cleanup routine for orphaned bookmarks (bookmarks without state entry)
- Consider sync vs local storage for sleeping tab data (local is better for privacy)

### 8.2. Collapsible Tab Group Cards (v2.3)
**Status:** ✅ COMPLETED - 2025-10-01
**Priority:** Medium
**Objective:** Allow users to collapse tab group cards to save horizontal canvas space and improve organization when managing many groups.

**Implementation Plan:**

#### Phase 1: UI Design & State Management
1. **Add Collapse Button to Card Headers**
   - Add collapse/expand icon button to card header (chevron or minus/plus icon)
   - Position next to existing card action buttons (arrows, archive, delete)
   - Icon should toggle between collapsed and expanded states

2. **Extend State Object**
   - Add `collapsedCards` array/object to state: `{ groupId: boolean }`
   - Store collapsed state in `chrome.storage.sync` for persistence
   - Load collapsed state on render

#### Phase 2: Collapsed Card Visual Design
3. **Create Collapsed Card CSS**
   - Add `.card-collapsed` class with reduced width (e.g., 80-120px)
   - Vertically orient group title (CSS `writing-mode: vertical-rl`)
   - Hide tab list container when collapsed
   - Show tab count badge on collapsed card
   - Maintain hover effects for visual feedback

4. **Update Card Rendering Logic**
   - Modify `render()` to check collapsed state for each card
   - Apply collapsed styling and hide tab list if collapsed
   - Show tab count and any summary info (e.g., "3 tabs, 2 sleeping")

#### Phase 3: Interaction & Animation
5. **Implement Collapse/Expand Toggle**
   - Add event listener to collapse button
   - Toggle collapsed state in storage
   - Animate width transition (CSS transition on card width)
   - Preserve scroll position during collapse/expand

6. **Drag & Drop Support**
   - Allow tabs to be dropped on collapsed cards
   - Show visual feedback when hovering over collapsed card during drag
   - Auto-expand card temporarily when tab is hovering (optional enhancement)

#### Phase 4: Polish & Edge Cases
7. **Handle Edge Cases**
   - Collapsed cards should still be reorderable with arrow buttons
   - Search results should auto-expand relevant collapsed cards
   - New cards should start in expanded state by default
   - Keyboard shortcuts for collapse/expand (optional)

**Technical Considerations:**
- Use CSS transitions for smooth collapse/expand animation
- Consider showing a tooltip with group info on hover over collapsed cards
- Collapsed state should persist across browser sessions
- Consider "Collapse All" / "Expand All" buttons in the main toolbar

### 8.3. Task-Protected Tab Deletion (v2.4)
**Status:** ✅ COMPLETED - 2025-10-01
**Priority:** High
**Objective:** Prevent accidental deletion of tabs that have unfinished tasks, ensuring users don't lose important to-do items.

**Implementation Plan:**

#### Phase 1: Task Detection
1. **Add Task Completion Tracking**
   - Extend tab metadata structure to include task completion status
   - Parse todos array to check if any tasks are incomplete
   - Task structure should include `{ text: string, completed: boolean }`

2. **Create Task Validation Function**
   - Add `hasUnfinishedTasks(tabUrl)` helper function
   - Check metadata for todos with `completed: false`
   - Return boolean indicating if tab has incomplete tasks

#### Phase 2: Deletion Prevention
3. **Modify Tab Close/Delete Logic**
   - Intercept tab close attempts in `closeTab()` function
   - Check for unfinished tasks before allowing closure
   - Show warning dialog if tasks are incomplete

4. **Create Task Warning Dialog**
   - Add new dialog to `fullpage.html`: `#task-warning-dialog`
   - Show list of unfinished tasks in dialog
   - Provide three options:
     - "Cancel" - Don't close the tab
     - "Mark All Complete" - Complete all tasks and close
     - "Close Anyway" - Override protection and close

#### Phase 3: Visual Indicators
5. **Add Task Status Indicators**
   - Show task count badge on tabs with tasks (e.g., "3 tasks")
   - Use color coding: orange/yellow for incomplete, green for all complete
   - Add icon indicator (checkbox) to tabs with tasks

6. **Update Sleep Function**
   - Apply same protection to sleeping tabs
   - Warn users about unfinished tasks when sleeping
   - Allow sleeping but preserve task data and visual indicator

#### Phase 4: User Settings & Overrides
7. **Add Settings Toggle**
   - Create settings area for task protection preference
   - Allow users to disable task protection if desired
   - Default to enabled for safety

**Technical Considerations:**
- Protection should apply to both manual tab closure and programmatic closure
- Consider showing task count in collapsed card view
- Sleeping tabs with tasks should maintain visual indicator
- Consider browser-level tab close protection (beforeunload event - not possible in MV3)

### 8.4. Task Roll-Up Card (v2.5)
**Status:** ✅ COMPLETED - 2025-10-01
**Priority:** Medium
**Objective:** Provide a unified view of all tasks across all tabs in a dedicated sidebar card, giving users a central task management dashboard.

**Implementation Plan:**

#### Phase 1: UI Design & Layout
1. **Create Task Roll-Up Card**
   - Add new card to sidebar below "Unfiled Tabs" card
   - Title: "All Tasks" or "Task Summary"
   - Fixed position in sidebar, always visible
   - Collapsible/expandable like other cards (optional)

2. **Design Task List View**
   - Show all tasks from all tabs in a single list
   - Group tasks by tab group or show flat list
   - Each task item should include:
     - Task text
     - Completion checkbox
     - Source tab title/favicon
     - Link to jump to source tab

#### Phase 2: Data Aggregation
3. **Create Task Aggregation Function**
   - Add `aggregateAllTasks()` function to scan all tab metadata
   - Collect all todos from `state.tabMetadata`
   - Return structured array: `{ task, completed, tabUrl, tabTitle, groupId }`

4. **Real-Time Updates**
   - Update task roll-up whenever tasks are modified
   - Listen for task completion/addition events
   - Re-aggregate and re-render on changes

#### Phase 3: Task Interaction
5. **Implement Task Completion Toggle**
   - Add click handler to checkboxes in roll-up
   - Update source tab metadata when task is toggled
   - Visual strikethrough for completed tasks
   - Save changes to storage immediately

6. **Add Task Navigation**
   - Click on task item to jump to source tab
   - Highlight/scroll to task in source tab (optional)
   - Show group color indicator for context

#### Phase 4: Filtering & Organization
7. **Add Task Filters**
   - Toggle between "All", "Incomplete", "Completed"
   - Filter by tab group (show group selector)
   - Sort options: by group, by date, alphabetically

8. **Show Task Statistics**
   - Display task summary in card header
   - Example: "12 tasks (8 incomplete, 4 complete)"
   - Progress bar showing completion percentage (optional)

#### Phase 5: Advanced Features (Optional)
9. **Task Prioritization**
   - Allow starring/prioritizing tasks
   - Show priority tasks at top of roll-up
   - Add due dates to tasks (future enhancement)

10. **Bulk Actions**
    - "Mark All Complete" button
    - "Clear Completed Tasks" button
    - Delete tasks directly from roll-up

**Technical Considerations:**
- Task roll-up should update in real-time as tasks change
- Consider performance with many tasks (100+)
- Roll-up card should not be draggable or movable from sidebar
- Search should include tasks from roll-up card
- Consider exporting tasks to external format (CSV, JSON)

### 8.6. Auto-Scroll on Drag (v2.7)
**Status:** ✅ COMPLETED - 2025-10-02
**Priority:** High
**Objective:** Enable automatic horizontal scrolling of the card canvas when users drag tabs near the screen edges, and automatic vertical scrolling within cards when dragging tabs in long lists, allowing seamless navigation without manual scrolling.

**Implementation Summary:**
- **Horizontal Auto-Scroll:** Automatically scrolls the main card container left/right when dragging tabs within 120px of screen edges
- **Vertical Auto-Scroll:** Automatically scrolls individual card lists up/down when dragging tabs within 80px of card top/bottom edges
- **Variable Speed:** Scroll speed increases based on proximity to edges (closer = faster)
- **Performance Optimized:** Uses `requestAnimationFrame` for smooth 60fps scrolling
- **Smart Boundaries:** Automatically stops at scroll limits

**Implementation Plan:**

#### Phase 1: Edge Detection
1. **Add Drag Position Tracking**
   - Monitor mouse position during tab drag operations
   - Define edge zones (120px from left/right edges of viewport)
   - Calculate distance from edges in real-time

2. **Create Edge Detection Function**
   - `isInScrollZone(mouseX, containerRect)` - Returns 'left', 'right', or null
   - Use `cardsContainer.getBoundingClientRect()` for accurate positioning
   - Account for sidebar width in left edge calculation

#### Phase 2: Auto-Scroll Implementation
3. **Implement Smooth Scrolling**
   - Use `requestAnimationFrame` for smooth 60fps scrolling
   - Variable scroll speed based on proximity to edge (closer = faster)
   - Scroll speed range: 5-15px per frame
   - Stop scrolling when reaching container edges

4. **Add Visual Feedback**
   - Optional: Add subtle visual indicator when in scroll zone
   - Semi-transparent overlay on left/right edges
   - Fade in/out based on proximity

#### Phase 3: Integration with Drag Events
5. **Hook into Existing Drag System**
   - Attach to `dragover` event on `cardsContainer`
   - Start scroll loop when entering edge zone
   - Cancel scroll loop when leaving zone or dropping item
   - Ensure compatibility with existing drag-and-drop logic

6. **Handle Edge Cases**
   - Stop auto-scroll when already at container boundary
   - Pause auto-scroll when dialog is open
   - Work with both tab and note dragging
   - Prevent conflicts with drag-to-scroll feature

**Technical Considerations:**
- Use `requestAnimationFrame` for performance (avoid setInterval)
- Clean up animation frames on drag end to prevent memory leaks
- Test with various container widths and screen sizes
- Ensure smooth experience on both trackpad and mouse
- Edge zone should feel natural (120px is a good starting point)

**User Experience:**
- Scroll should feel responsive but not jarring
- Speed should increase as user moves closer to edge
- Should work seamlessly with existing drag-and-drop
- Visual feedback (if implemented) should be subtle

### 8.7. Session Management (v3.0)
**Status:** ✅ COMPLETED - 2025-10-02
**Priority:** High
**Objective:** Allow users to save and restore complete workspace states, enabling easy context switching between different projects or workflows.

**Implementation Summary:**
- **Save Sessions:** Capture complete workspace including all groups, tabs, sleeping tabs, notes, tasks, and metadata
- **Load Sessions:** Restore saved sessions with options to replace current tabs or open in new window
- **Session Library:** Beautiful UI showing all saved sessions with stats (groups, tabs, notes count)
- **Export/Import:** Download sessions as JSON files for backup or sharing
- **Delete Sessions:** Remove unwanted sessions with confirmation
- **Metadata Tracking:** Stores creation date, last used date, and comprehensive stats
- **Smart Restoration:** Maps old group IDs to new ones, preserves tab order and grouping

### 8.8. Cross-Device Sync (v3.1)
**Status:** ✅ COMPLETED - 2025-10-02
**Priority:** High
**Objective:** Automatically synchronize tabs, notes, tasks, and settings across all devices where the user is signed into Chrome.

**Implementation Summary:**
- **Chrome Storage Sync:** Uses `chrome.storage.sync` API for automatic cloud synchronization
- **Synced Data:** Tab metadata (tags, notes, tasks), kanban notes, sleeping tabs, collapsed card states, and user settings
- **Real-time Updates:** Changes automatically propagate to all devices within seconds
- **Seamless Experience:** No user configuration required - works automatically when signed into Chrome
- **Storage Management:** Efficiently uses Chrome's sync storage quota (100KB limit)
- **Conflict Resolution:** Chrome's sync API handles conflicts using last-write-wins strategy
- **Offline Support:** Data syncs automatically when devices come back online

**Technical Implementation:**
- All user data stored in `chrome.storage.sync` instead of local storage
- Initial load fetches synced data: `tabMetadata`, `kanbanNotes`, `sleepingTabs`, `collapsedCards`, `settings`
- Writes to sync storage trigger automatic propagation across devices
- Session data stored in `chrome.storage.local` (too large for sync, use export/import instead)
- Bookmark folder IDs remain local as they may differ across devices

### 8.9. Persistent Sidebar (v3.2)
**Status:** ✅ COMPLETED - 2025-10-03
**Priority:** High
**Objective:** Provide an always-accessible sidebar overlay on regular web pages (similar to Arc/Dia Browser) that displays all tab groups and tabs in a vertical tree structure, allowing users to manage their workspace without switching to the dashboard.

### 8.20. Bookmark Management System (v4.1)
**Status:** ✅ COMPLETED - 2025-10-04
**Priority:** High
**Objective:** Integrate Chrome bookmark management directly into the dashboard sidebar, enabling users to organize bookmarks alongside tabs with full CRUD operations and folder hierarchy support.

**Implementation Summary:**
- **Core Feature:** Added "Bookmarks" card (position 3 in sidebar) displaying Chrome bookmarks with full CRUD capabilities
- **Hierarchical Structure:** Recursive rendering maintains nested folder structure identical to Chrome's native bookmark manager
- **Folder Operations:** Create, rename, delete, nest/un-nest folders with three-zone drag detection and visual feedback
- **Bookmark Operations:** Drag-and-drop reordering, move between folders, resurrect to live tabs, drag-to-bin deletion
- **UI Consistency:** Extended collapsible functionality to all sidebar cards with persistent state
- **Visual Polish:** Font Awesome icons, hover effects, cursor states, smooth CSS transitions

**Implementation Details:**

#### Hierarchical Folder Management
1. **Recursive Tree Rendering**
   - `renderFolderTree()` function nests child folders inside parent's `.bookmark-folder-content` div
   - Depth-based indentation (1rem per level) for visual hierarchy
   - Filters out Chrome's root containers (IDs 1, 2, 3) to show only user-created folders
   - Total bookmark count includes nested items

2. **Folder Creation and Editing**
   - Styled dialog (matching existing patterns) for folder creation
   - New folders appear at top (index: 0)
   - Single-click activation for inline editing with contenteditable
   - Automatic cursor positioning at end of text
   - Primary-colored border with SVG edit icon on hover
   - Root folder protection prevents editing system folders

3. **Folder Nesting via Drag-and-Drop**
   - Three-zone drop detection:
     - Top 25%: Drop above folder (sibling)
     - Middle 50%: Drop INTO folder (make child)
     - Bottom 25%: Drop below folder (sibling)
   - Visual feedback via `.drop-into-folder` class
   - Uses `chrome.bookmarks.move()` to update tree structure
   - Folder deletion via drag-to-bin uses `chrome.bookmarks.removeTree()` to delete parent and children

4. **Child Folder Visibility**
   - Collapsing parent folder hides (not just collapses) child folders using `.hidden` class
   - CSS transitions for smooth show/hide animations
   - Maintains collapsed state of nested children when parent expands

#### Bookmark Management
5. **Drag Handle System**
   - Drag handle icon (fa-grip-vertical) separates drag from click
   - Only appears on hover for clean UI
   - Drag handle sets `item-type: bookmark` in dataTransfer

6. **Bookmark Reordering**
   - Blue placeholder line shows exact drop position
   - Works within same folder and across folders
   - Uses `chrome.bookmarks.move()` to update positions

7. **Bookmark Resurrection**
   - Dragging bookmark to group card creates live tab with `chrome.tabs.create()`
   - Removes bookmark with `chrome.bookmarks.remove()`
   - Integrates seamlessly with existing tab grouping system

8. **Bookmark Deletion**
   - Drag-to-bin removes bookmark immediately without confirmation
   - Consistent with tab deletion UX

#### UI Enhancements
9. **Collapsible Cards**
   - All sidebar cards (Unfiled Tabs, Task Roll-Up, Bookmarks) now collapse/expand
   - Chevron icon toggles (fa-chevron-down/right)
   - Persistent state via `state.collapsedCards`
   - Collapsed cards show minimal header only (no dividers or empty space)
   - Smooth width/height transitions

10. **Visual Feedback**
    - Hover states with subtle background changes
    - Grab/grabbing cursor states during drag
    - Folder title edit mode with primary-colored border and box-shadow
    - Typing cursor appears on single-click

#### Code Architecture
11. **Data Processing**
    - `processBookmarkNode()` transforms Chrome's bookmark tree with depth tracking
    - Top-level folders extracted by iterating root containers and pushing subfolders
    - Uses Chrome Bookmarks API throughout (getTree, create, update, move, remove, removeTree, getChildren)

12. **Event Delegation**
    - Efficient event handling for dynamic content
    - Folder toggles, bookmark clicks, drag handles all use delegation
    - Proper cleanup to prevent memory leaks

**Dialog System:**
- `create-bookmark-folder-dialog` in fullpage.html
- Title, description, labeled input, action buttons (Cancel/Create)
- Enter key submits, Escape/overlay-click cancels
- Auto-focus on input field

**Files Modified:**
- fullpage.html (added create-bookmark-folder-dialog)
- fullpage.js (2800+ lines - bookmark rendering, drag-drop, folder management)
- styles.css (added .bookmark-folder, .bookmark-item, .folder-title, .bookmark-drag-handle, .folder-placeholder, .drop-into-folder, .hidden)

**Bug Fixes During Development:**
1. Fixed scrolling constraint by changing max-height from 600px to none
2. Resolved empty `<ul>` when collapsed with min-height: 0
3. Fixed "ace2" symbol by replacing Unicode with SVG background image
4. Added validation to prevent "Can't modify root bookmark folders" error
5. Refactored from flattened to hierarchical nesting
6. Fixed extraction of subfolders from root containers

**User Experience Impact:**
- Manage all Chrome bookmarks directly from Tab Ban dashboard
- Resurrect bookmarks to active tabs seamlessly
- Folder organization matches familiar Chrome bookmark manager
- Consistent drag-and-drop across tabs and bookmarks
- No need to open separate bookmark manager window

**Performance:**
- Recursive rendering handles deep folder hierarchies efficiently
- Event delegation prevents memory leaks
- CSS transitions smooth without janky animations
- All Chrome API operations async with proper error handling

**Integration:**
- Search and filter work with bookmarks
- Bookmarks resurrect to correct tab groups
- Consistent UI patterns across sidebar cards

**User Experience:**
- **Settings Toggle:** Users can enable/disable the persistent sidebar feature in Settings dialog
- **Web Page Overlay:** When enabled, sidebar appears on all regular web pages (NOT on Tab Ban dashboard itself)
- **Left-Aligned Sidebar:** Fixed vertical sidebar on the left side of web pages
- **Show/Hide Toggle:** Collapsible sidebar with keyboard shortcut or edge hover to show/hide
- **Same Functionality:** Full access to all Tab Ban features (edit metadata, sleep/wake, drag-drop, delete, etc.)
- **Non-Intrusive:** Transparent/translucent overlay that doesn't break webpage layouts

**Sidebar Structure:**
- **Hierarchical Tree View:** Expandable/collapsible folders for each tab group
- **Tab List Items:** Individual tabs with favicons, titles, and metadata indicators
- **Sleeping Tabs:** Shown within groups with visual distinction (dimmed/moon icon)
- **Notes:** Displayed within their respective group folders
- **Unfiled Tabs Section:** Separate section for ungrouped tabs
- **Search Integration:** Same search bar functionality to filter tree view
- **Task Indicators:** Visual badges showing incomplete task counts

**Interactions:**
- **Click Tab:** Opens edit dialog to modify notes, tags, todos
- **Click Group:** Expands/collapses folder
- **Drag-Drop:** Reorder tabs, move between groups
- **Right-Click Menu:** Context menu for sleep, close, move to group
- **Checkbox for Tasks:** Check/uncheck todos directly in sidebar
- **Sleep/Wake Icons:** Quick actions on hover

**Technical Implementation:**
- **Content Script:** `sidebar-content.js` injected into all non-extension pages
- **Sidebar HTML:** Dynamically created DOM structure overlaying page content
- **Sidebar CSS:** `sidebar-styles.css` for styling with z-index layering
- **Background Communication:** Message passing between content script and background script for tab data
- **State Sync:** Real-time updates when tabs/groups change
- **Exclusion Logic:** Detect Tab Ban dashboard URL and skip injection
- **Performance:** Lazy rendering - only render visible portions of large tab lists
- **Resize Handle:** Draggable edge to adjust sidebar width

**Settings:**
- **Enable/Disable Toggle:** Checkbox in Settings dialog
- **Default Width:** User-configurable sidebar width (saved to sync storage)
- **Auto-Hide:** Option to auto-hide sidebar when not hovering
- **Keyboard Shortcut:** Customizable shortcut to toggle sidebar visibility

**Benefits:**
- **Always Accessible:** Manage tabs from any website without context switching
- **Quick Navigation:** Instant access to any tab from anywhere
- **Task Management:** Check off todos while working on other pages
- **Reduced Tab Switching:** See all open tabs at a glance
- **Arc-like Experience:** Modern browser sidebar UX for Chrome users

**Challenges:**
- **DOM Injection:** Ensure sidebar doesn't conflict with page scripts/styles
- **Performance:** Minimal impact on page load and rendering
- **Responsive Design:** Handle different screen sizes gracefully
- **Dark/Light Mode:** Match user's system theme or Tab Ban theme
- **Security:** Ensure content script runs safely on all sites

**Estimated Effort:** 3-4 weeks (major feature requiring new architecture)

### 8.10. Keyboard Shortcuts (v3.4)
**Status:** 📋 PLANNED
**Priority:** High
**Objective:** Implement comprehensive keyboard shortcuts to enable power users to navigate and manage tabs without using the mouse, significantly improving workflow speed.

**Implementation Plan:**

#### Phase 1: Shortcut System Architecture
1. **Create Keyboard Handler**
   - Add global `keydown` event listener to `fullpage.js`
   - Implement modifier key detection (Cmd/Ctrl, Shift, Alt)
   - Create shortcut registry mapping key combinations to actions
   - Handle shortcut conflicts and override system

2. **Add Shortcut Help Dialog**
   - Create new dialog in `fullpage.html`: `#shortcuts-dialog`
   - List all available shortcuts organized by category
   - Add "?" key trigger to open help dialog
   - Display shortcuts with platform-specific modifier keys (⌘ on Mac, Ctrl on Windows)

#### Phase 2: Navigation Shortcuts
3. **Card Navigation**
   - `←` / `→` - Navigate between cards (focus next/previous card)
   - `Home` / `End` - Jump to first/last card
   - `Tab` / `Shift+Tab` - Navigate between tabs within a card
   - Visual focus indicator for keyboard navigation

4. **Search and Filtering**
   - `Cmd/Ctrl+K` - Focus search bar
   - `Cmd/Ctrl+F` - Focus search bar (alternative)
   - `Esc` - Clear search and unfocus
   - `Cmd/Ctrl+Shift+F` - Toggle tag filters visibility

#### Phase 3: Action Shortcuts
5. **Tab Management**
   - `Space` - Collapse/expand focused card
   - `S` - Sleep focused tab
   - `W` - Wake focused sleeping tab
   - `Delete` / `Backspace` - Close focused tab (with task protection)
   - `E` - Edit focused tab/note
   - `T` - Toggle task completion for focused item

6. **Group Management**
   - `Cmd/Ctrl+N` - Create new group
   - `Cmd/Ctrl+Shift+N` - Create new note in focused group
   - `Cmd/Ctrl+[` / `Cmd/Ctrl+]` - Move focused card left/right
   - `A` - Archive focused card
   - `R` - Rename focused card (inline edit mode)

#### Phase 4: Bulk Operations
7. **Multi-Selection**
   - `Shift+Click` - Select range of tabs
   - `Cmd/Ctrl+Click` - Toggle individual tab selection
   - `Cmd/Ctrl+A` - Select all tabs in focused card
   - Visual indication for selected tabs

8. **Bulk Actions**
   - `Cmd/Ctrl+Shift+S` - Sleep all selected tabs
   - `Cmd/Ctrl+Shift+D` - Delete all selected tabs
   - `Cmd/Ctrl+Shift+M` - Move selected tabs to another group (show group picker)

#### Phase 5: Settings and Persistence
9. **Customizable Shortcuts**
   - Add shortcuts configuration to settings dialog
   - Allow users to rebind keys
   - Store custom bindings in `chrome.storage.sync`
   - Validate for conflicts

10. **Quick Actions**
    - `Cmd/Ctrl+/` - Open command palette (fuzzy search for actions)
    - `Cmd/Ctrl+,` - Open settings dialog
    - `?` - Open keyboard shortcuts help

**Technical Considerations:**
- Prevent shortcuts when user is typing in input fields
- Handle platform differences (Mac vs Windows/Linux)
- Ensure shortcuts don't conflict with browser defaults
- Add visual feedback for keyboard focus
- Consider accessibility (screen reader announcements)
- Test with non-English keyboard layouts

### 8.10. Smart Grouping Suggestions (v3.3)
**Status:** 📋 PLANNED
**Priority:** Medium
**Objective:** Analyze open tabs and provide intelligent suggestions for grouping related tabs together, helping users maintain organized workspaces.

**Implementation Plan:**

#### Phase 1: Analysis Engine
1. **Create Tab Analysis System**
   - Extract domain from tab URLs
   - Identify related domains (e.g., github.com, gist.github.com)
   - Analyze URL patterns (same article series, documentation paths)
   - Parse page titles for common keywords
   - Track tab access patterns (which tabs are used together)

2. **Define Grouping Rules**
   - Same domain rule: N+ tabs from same domain
   - Related domains rule: tabs from related services
   - Sequential URLs rule: numbered articles, pagination
   - Keyword clustering rule: titles with common terms
   - Temporal rule: tabs opened in quick succession
   - User history rule: tabs previously grouped together

#### Phase 2: Suggestion Generation
3. **Build Suggestion Engine**
   - Scan unfiled tabs periodically (on load, every N minutes)
   - Apply grouping rules and score suggestions
   - Rank suggestions by confidence and usefulness
   - Store suggestions in state: `{ id, type, tabs[], confidence, reason }`

4. **Create Suggestion UI**
   - Add "Suggestions" indicator to toolbar (lightbulb icon with badge count)
   - Create `#suggestions-panel` (slide-in from right)
   - Display suggestion cards with preview and reasoning
   - Show which tabs would be grouped and suggested group name

#### Phase 3: User Interaction
5. **Implement Suggestion Actions**
   - "Apply" button - Create group with suggested tabs
   - "Edit" button - Modify selection before applying
   - "Dismiss" button - Remove suggestion
   - "Dismiss All Like This" - Disable this rule type
   - Auto-dismiss after user manually groups suggested tabs

6. **Group Name Suggestions**
   - Generate intelligent group names based on content
   - Example: "5 GitHub tabs" → "GitHub"
   - Example: "3 tabs from React docs" → "React Documentation"
   - Allow user to edit before applying

#### Phase 4: Learning System
7. **Track User Behavior**
   - Record which suggestions are accepted/dismissed
   - Track manual grouping actions
   - Build user preference profile for future suggestions
   - Store learning data in `chrome.storage.local`

8. **Adaptive Suggestions**
   - Adjust rule weights based on user behavior
   - If user dismisses "same domain" suggestions, reduce frequency
   - If user accepts "keyword clustering", prioritize similar suggestions
   - Learn user's preferred group sizes and naming patterns

#### Phase 5: Advanced Features
9. **Proactive Organization**
   - Setting: "Auto-apply high-confidence suggestions"
   - Automatically group tabs when confidence > threshold
   - Notification system for auto-applied groupings
   - Easy undo for auto-groupings

10. **Maintenance Suggestions**
    - Suggest splitting large groups (>15 tabs)
    - Suggest merging small related groups
    - Highlight "stale" tabs (not accessed in X days)
    - Suggest sleeping old tabs to free memory

**Technical Considerations:**
- Balance between helpful and annoying (don't over-suggest)
- Performance: tab analysis should not block UI
- Privacy: all analysis happens locally, no external API calls
- Handle edge cases (single-tab suggestions, all tabs already grouped)
- Consider ML approach for advanced pattern recognition (future enhancement)

### 8.11. Bulk Operations (v3.4)
**Status:** 📋 PLANNED
**Priority:** Medium
**Objective:** Enable users to select and perform actions on multiple tabs simultaneously, significantly improving efficiency when managing large numbers of tabs.

**Implementation Plan:**

#### Phase 1: Selection System
1. **Implement Multi-Selection**
   - Add checkbox to each tab item (hidden by default, shown on hover or in selection mode)
   - `Shift+Click` - Select range between last selected and clicked tab
   - `Cmd/Ctrl+Click` - Toggle individual tab selection
   - Add "Select Mode" toggle button to toolbar
   - Visual indication for selected tabs (highlighted border, checkmark)

2. **Selection State Management**
   - Add `selectedTabs` Set to state object
   - Track selected tab IDs across renders
   - Persist selection during drag-and-drop and re-renders
   - Clear selection on major actions or Esc key

#### Phase 2: Bulk Action Bar
3. **Create Bulk Actions UI**
   - Floating action bar appears when tabs are selected
   - Display count: "X tabs selected"
   - Position at bottom of screen with smooth slide-up animation
   - Action buttons: Sleep, Close, Move, Tag, Archive

4. **Action Button Tooltips**
   - Clear labels for each action
   - Show keyboard shortcuts
   - Disable unavailable actions (e.g., "Wake" when no sleeping tabs selected)

#### Phase 3: Bulk Actions Implementation
5. **Sleep Multiple Tabs**
   - "Sleep Selected" button
   - Check for tabs with incomplete tasks (bulk warning)
   - Sleep all selected tabs in parallel
   - Show progress indicator for large selections
   - Success notification: "8 tabs slept"

6. **Close Multiple Tabs**
   - "Close Selected" button
   - Aggregate task protection: show all incomplete tasks from all selected tabs
   - Confirmation dialog for large selections (>10 tabs)
   - Options: Cancel, Mark All Complete, Close Anyway
   - Handle errors gracefully (tab already closed)

7. **Move to Group**
   - "Move Selected" button opens group picker
   - Show list of existing groups + "New Group" option
   - Move all selected tabs to chosen group
   - Maintain relative order of tabs
   - Show success notification

8. **Bulk Tagging**
   - "Add Tags" button opens tag input
   - Apply tags to all selected tabs at once
   - Preserve existing tags on each tab
   - Show tag summary: "Added 'urgent' to 5 tabs"

#### Phase 4: Advanced Bulk Features
9. **Bulk Edit Dialog**
   - "Edit Selected" button for power users
   - Checkboxes: "Add tags", "Add note", "Set as template"
   - Apply common metadata to all selected tabs
   - Preview changes before applying

10. **Smart Selection**
    - "Select All" button (selects all in current card)
    - "Select by Filter" - select tabs matching current search/filter
    - "Select Sleeping" - select all sleeping tabs in card
    - "Select with Tasks" - select all tabs with incomplete tasks
    - "Invert Selection" button

#### Phase 5: Context Menu Integration
11. **Right-Click Context Menu**
    - Add "Select" option to tab item context menu
    - "Select All in Group" option
    - "Deselect All" option
    - Apply bulk actions from context menu

**Technical Considerations:**
- Handle selection across collapsed cards (show count in card badge)
- Performance with large selections (100+ tabs)
- Undo support for bulk actions
- Accessibility: keyboard navigation for selection
- Mobile/touch support (long-press to select)
- Batch API calls for better performance

### 8.12. Undo/Redo System (v3.5)
**Status:** 📋 PLANNED
**Priority:** Medium
**Objective:** Provide users with the ability to undo and redo actions, creating a safety net for accidental operations and improving user confidence.

**Implementation Plan:**

#### Phase 1: History Stack Architecture
1. **Create Undo Stack**
   - Implement history stack in state: `undoStack: []`, `redoStack: []`
   - Define action structure: `{ type, timestamp, data, inverse }`
   - Set stack size limit (e.g., 50 actions)
   - Store stack in memory only (don't persist across sessions)

2. **Define Undoable Actions**
   - Tab actions: close, move, sleep, wake
   - Group actions: create, rename, delete, archive, reorder
   - Note actions: create, edit, delete
   - Task actions: complete, delete
   - Bulk actions: all bulk operations

3. **Implement Action Recording**
   - Capture state before action executes
   - Store enough data to reverse the action
   - Examples:
     - Close tab: store tab URL, title, group, position, metadata
     - Move tab: store source group, target group, positions
     - Delete note: store note content, tags, group

#### Phase 2: Undo/Redo Implementation
4. **Build Undo Function**
   - Pop action from undo stack
   - Execute inverse action to restore previous state
   - Push action to redo stack
   - Update UI to reflect undone state
   - Show notification: "Undone: Closed 3 tabs"

5. **Build Redo Function**
   - Pop action from redo stack
   - Re-execute original action
   - Push action back to undo stack
   - Update UI to reflect redone state
   - Show notification: "Redone: Closed 3 tabs"

#### Phase 3: UI Implementation
6. **Add Undo/Redo Buttons**
   - Add to toolbar (curved arrow icons)
   - Disable when stack is empty
   - Show tooltip with action description on hover
   - Keyboard shortcuts: `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`

7. **Action History Panel**
   - Optional panel showing recent actions
   - Click any action to undo up to that point
   - Display action type, timestamp, description
   - Color-code by action type

#### Phase 4: Advanced Features
8. **Smart Undo**
   - Group related actions (e.g., bulk close as single undo)
   - "Undo Archive Group" restores entire group with all tabs
   - Handle cascading effects (closing tab with tasks)

9. **Undo Notifications**
   - Toast notification after each undoable action
   - "Undo" button in toast for quick reversal
   - Auto-dismiss after 5 seconds

10. **Edge Case Handling**
    - Tab no longer exists (user closed in browser)
    - Group was deleted externally
    - Bookmark folder changed
    - Handle gracefully with user-friendly messages

**Technical Considerations:**
- Memory management for large undo stacks
- Performance: don't slow down normal operations
- Handle async actions (tab creation, bookmark operations)
- Don't record undo actions themselves
- Clear redo stack when new action is performed
- Consider session-persistent undo (store in chrome.storage)

### 8.13. Time Tracking and Tab Analytics (v3.6)
**Status:** 📋 PLANNED
**Priority:** Low
**Objective:** Provide users with insights into their tab usage patterns, helping identify stale tabs and improve browsing habits.

**Implementation Plan:**

#### Phase 1: Data Collection
1. **Track Tab Timestamps**
   - Record `createdAt` when tab is first detected
   - Track `lastAccessedAt` on tab activation
   - Store `totalActiveTime` (cumulative time tab is focused)
   - Update in background script on tab events

2. **Calculate Tab Age**
   - Helper function: `getTabAge(tabUrl)` returns days since creation
   - Helper function: `getIdleTime(tabUrl)` returns days since last access
   - Display in human-readable format: "2 hours ago", "3 days old"

#### Phase 2: Visual Indicators
3. **Add Age Badges**
   - Show age badge on tabs: "3d" (3 days old)
   - Color-code by staleness:
     - Green: <1 day
     - Yellow: 1-7 days
     - Orange: 7-30 days
     - Red: >30 days
   - Optional setting to show/hide badges

4. **Highlight Stale Tabs**
   - Visual indicator for tabs not accessed in X days
   - Dim favicon and title for stale tabs
   - Show "Consider sleeping or closing" hint on hover

#### Phase 3: Analytics Dashboard
5. **Create Analytics View**
   - Add "Analytics" section to settings or new tab
   - Show statistics:
     - Total tabs open
     - Average tabs per group
     - Oldest tab
     - Most active tab
     - Total sleeping tabs
     - Memory saved by sleeping

6. **Usage Graphs**
   - Chart: Tabs opened/closed over time
   - Chart: Most used domains
   - Chart: Tab count trend (daily/weekly)
   - Use Chart.js or similar library

#### Phase 4: Smart Recommendations
7. **Stale Tab Suggestions**
   - "You have 12 tabs older than 30 days - review them?"
   - Generate list of stale tabs with quick actions
   - Bulk sleep/close stale tabs
   - "Keep" button to mark as still needed

8. **Usage Insights**
   - "You've opened 50 GitHub tabs this week - create a dedicated group?"
   - "Your 'Research' group has 25 tabs - consider splitting?"
   - "You haven't accessed these 8 tabs in 2 weeks - sleep them?"

**Technical Considerations:**
- Efficient timestamp storage and queries
- Background tracking without impacting performance
- Privacy: all data local, no external tracking
- Handle browser restarts (preserve timestamps)
- Optional feature (can be disabled in settings)

### 8.14. Card Themes and Custom Colors (v3.7)
**Status:** 📋 PLANNED
**Priority:** Low
**Objective:** Allow users to customize the visual appearance of tab group cards beyond Chrome's default colors, enabling better visual organization.

**Implementation Plan:**

#### Phase 1: Color System
1. **Extend Color Palette**
   - Add custom color picker to card settings
   - Predefined color palette (20+ colors)
   - Support for hex color input
   - Store custom colors in `chrome.storage.sync`

2. **Apply Custom Colors**
   - Override Chrome's default group colors in UI only
   - Apply to card header background
   - Update border and accent colors
   - Ensure text contrast for accessibility

#### Phase 2: Theme Presets
3. **Create Theme System**
   - Predefined themes: "Work", "Personal", "Research", "Shopping"
   - Each theme has icon + color scheme
   - Quick-apply from card menu
   - Custom theme creation

4. **Visual Customization**
   - Card background patterns (subtle textures)
   - Custom icons for groups (emoji or Font Awesome)
   - Card header gradients
   - Dark/light card variants

**Technical Considerations:**
- Maintain accessibility (WCAG contrast ratios)
- Performance: CSS variables for theming
- Don't modify actual Chrome tab group colors (separation of concerns)

### 8.15. Tab Previews on Hover (v3.8)
**Status:** 📋 PLANNED
**Priority:** Low
**Objective:** Display visual previews of tab content when hovering over tab items, enabling faster visual recognition and navigation.

**Implementation Plan:**

#### Phase 1: Screenshot System
1. **Capture Tab Screenshots**
   - Use `chrome.tabs.captureVisibleTab()` API
   - Capture on tab updates (throttled to avoid performance impact)
   - Store thumbnails as data URLs in `chrome.storage.local`
   - Implement size limits (e.g., 100KB per thumbnail)
   - Cache management (clear old thumbnails)

2. **Screenshot Settings**
   - Setting: "Enable tab previews" (on/off)
   - Setting: "Preview quality" (low/medium/high)
   - Setting: "Capture frequency" (on change / manual)

#### Phase 2: Preview UI
3. **Create Hover Tooltip**
   - Large tooltip (300x200px) appears on hover
   - Delay before showing (500ms to avoid flicker)
   - Position tooltip to avoid screen edges
   - Smooth fade-in animation

4. **Preview Content**
   - Tab screenshot (if available)
   - Tab title (full, not truncated)
   - URL (formatted)
   - Last accessed timestamp
   - Tags and task count
   - "Click to focus" hint

#### Phase 3: Fallback States
5. **Handle Missing Screenshots**
   - Show large favicon as fallback
   - Display tab title and URL
   - "Preview not available" message
   - Button to manually capture screenshot

**Technical Considerations:**
- Performance: don't capture all tabs at once
- Storage: manage quota for thumbnails
- Privacy: screenshots may contain sensitive info (setting to disable)
- Handle tabs with restricted permissions (chrome://, file://)

### 8.16. Export/Import System (v3.9)
**Status:** 📋 PLANNED
**Priority:** Low
**Objective:** Enable users to export their entire workspace setup (groups, tabs, notes, tasks) for backup or sharing, and import configurations from others.

**Implementation Plan:**

#### Phase 1: Export System
1. **Create Export Function**
   - Generate JSON with complete state snapshot
   - Include: groups, tabs, sleeping tabs, notes, tasks, tags, settings
   - Exclude: sensitive data, actual tab content
   - Add metadata: version, export date, tab count

2. **Export UI**
   - "Export" button in settings
   - Options: "Full export" vs "Groups only" vs "Notes only"
   - Generate downloadable JSON file
   - Copy JSON to clipboard option

#### Phase 2: Import System
3. **Create Import Function**
   - Parse and validate JSON structure
   - Check version compatibility
   - Preview import (show what will be imported)
   - Options: "Merge with current" vs "Replace all"

4. **Import UI**
   - "Import" button in settings
   - File upload or paste JSON
   - Show import preview with tab/group counts
   - Confirm before importing

#### Phase 3: Templates
5. **Template Library**
   - Share workspace configurations as templates
   - Gallery of community templates (optional)
   - Categories: Developer, Designer, Student, Researcher
   - One-click template import

**Technical Considerations:**
- Handle schema changes between versions
- Validate imported data for security
- Handle URLs that can't be opened (permissions)
- Template hosting (GitHub gists or extension website)

### 8.17. Advanced Search with Query Syntax (v3.10)
**Status:** 📋 PLANNED
**Priority:** Low
**Objective:** Enhance the search functionality with powerful query syntax, allowing users to perform complex searches across tabs, notes, and tasks.

**Implementation Plan:**

#### Phase 1: Query Parser
1. **Implement Search Syntax**
   - `is:sleeping` - Show only sleeping tabs
   - `has:tasks` - Tabs/notes with tasks
   - `has:notes` - Tabs with notes
   - `tag:urgent` - Items tagged "urgent"
   - `group:work` - Items in "work" group
   - `age:>7d` - Tabs older than 7 days
   - `idle:>30d` - Tabs not accessed in 30 days
   - Combine with AND: `tag:urgent has:tasks`
   - Combine with OR: `tag:urgent OR tag:important`

2. **Create Query Parser**
   - Tokenize search input
   - Build filter functions from tokens
   - Apply filters to tabs/notes
   - Return filtered results

#### Phase 2: Search UI Enhancements
3. **Autocomplete Suggestions**
   - Show syntax hints as user types
   - Suggest tags, group names, operators
   - Display example queries

4. **Saved Searches**
   - Save frequent queries with names
   - Quick access to saved searches
   - Example: "Urgent work items" = `group:work tag:urgent has:tasks`

**Technical Considerations:**
- Performance with complex queries on large datasets
- User-friendly syntax (not too technical)
- Help documentation for query syntax

### 8.18. Cross-Device Sync Enhancements (v3.11)
**Status:** 📋 PLANNED
**Priority:** Low
**Objective:** Improve cross-device synchronization to include sleeping tabs and provide awareness of tabs open on other devices.

**Implementation Plan:**

#### Phase 1: Sleeping Tab Sync
1. **Sync Sleeping Tabs**
   - Store sleeping tab data in `chrome.storage.sync`
   - Sync bookmarks across devices
   - Handle bookmark folder differences
   - Restore sleeping tabs on other devices

2. **Conflict Resolution**
   - Handle same tab slept on multiple devices
   - Merge sleeping tab metadata
   - Last-write-wins strategy with timestamps

#### Phase 2: Multi-Device Awareness
3. **Show Tabs from Other Devices**
   - New card: "Other Devices"
   - List tabs open on other Chrome instances
   - Display device name (laptop, phone, etc.)
   - Click to open tab on current device

4. **Device Management**
   - Settings to name devices
   - Toggle sync per device
   - "Open all from [device]" action

**Technical Considerations:**
- Chrome storage sync quota (100KB limit for sync)
- Privacy: user control over what syncs
- Handle offline devices gracefully

### 8.19. Empty State Illustrations (v3.12)
**Status:** 📋 PLANNED
**Priority:** Low
**Objective:** Replace text-only empty states with friendly illustrations and animations, making the interface more polished and engaging.

**Implementation Plan:**

#### Phase 1: Illustration Design
1. **Create/Source Illustrations**
   - Empty unfiled tabs sidebar illustration
   - Empty group card illustration
   - Empty task list illustration
   - No search results illustration
   - Use open-source illustration libraries (e.g., unDraw, Streamline)

2. **Add Illustrations to UI**
   - SVG format for scalability
   - Inline SVG or external files
   - Responsive sizing
   - Consistent style across all illustrations

#### Phase 2: Micro-Animations
3. **Animate Empty States**
   - Subtle animations on empty states
   - Fade-in effects
   - Illustration elements with gentle motion
   - CSS animations (no heavy JavaScript)

**Technical Considerations:**
- Keep file sizes small (SVG optimization)
- Accessibility: don't rely solely on images (keep text)
- Dark theme compatible (color schemes)

## 9. Known Issues and Bugs

The following issues have been identified and are pending resolution:

1.  **Vertical Scroll with Multiple Chrome Instances**: The vertical scroll functionality on the "Unfiled Tabs" sidebar may not work correctly when the user has more than one instance of the Chrome browser running simultaneously.
2.  **Missing Archive Confirmation**: There is no confirmation dialog when a user attempts to archive a card. This could lead to accidental archiving with no easy way to undo the action.
3.  **[RESOLVED - 2025-09-30] UI Scroll State Not Persisting on Re-render**: ~~The horizontal and vertical scroll positions of the Kanban board and its cards are not reliably preserved after an action that triggers a re-render, such as dragging and dropping a tab.~~
    -   **Resolution**: The root cause was identified through Chrome DevTools inspection using the chrome-devtools MCP. The issue was not related to the timing of storage operations or race conditions as previously suspected. Instead, the problem was simply that the `render()` function was clearing the entire `cardsContainer` DOM (`cardsContainer.innerHTML = ""` on line 326) and rebuilding it without preserving the scroll position. The fix was straightforward: save `cardsContainer.scrollLeft` before clearing the container (line 324) and restore it after rebuilding (line 421). No scroll methods (`scrollTo`, `scrollBy`, `scrollIntoView`) were being called during drag-and-drop operations; the scroll was simply resetting to 0 because the DOM was being destroyed and recreated.

4.  **[RESOLVED - 2025-09-30] Yellow Flash During Tab Wake**: ~~When waking a sleeping tab, a brief yellow "note" flash appeared before the tab rendered correctly.~~
    -   **Root Cause**: The `render()` function was being triggered multiple times during the wake operation—once by the background script detecting tab changes and again by the `wakeTab()` function. During these renders, the DOM was destroyed and rebuilt, interrupting any CSS transitions and causing a visual artifact where items briefly appeared with incorrect styling.
    -   **Resolution**: Implemented a smooth wake animation system:
        1. Added `.tab-item-waking` CSS class with a 600ms animation that smoothly transitions sleeping tabs to active tabs
        2. Applied animation immediately when wake button is clicked, transforming the existing DOM element in place
        3. Implemented `isWakingTab` flag to block all renders during the wake operation (including those triggered by background script)
        4. Delayed final render by 650ms to allow animation to complete before rebuilding DOM
        5. Users now see a pleasant scale and fade animation instead of a jarring yellow flash

5.  **Persistent Sidebar Group Colors Not Matching Chrome**: The Chrome tab group colors in the persistent sidebar are not displaying correctly. The color mapping system uses the correct hex values for Chrome's color palette (grey: #5F6368, blue: #1A73E8, etc.), but the colors still don't match the browser's native tab group colors. Investigation needed to determine if the Chrome API is returning color values in a different format than expected, or if there's an issue with how the colors are being applied to the sidebar group headers.
    -   **Location**: `sidebar-content.js` lines 13-23 (color mapping), line 223 (color application)
    -   **Workaround**: Colors are functional but may not match Chrome exactly
    -   **Priority**: Low (cosmetic issue, does not affect functionality)
