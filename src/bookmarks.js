// Bookmarks card: renders the read-only bookmark folder tree in the sidebar.
import { state, ui } from './state.js';
import { escapeHtml, getFaviconUrl, FOLDER_INDENT_REM, BOOKMARK_INDENT_REM, FOLDER_HEADER_BASE_REM } from './utils.js';
import { bookmarksCardContainer } from './dom.js';
import { saveData } from './app.js';

  let cachedBookmarkTree = null;
  // Dirty flag: only rebuild the bookmark DOM when bookmarks (or the search term)
  // change, not on every unrelated tab/group render.
  let bookmarksDirty = true;
  let lastBookmarkSearchTerm = null;

  // Invalidate bookmark cache on any bookmark change
export const invalidateBookmarkCache = () => {
    cachedBookmarkTree = null;
    bookmarksDirty = true;
  };

  // Render Bookmarks Card (Sleeping tabs)
export const renderBookmarks = async () => {
    try {
      // Get bookmark tree (use cache if available)
      let bookmarkTree;
      if (cachedBookmarkTree) {
        bookmarkTree = cachedBookmarkTree;
      } else {
        bookmarkTree = await chrome.bookmarks.getTree();
        cachedBookmarkTree = bookmarkTree;
      }

      // Check if card is collapsed
      const isCardCollapsed = state.collapsedCards['bookmarks-card'] || false;

      // Process bookmark tree to build hierarchical structure
      const processBookmarkNode = (node, depth = 0, parentIndex = 0) => {
        if (!node.children) return null; // Not a folder
        if (node.id === '0') {
          // Root node, process children
          return node.children.map((child, idx) => processBookmarkNode(child, depth, idx)).filter(Boolean);
        }

        // Process children in their actual order, preserving bookmarks and folders mixed
        const children = node.children.map(child => {
          if (child.children) {
            // It's a folder - recursively process it
            return {
              type: 'folder',
              data: processBookmarkNode(child, depth + 1, child.index)
            };
          } else {
            // It's a bookmark
            return {
              type: 'bookmark',
              data: child
            };
          }
        });

        const bookmarkCount = children.filter(c => c.type === 'bookmark').length;
        const folderCount = children.reduce((sum, c) => {
          if (c.type === 'folder' && c.data) {
            return sum + c.data.totalBookmarks;
          }
          return sum;
        }, 0);

        return {
          id: node.id,
          title: node.title,
          depth: depth,
          index: node.index !== undefined ? node.index : parentIndex,
          parentId: node.parentId,
          children: children,
          totalBookmarks: bookmarkCount + folderCount
        };
      };

      const rootFolders = processBookmarkNode(bookmarkTree[0], 0);

      // rootFolders is an array containing [Bookmarks Bar, Other Bookmarks, Mobile Bookmarks, ...]
      // We promote each container's sub-folders to the top level (the familiar
      // "Personal / Accounting / …" list). We ALSO gather bookmarks that sit
      // loose directly in a container (e.g. the ones the browser's ★ button adds
      // straight to the Bookmarks Bar) into a per-container section — previously
      // these were dropped entirely, so a freshly-bookmarked page never showed up.
      const topLevelFolders = [];
      const looseSections = [];
      rootFolders.forEach(rootContainer => {
        if (!rootContainer || !rootContainer.children) return;
        const looseBookmarks = [];
        rootContainer.children.forEach(child => {
          if (child.type === 'folder' && child.data) {
            topLevelFolders.push(child.data);
          } else if (child.type === 'bookmark') {
            looseBookmarks.push(child); // keep the { type:'bookmark', data } shape
          }
        });
        if (looseBookmarks.length > 0) {
          looseSections.push({
            id: rootContainer.id,            // stable container id ('1','2',…) → collapse state persists
            title: rootContainer.title,      // "Bookmarks Bar" / "Other Bookmarks" / …
            depth: 0,
            index: rootContainer.index,
            parentId: rootContainer.parentId,
            children: looseBookmarks,
            totalBookmarks: looseBookmarks.length,
            defaultExpanded: true,           // show loose bookmarks by default (they were invisible before)
          });
        }
      });

      // Loose-bookmark sections first (so newly-starred pages are immediately
      // visible at the top), then the promoted user folders.
      const sidebarSections = [...looseSections, ...topLevelFolders];

      // Search memoization for performance
      const searchCache = new Map();
      const currentSearchKey = ui.searchTerm.toLowerCase();

      // Helper function to check if bookmark matches search (memoized)
      const bookmarkMatchesSearch = (bookmark) => {
        if (!ui.searchTerm) return true;
        const cacheKey = `b-${bookmark.id}-${currentSearchKey}`;
        if (searchCache.has(cacheKey)) {
          return searchCache.get(cacheKey);
        }
        const searchLower = currentSearchKey;
        const matches = (bookmark.title && bookmark.title.toLowerCase().includes(searchLower)) ||
                       (bookmark.url && bookmark.url.toLowerCase().includes(searchLower));
        searchCache.set(cacheKey, matches);
        return matches;
      };

      // Helper function to check if folder or its children match search (memoized)
      const folderHasMatches = (folder) => {
        if (!ui.searchTerm) return true;
        if (!folder || !folder.children) return false;

        const cacheKey = `f-${folder.id}-${currentSearchKey}`;
        if (searchCache.has(cacheKey)) {
          return searchCache.get(cacheKey);
        }

        // Check if folder title matches
        const searchLower = currentSearchKey;
        if (folder.title && folder.title.toLowerCase().includes(searchLower)) {
          searchCache.set(cacheKey, true);
          return true;
        }

        // Check if any children match (recursively)
        const hasMatches = folder.children.some(child => {
          if (child.type === 'bookmark') {
            return bookmarkMatchesSearch(child.data);
          } else if (child.type === 'folder' && child.data) {
            return folderHasMatches(child.data);
          }
          return false;
        });
        searchCache.set(cacheKey, hasMatches);
        return hasMatches;
      };

      // Determine if folder should be expanded.
      const shouldExpandFolder = (folder, depth = 0) => {
        if (ui.searchTerm) {
          // When searching, expand any folder that (or whose child) matches.
          return folderHasMatches(folder);
        }
        const saved = state.collapsedCards[folder.id];
        if (saved !== undefined) return !saved; // honour the user's explicit choice
        // Default with no saved state: loose-bookmark bar sections start expanded
        // (otherwise a freshly-starred bookmark would still be hidden); top-level
        // folders start collapsed for a tidier sidebar; nested folders expanded.
        if (folder.defaultExpanded) return true;
        return depth > 0;
      };

      // Recursive function to render folder hierarchy
      const renderFolderTree = (folders, depth = 0) => {
        return folders.map(folder => {
          if (!folder) return '';

          // Skip folder if it doesn't match search
          if (!folderHasMatches(folder)) return '';

          // Determine if folder should be expanded
          const isExpanded = shouldExpandFolder(folder, depth);

          const hasChildren = folder.children && folder.children.length > 0;

          // Render children in their actual order (bookmarks and folders mixed)
          const childrenHtml = hasChildren ? folder.children.map(child => {
            if (child.type === 'bookmark') {
              const bookmark = child.data;
              // Filter bookmarks based on search
              if (!bookmarkMatchesSearch(bookmark)) return '';
              return `
                <div class="bookmark-item" draggable="true" data-bookmark-id="${escapeHtml(bookmark.id)}" data-bookmark-url="${escapeHtml(bookmark.url)}" data-parent-folder="${escapeHtml(folder.id)}" style="padding-left: ${depth * FOLDER_INDENT_REM + BOOKMARK_INDENT_REM}rem;">
                  <img src="${getFaviconUrl(bookmark.url)}" class="bookmark-favicon" alt="">
                  <span class="bookmark-title">${escapeHtml(bookmark.title || bookmark.url)}</span>
                </div>
              `;
            } else if (child.type === 'folder' && child.data) {
              // Recursively render folder (filtering happens in recursive call)
              return renderFolderTree([child.data], depth + 1);
            }
            return '';
          }).join('') : '';

          return `
            <div class="bookmark-folder ${isExpanded ? '' : 'collapsed'}" data-folder-id="${escapeHtml(folder.id)}" data-depth="${depth}">
              <div class="bookmark-folder-header" style="padding-left: ${depth * FOLDER_INDENT_REM + FOLDER_HEADER_BASE_REM}rem;">
                <i class="ph ph-caret-${isExpanded ? 'down' : 'right'} folder-toggle"></i>
                <span class="folder-title">${escapeHtml(folder.title)}</span>
                <span class="folder-count">${folder.totalBookmarks}</span>
              </div>
              <div class="bookmark-folder-content">
                ${childrenHtml}
              </div>
            </div>
          `;
        }).join('');
      };

      // Calculate total bookmarks from all folders recursively
      const countAllBookmarks = (folders) => {
        return folders.reduce((sum, folder) => {
          if (!folder) return sum;
          return sum + folder.totalBookmarks;
        }, 0);
      };

      const totalBookmarks = countAllBookmarks(sidebarSections);

      // Render the bookmarks card with collapsible header
      bookmarksCardContainer.innerHTML = `
        <div class="bookmarks-sidebar-card ${isCardCollapsed ? 'collapsed' : ''}">
          <div class="bookmarks-card-header" data-card-id="bookmarks-card">
            <i class="ph ph-caret-${isCardCollapsed ? 'right' : 'down'} bookmarks-card-toggle"></i>
            <span class="bookmarks-card-title">Bookmarks</span>
            <span class="bookmarks-card-count">${totalBookmarks}</span>
            <button class="bookmarks-manager-btn" title="Open Chrome Bookmarks Manager">
              <i class="ph ph-bookmark-simple"></i>
            </button>
          </div>
          <div class="bookmarks-card-content">
            ${renderFolderTree(sidebarSections)}
          </div>
        </div>
      `;

      // Toggle entire card collapse/expand
      const cardHeader = bookmarksCardContainer.querySelector('.bookmarks-card-header');
      const cardToggle = cardHeader.querySelector('.bookmarks-card-toggle');
      cardHeader.addEventListener('click', (e) => {
        if (e.target.closest('.bookmarks-manager-btn')) return;
        const card = bookmarksCardContainer.querySelector('.bookmarks-sidebar-card');
        card.classList.toggle('collapsed');
        const isCollapsed = card.classList.contains('collapsed');
        state.collapsedCards['bookmarks-card'] = isCollapsed;
        cardToggle.className = `ph ph-caret-${isCollapsed ? 'right' : 'down'} bookmarks-card-toggle`;
        saveData(false);
      });

      // Open Chrome Bookmarks Manager button
      const managerBtn = bookmarksCardContainer.querySelector('.bookmarks-manager-btn');
      managerBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await chrome.tabs.create({ url: 'chrome://bookmarks/' });
      });

      // Add event listeners for folder toggle (read-only view). The whole
      // header row toggles the folder (not just the chevron).
      bookmarksCardContainer.querySelectorAll('.bookmark-folder-header').forEach(header => {
        const folder = header.parentElement;
        const folderId = folder.dataset.folderId;

        const folderToggle = header.querySelector('.folder-toggle');
        header.addEventListener('click', (e) => {
          e.stopPropagation();

          // Folders render nested inside their parent's .bookmark-folder-content,
          // so collapsing is purely a class toggle — the CSS rule
          // `.bookmark-folder.collapsed .bookmark-folder-content { max-height: 0 }`
          // hides this folder's entire subtree at once. (Previously a fragile
          // sibling-walk manually toggled a .hidden class on every descendant.)
          folder.classList.toggle('collapsed');
          const isCollapsed = folder.classList.contains('collapsed');
          state.collapsedCards[folderId] = isCollapsed;
          folderToggle.className = `ph ph-caret-${isCollapsed ? 'right' : 'down'} folder-toggle`;
          saveData(false);
        });

      });

      // Add simple drag for bookmarks - only for dragging to tab groups
      bookmarksCardContainer.querySelectorAll('.bookmark-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.effectAllowed = 'copy';
          e.dataTransfer.setData('text/plain', JSON.stringify({
            type: 'bookmark',
            bookmarkId: item.dataset.bookmarkId,
            bookmarkUrl: item.dataset.bookmarkUrl
          }));
          e.dataTransfer.setData('item-type', 'bookmark');
          item.classList.add('dragging');
          document.body.classList.add('dnd-active'); // suppress layout transitions while dragging
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          document.body.classList.remove('dnd-active');
        });

        // Click to open bookmark in new tab
        item.addEventListener('click', async () => {
          const url = item.dataset.bookmarkUrl;
          if (url) {
            await chrome.tabs.create({ url });
          }
        });

      });

    } catch (error) {
      console.error('Error rendering bookmarks:', error);
      bookmarksCardContainer.innerHTML = `
        <div class="bookmarks-sidebar-card">
          <div class="bookmarks-card-header">
            <i class="ph ph-caret-down bookmarks-card-toggle"></i>
            <span class="bookmarks-card-title">Sleeping</span>
            <span class="bookmarks-card-count">0</span>
          </div>
          <div class="bookmarks-card-content">
            <div class="bookmarks-error">Unable to load bookmarks</div>
          </div>
        </div>
      `;
    }
  };

// Re-render the bookmark tree only when bookmarks changed or the search term
// changed (search filters bookmarks too). Called from app.js render().
export const renderBookmarksIfDirty = async () => {
  if (bookmarksDirty || ui.searchTerm !== lastBookmarkSearchTerm) {
    await renderBookmarks();
    bookmarksDirty = false;
    lastBookmarkSearchTerm = ui.searchTerm;
  }
};
