# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately via either:

- GitHub's **[Report a vulnerability](https://github.com/smokinghandbag/tabkan/security/advisories/new)**
  (Security → Advisories), or
- email **me@bjornbyrne.com** with the details.

Please include reproduction steps and the affected version. We aim to acknowledge
reports within a few days and will keep you updated on the fix.

## Scope & context

TabKan is a Chrome extension that runs with access to your tabs, tab groups, and
bookmarks. Because of that, the highest‑impact issues are those that could lead
to **script execution in the extension's privileged context** — for example,
unescaped tab titles, bookmark titles, notes/tags, or imported session files
rendered into the DOM.

When contributing, remember:

- All untrusted data interpolated into `innerHTML` must go through
  `escapeHtml()`, or be set via `textContent` / DOM APIs.
- Imported session JSON is fully untrusted and must be treated as hostile.

The extension stores its data in Chrome's local/sync storage and talks only to
Chrome's own APIs plus Google's favicon service; it has no backend.
