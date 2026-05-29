# Privacy Policy — TabKan

_Last updated: 2026-05-29_

TabKan is a browser extension that helps you organize your open tabs and tab
groups. We take a minimal-data approach.

## What TabKan stores

- **Your tab metadata** — the custom titles, tags, notes, and to-do lists you add
  to tabs, plus your collapsed/expanded layout and saved sessions.
- This data is stored **locally in your browser** using Chrome's `storage` API
  (synced to your Chrome profile if you have Chrome Sync enabled). It is keyed to
  tab URLs so it persists when you reopen a tab.

## What TabKan does NOT do

- We do **not** run any server or backend. TabKan has no account system.
- We do **not** collect, transmit, sell, or share your browsing data, personal
  information, or analytics. There is no tracking.

## Third-party requests

- To display site icons, TabKan requests favicons from Google's public favicon
  service (`https://www.google.com/s2/favicons`). This sends the **domain name**
  (not the full URL, and no personal data) of a site to Google in order to fetch
  its icon. This is the only outbound network request the extension makes.
- TabKan also loads its UI font and icon set from Google Fonts and a CDN
  (cdnjs). These are static asset requests and contain no user data.

## Permissions

TabKan requests the `tabs`, `tabGroups`, `bookmarks`, `storage`, `contextMenus`,
and `sidePanel` permissions solely to read and organize your tabs/groups/bookmarks
within the extension's own interface. None of this information leaves your browser.

## Contact

Questions about privacy? Email **me@bjornbyrne.com**.
