# Changelog

All notable changes to the **TabKan** extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

[5.0.1]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.0.1
[5.0]: https://github.com/smokinghandbag/tabkan/releases/tag/v5.0
[4.4]: https://github.com/smokinghandbag/tabkan/releases/tag/v4.4
