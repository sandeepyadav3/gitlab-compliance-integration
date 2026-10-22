# Phase 5 analyst UI

## Run

After configuring the server-side `.env`, run `npm ci`, `npm run build`, then
`npm start`. Open http://127.0.0.1:3001. No separate frontend process is required.
Preserve your existing `.env` and `data/` when updating. SQLite schema remains version 2.
Building is required after frontend source changes; the server returns a friendly
setup message at `/` when the built client is missing. API routes remain available.

For frontend development only, start `npm start` in one terminal and `npm run dev:ui`
in another, then open http://127.0.0.1:5173. Vite proxies API requests to port 3001;
change its proxy target in vite.config.ts if you change the backend port. The normal
built application always uses the same origin as the backend.

## Workflow and interpretation

- Save 1–25 numeric project IDs, then collect the saved selection. Edited IDs must be
  saved before collection. Duplicate IDs are normalized by the existing backend.
- Accepted runs persist before execution. Refreshing reconnects to the active run.
  Only one run can be active; a conflict links to the existing run.
- Open any project to inspect its status, observed restrictions, individual source
  timestamps/URLs, errors, raw JSON, and comparison against its frozen baseline.
- Open older runs in the sidebar. Historical comparisons retain their original baseline.
  Failed/partial observations remain visible; any last-complete fallback is labeled
  historical and comes from before that selected run, never a future observation.
- Before/after changes are distinct from coverage changes. Missing evidence does not
  become a removal or a false boolean. Configured branch metadata is distinct from an
  existing default branch in an empty repository.
- Evidence older than 24 hours has a stale warning. The threshold is a UI policy;
  it does not assert that GitLab settings have changed. Recollect when needed.
- A refresh failure retains loaded results with an error and retry action. Active runs
  poll once per second; idle views poll every five seconds. Requests are cancellable,
  do not overlap within a workspace load, and have a 12-second browser timeout.

React escapes provider text. Provider links are limited to HTTPS gitlab.com URLs.
No token input or token value exists in the client. Built assets are served from a
restricted path list; source files, database files and `.env` are not static assets.
The CSS supports dark mode, keyboard focus, and narrow/mobile screens.

## Browser verification

Ordinary use requires no Playwright installation. To run the optional browser check:

```bash
npm ci
npm run build
npx playwright install chromium
npm run test:ui
```

On a Linux machine missing browser system libraries, use Playwright's documented
`npx playwright install --with-deps chromium` setup instead. The smoke test creates a
temporary SQLite database and local mock GitLab HTTP server, then drives the actual
backend and built UI; it never calls GitLab.com or needs a token. It covers collection,
refresh reconnection, before/after changes, partial failure, historical fallback,
recovery, offline retention, stale evidence, escaped text/unsafe links, and mobile layout.
The backend suite remains `npm test` and does not require a browser.

Optional `PLAYWRIGHT_EXECUTABLE_PATH` selects an existing Chromium executable;
`SCREENSHOT_DIR` overrides the temporary screenshot directory. Screenshots use synthetic
mock data. See verification.md for the browser/runtime versions actually checked.
