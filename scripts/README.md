# Dev scripts

## smoke.mjs — headless module smoke test

Loads `fullpage.html` in jsdom, mocks the `chrome.*` APIs, imports the
dashboard entry module (`src/app.js`), and runs `init()`/`render()` to catch
import-resolution, TDZ, and undefined-reference errors without a browser.

It does **not** validate interactive behaviour (drag/drop, animations) — that
still needs a real Chrome load.

```sh
cd /tmp && mkdir -p tk-smoke && cd tk-smoke
npm init -y >/dev/null && npm install jsdom
node /path/to/repo/scripts/smoke.mjs /path/to/repo
```
Expected tail: `SMOKE PASS ✅`
