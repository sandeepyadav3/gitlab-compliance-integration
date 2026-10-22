# Final submission checklist

## Included

- React/TypeScript UI, Node backend and SQLite persistence; pinned install and exact commands.
- Real read-only GitLab API integration, explicit limits, provenance and safe errors.
- Fixed historical baselines, meaningful comparisons, honest partial/stale evidence.
- Backend tests, browser success/partial/recovery workflow and reproducible mock demo.
- Synthetic demo JSON, seed-project instructions, API coverage, architecture/tradeoffs,
  recovery policies, production considerations and AI-use disclosure.

## Reviewer quick start

1. Install Node 22.17.0 or supported Node 24.x; run `npm ci`.
2. Run `npm run verify` without credentials. This builds the UI and writes only
   synthetic mock evidence to ignored `artifacts/` (temporary test databases are removed).
3. For browser tests, `npx playwright install chromium`, then `npm run test:ui`.
4. Run `npm run demo:mock` and follow docs/demos.md for the isolated interactive demo.
5. For live use, copy `.env.example` to `.env`, set your own server-side `read_api` token,
   run `npm start`, open http://127.0.0.1:3001 and save your seeded project IDs.
   No prepopulated database or author token is required or supplied.

## Author actions before sending

- Add the reviewed Loom URL to the README demonstration placeholder. Show both live
  GitLab setting changes and the clearly labeled mocked failure/recovery workflow.
- Restore the seeded force-push setting after the live recording. Keep test projects
  available if reviewers need them, but never share the PAT or your local database.
- Push the application source to the submission repository and confirm reviewer access.
  The three GitLab repositories are test fixtures; they do not replace the application repo.
- Commit source, package lock, docs and explicitly synthetic example JSON. Leave `.env`,
  `data/`, SQLite files, node_modules, dist and generated artifacts out of the commit.
- Check that the README recording link and repository access work for the recipient.

No deployment is required. The recording link and submission-repository access are not done yet.
