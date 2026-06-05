# Changelog

All notable changes to the **TabKan** extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

[5.2.1]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.2.1
[5.2]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.2
[5.1]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.1
[5.0.1]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.0.1
[5.0]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.0
[4.4]: https://github.com/smokinghandbag/tabkan/releases/tag/v4.4
