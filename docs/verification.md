# Final verification (Phase 7)

Verified 2026-10-22 in the coding environment:

- A fresh source copy without `.env`, data, node_modules or dist successfully ran
  `npm ci` and `npm run verify` on Node 22.17.0. Its separate browser smoke check passed
  with the Chromium executable qualification below. Node 24.19.0 also passes the full
  `npm run verify` command. Documentation relative links resolve.
- Final package version is 0.7.0, HTTP health checkpoint is 7, storage schema remains 2.
  No storage reset or history rewrite is required.

- Backend and frontend TypeScript checks and production client build pass on Node
  24.19.0 and independently installed Node 22.17.0.
- All 77 backend tests pass on both runtimes. Existing migration, comparison, bounded
  concurrency, ownership, cancellation, persistence and recovery coverage remains passing.
- The actual server-entry-point test retains the Windows-compatible private IPC
  shutdown correction. No public shutdown endpoint or skipped test was introduced.
- The Playwright browser smoke check passes on both runtimes against the real backend,
  SQLite and a local GitLab HTTP mock. It covers saved selection, collection, refresh
  reconnection, force-push changes, partial failure, fixed historical fallback, recovery,
  offline retention, stale timestamps, safe rendering and mobile layout.
- Phase 6 credential-free scenario assertions pass on Node 22.17.0 and 24.19.0.
  The actual interactive launcher was driven in Chromium: complete baseline, partial
  403, terminal `recover`, successful UI recollection, preserved partial history and
  clean `quit`. Its temporary storage is separate from normal user data.
- Desktop, partial-failure and mobile screenshots were visually reviewed. No horizontal
  overflow was observed at the tested 1280px and 390px viewport widths.

Browser qualification: the environment could not download the current Playwright
Chromium archive successfully. The checks used Playwright 1.64.1 with an explicit
Chromium 134 executable downloaded via the older Playwright distribution. The default
matching Chromium 156 and native Windows browser are not verified here. A fresh user
setup should use `npx playwright install chromium`; the executable override is optional.

Live-account provenance: user-supplied Phase 3 HTTP run
8b292169-02ab-434f-9fcd-ebb370494e31 confirmed three complete results, 100% progress,
and baseline references to the first persisted run. The user subsequently confirmed
live force-push changes in both directions through Phase 4. These are user-side live
results, not GitLab calls from the coding environment. The user also confirmed all three project details and correct historical changes in
the Phase 5 UI. Sanitized live demo recording remains user-side. Phase 6 includes the
interactive mocked demo and a generated, explicitly synthetic JSON evidence example.

Tests ran on Linux. Native Windows was not available here. Node 22.17.0 is explicitly
supported by the npm-script type-stripping flag; experimental type stripping/SQLite
warnings are expected and not globally suppressed. No credentials, private databases,
browser binaries or mock screenshots are packaged.

The user also confirmed the interactive mocked failure/recovery flow, including
re-enabling the failure and repeating recovery. The final README contains a deliberate
Loom placeholder; no recording link or submission-repository push is claimed here.
