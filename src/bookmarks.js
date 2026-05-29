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
      // We need to extract user folders from within these containers
      const topLevelFolders = [];
      rootFolders.forEach(rootContainer => {
        if (rootContainer && rootContainer.children) {
          // Extract only folders from this root container's children
          rootContainer.children.forEach(child => {
            if (child.type === 'folder' && child.data) {
              topLevelFolders.push(child.data);
            }
          });
        }
      });

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

      // Determine if folder should be expanded (when searching)
      const shouldExpandFolder = (folder) => {
        if (!ui.searchTerm) {
          // No search - use saved state or original collapsed state
          return !state.collapsedCards[folder.id];
        }
        // When searching, expand if folder or any child matches
        return folderHasMatches(folder);
      };

      // Recursive function to render folder hierarchy
      const renderFolderTree = (folders, depth = 0) => {
        return folders.map(folder => {
          if (!folder) return '';

          // Skip folder if it doesn't match search
          if (!folderHasMatches(folder)) return '';

          // Determine if folder should be expanded
          const isExpanded = shouldExpandFolder(folder);

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
                <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'} folder-toggle"></i>
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

      const totalBookmarks = countAllBookmarks(topLevelFolders);

      // Render the bookmarks card with collapsible header
      bookmarksCardContainer.innerHTML = `
        <div class="bookmarks-sidebar-card ${isCardCollapsed ? 'collapsed' : ''}">
          <div class="bookmarks-card-header" data-card-id="bookmarks-card">
            <i class="fas fa-chevron-${isCardCollapsed ? 'right' : 'down'} bookmarks-card-toggle"></i>
            <span class="bookmarks-card-title">Bookmarks</span>
            <span class="bookmarks-card-count">${totalBookmarks}</span>
            <button class="bookmarks-manager-btn" title="Open Chrome Bookmarks Manager">
              <i class="fas fa-bookmark"></i>
            </button>
          </div>
          <div class="bookmarks-card-content">
            ${renderFolderTree(topLevelFolders)}
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
        cardToggle.className = `fas fa-chevron-${isCollapsed ? 'right' : 'down'} bookmarks-card-toggle`;
        saveData(false);
      });

      // Open Chrome Bookmarks Manager button
      const managerBtn = bookmarksCardContainer.querySelector('.bookmarks-manager-btn');
      managerBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await chrome.tabs.create({ url: 'chrome://bookmarks/' });
      });

      // Add event listeners for folder toggle (read-only view)
      bookmarksCardContainer.querySelectorAll('.bookmark-folder-header').forEach(header => {
        const folder = header.parentElement;
        const folderId = folder.dataset.folderId;

        const folderToggle = header.querySelector('.folder-toggle');
        folderToggle.addEventListener('click', (e) => {
          e.stopPropagation();

          folder.classList.toggle('collapsed');
          const isCollapsed = folder.classList.contains('collapsed');
          state.collapsedCards[folderId] = isCollapsed;
          folderToggle.className = `fas fa-chevron-${isCollapsed ? 'right' : 'down'} folder-toggle`;

          // Helper function to recursively hide/show nested folders
          const updateChildVisibility = (parentFolder, shouldHide) => {
            const parentDepth = parseInt(parentFolder.dataset.depth);
            let nextSibling = parentFolder.nextElementSibling;

            while (nextSibling && nextSibling.classList.contains('bookmark-folder')) {
              const siblingDepth = parseInt(nextSibling.dataset.depth);

              // Stop if we've moved past this folder's descendants
              if (siblingDepth <= parentDepth) break;

              // This is a descendant of the parent folder
              if (shouldHide) {
                // Collapsing: hide all descendants
                nextSibling.classList.add('hidden');
              } else {
                // Expanding: only show immediate children, check their collapsed state
                if (siblingDepth === parentDepth + 1) {
                  nextSibling.classList.remove('hidden');

                  // If this child is collapsed, ensure ITS children stay hidden
                  if (nextSibling.classList.contains('collapsed')) {
                    // Skip over this child's descendants without showing them
                    let grandchild = nextSibling.nextElementSibling;
                    while (grandchild && grandchild.classList.contains('bookmark-folder')) {
                      const grandchildDepth = parseInt(grandchild.dataset.depth);
                      if (grandchildDepth <= siblingDepth) break;
                      // Ensure grandchildren remain hidden
                      grandchild.classList.add('hidden');
                      grandchild = grandchild.nextElementSibling;
                    }
                  }
                }
                // Deeper descendants remain hidden (or will be handled by their parent)
              }

              nextSibling = nextSibling.nextElementSibling;
            }
          };

          // Apply the visibility changes
          updateChildVisibility(folder, isCollapsed);

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
            <i class="fas fa-chevron-down bookmarks-card-toggle"></i>
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
