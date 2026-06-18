# Changelog

All notable changes to the **TabKan** extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [5.6.0] — 2026-06-18

### Added
- **Reopen a closed window's tabs and groups.** The window switcher lists your saved
  window sessions; click **Open in new window** to rebuild one in its own window, with
  its groups and tabs restored (matched by URL so nothing is duplicated — if that
  session is already open, TabKan just brings it to the front).
- **Manage every window from one board.** With more than one Chrome window open, the
  dashboard shows a window switcher in the sidebar — tabs when expanded, compact chips
  when collapsed — to pick which window's tabs and groups you're managing. It
  auto-follows the window you're working in; click a tab to lock onto a window, and
  double-click its name to rename it.

### Changed
- **One dashboard per profile.** The full-board dashboard now lives in a single
  "primary" window; opening it from another window focuses that one instead of
  creating duplicates. Other windows use the side panel (which still works per
  window) — their toolbar menu shows only the Side Menu option.

### Fixed
- **"Where did my groups go?" on multiple windows.** Since per-window dashboards
  (5.4.0), the board shows only the current window's tabs and groups — so if your
  groups were in another window they looked like they'd vanished after updating.
  The new window switcher makes every open window's groups reachable in one click,
  so they're never hidden behind an empty-looking board.
- **Dashboard no longer refreshes every few seconds while renaming a tab group.**
  Group renames now update in place and the dashboard ignores the re-render its own
  group writes would otherwise trigger.

## [5.5.0] — 2026-06-16

### Added
- **Close a tab in one click.** Every tab card (and side-panel tab) now has a
  close button; closing shows an **Undo** prompt for a few seconds in case it was
  a mistake. This replaces the old drag-a-tab-to-"Drop to Close" bin.
- **Create a group by dragging a tab** onto the **+ New Group** column — no more
  stray blank "New Tab". Clicking + New Group still works, with a heads-up that
  Chrome requires one starter tab in a group.

### Changed
- **Ungrouped tabs now appear as a column on the board** instead of a sidebar
  list, so you can see and organise unsorted tabs right in the kanban view. It's
  set apart with a purple outline and a slightly lighter background.
- When the sidebar is collapsed, a **bookmarks indicator** now shows there are
  bookmarks to expand to.

## [5.4.0] — 2026-06-08

### Added
- **Per-window dashboards.** You can now open a TabKan dashboard in more than one
  browser window — each window gets its own board showing that window's tabs and
  groups. (Previously opening it from a second window just refocused the first
  window's dashboard.)
- **"Open in which window?" prompt.** When you use Go-to-tab for a page that's open
  in more than one window, TabKan now asks which window to bring it up in.
- **Drag bookmarks in from the bookmarks bar.** Drag a bookmark from Chrome's
  bookmarks bar onto a group to open it there as a tab; the source bookmark is
  removed (only when exactly one bookmark matches that URL, to avoid removing the
  wrong one).

### Fixed
- **Loose bookmarks now appear in the sidebar.** Bookmarks saved directly to the
  Bookmarks Bar / Other Bookmarks (e.g. via the ⭐ button) were never shown; they
  now appear under their section heading, and a freshly-saved bookmark shows up
  right away.
- **Workspace recovery no longer duplicates your tabs.** After a browser restart,
  the restore prompt waits for Chrome's own session restore to finish, reconciles
  against what's already open (matching by URL) instead of creating a second copy,
  and no longer rewrites your bookmarks.

## [5.3.0] — 2026-06-05

### Added
- **Workspace recovery.** If Chrome reopens without your tabs (e.g. you haven't
  enabled "Continue where you left off" and quit the browser), TabKan now offers
  to restore your previous workspace. It keeps a private, local auto-snapshot of
  your tab groups and tabs while the dashboard is open, and shows a one-click
  **Restore** prompt the next time you open the dashboard to an empty window.
- **Restart guidance.** The welcome page and Settings now explain how to turn on
  Chrome's "Continue where you left off" startup option so your tabs and groups
  survive a browser restart.
- **Version link.** The version number in the top-right of the dashboard now links
  to that version's release notes on GitHub.

### Changed
- The **All Tasks** roll-up in the sidebar now stays hidden until you've added at
  least one to-do to a tab, instead of showing an empty card — and it fades in
  and out smoothly rather than flashing. When hidden it no longer leaves an empty
  gap between the Ungrouped Tabs and Bookmarks sections.
- Renamed the sidebar's **Unfiled Tabs** section to **Ungrouped Tabs** (matching
  Chrome's own wording for tabs that aren't in a group).

## [5.2.1] — 2026-06-03

### Added
- **First-run welcome page.** On first install, TabKan opens a short welcome tab
  that shows how to pin the toolbar icon (Chrome doesn't allow extensions to pin
  themselves) and links straight to the dashboard. It only appears once, never on
  updates, and follows your light/dark theme.

## [5.2] — 2026-06-03

### Added
- **Light mode.** A new Light / Dark toggle in Settings → Appearance. The choice
  is remembered and synced, and applies across the dashboard, the side panel
  (updating live), and the toolbar popup. Dark remains the default.

### Changed
- The "All Tasks" roll-up checkboxes now match the Edit dialog's to-dos (rounded
  accent checkbox with a check, strikethrough on complete).

### Fixed
- Side panel group headers are now a flat, theme-aware tint of the group colour
  instead of fading to a hardcoded dark — so they read correctly in light mode.

## [5.1] — 2026-06-03

A redesign of the tab editor and tab cards, plus a leaner toolbar.

### Added
- **Redesigned Edit Tab dialog** — a cleaner, balanced two-column layout with a
  favicon/identity header. Changes now **save automatically** when you close the
  dialog (via ✕, clicking outside, or Esc) — no more Save button.
- **Tag autocomplete** — start typing a tag and matching existing tags appear in
  a dropdown (with how many tabs use each), so you reuse tags instead of creating
  near-duplicates. Pick with the mouse or ↑/↓ + Enter, or create a new one.
- The dialog's to-do list now scrolls within the dialog and shows a live
  done/total count, so long lists stay tidy.

### Changed
- **Redesigned tab cards** — the note preview now spans the full width of the
  card and fades out when it's longer than the preview; the to-do count sits at
  the bottom-left and tags at the bottom-right.
- **Card hover actions** are now **Edit** and **Go to tab**. Clicking a card's
  body no longer switches tabs (it was easy to trigger by accident) — use the
  Go-to-tab action, or click a note / to-do count to jump straight into editing.

### Removed
- The filter-status bar (result count + active-filter chips). The tag filters
  already show what's active — click **All** to reset, and the empty-state still
  offers a one-click "Clear filters".

## [5.0.1] — 2026-06-02

### Fixed
- **Dashboard no longer reloads itself on Brave and other Chromium-based
  browsers.** The extension-context watchdog now uses a genuine liveness check
  and only runs while the dashboard is visible, instead of force-reloading the
  page when the background service worker was merely suspended (which Chromium
  browsers do aggressively). This stops the "tab keeps refreshing" loop.
- Smoother board updates: tab and tab-group changes are now debounced
  consistently, so a burst of changes (e.g. an auto-collapse cascade) coalesces
  into a single re-render instead of a flicker storm.
- Sidebar collapse/expand toggle: the chevron now renders at the same heavier
  weight as the other icons and stays the same distance from the top whether the
  sidebar is expanded or collapsed (it no longer jumps up when collapsed).

## [5.0] — 2026-06-02

A focused UX refresh of the dashboard: clearer interactions, a cleaner toolbar,
and crisper icons.

### Added
- **Tile click-zones** — click a tab card's body to switch straight to that tab.
  Hover a card for **⋯ Edit** and **Copy URL** actions.
- **Click a tag on a card** to instantly filter the board by it.
- **Search & filter feedback** — a clear (×) button in the search field, a live
  result count ("N tabs · M bookmarks match"), an empty state when nothing
  matches, and active tag filters shown as removable chips with "Clear all".
- Unit-test suite plus an expanded smoke test covering the new interactions.

### Changed
- **Single-row toolbar** — search, the tool buttons (settings, collapse-all,
  manage-tags), and the tag filters now share one clean row.
- **Sessions** moved into the Settings dialog ("Save & Restore").
- **Icons migrated to Phosphor** (bold weight), bundled locally — sharper, more
  legible, and no longer fetched from a CDN.
- **Bookmarks sidebar** — top-level folders now start collapsed for a tidier
  list; click anywhere on a folder row to expand or collapse it.

### Fixed
- Fixed two icons (the search magnifier and the sleeping-tab indicator) that
  could fail to render.
- An accidental drag no longer registers as a click on a tab card.

### Removed
- The redundant "Persistent Sidebar" item in Settings (the side panel is still
  available from the extension icon's right-click menu).

## [4.4] — 2026-05-29

First public, open-source release.

### Added
- Tab groups rendered as a visual Kanban board (full-page dashboard + side panel).
- Notes, tags, and to-do lists attached to any tab, keyed to its URL.
- Instant search and tag filters across titles, URLs, notes, and to-dos.
- Saved sessions: store and restore whole workspaces (groups, tabs, bookmarks).
- Task roll-up aggregating every to-do across all tabs.
- Open-source project scaffolding: MIT license, contributing/security/conduct
  docs, CI, and architecture documentation.

### Security
- Stored-XSS hardening across the dashboard and side panel (all untrusted data
  escaped before rendering); tightened Content Security Policy.

[5.6.0]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.6.0
[5.5.0]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.5.0
[5.4.0]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.4.0
[5.3.0]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.3.0
[5.2.1]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.2.1
[5.2]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.2
[5.1]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.1
[5.0.1]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.0.1
[5.0]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.0
[4.4]: https://github.com/smokinghandbag/tabkan/releases/tag/v4.4
