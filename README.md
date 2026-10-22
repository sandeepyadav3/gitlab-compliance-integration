# GitLab compliance integration

A local React/TypeScript application for collecting GitLab project evidence, investigating
failures, and comparing protection settings over time. A Node.js worker collects
asynchronously into SQLite. All application requests to GitLab are read-only.

## Demonstration

**Loom recording: TODO — add the reviewed recording link before submission.**

The recording should show live collection of the three seeded GitLab projects and a
protection-setting change, followed by the clearly labeled mocked failure/recovery demo.
[Recording walkthrough](docs/demos.md) · [Synthetic demo evidence](docs/demo-mocked-evidence.json)

## Requirements

Node.js **22.17.0** or Node.js **24.x**. `.nvmrc` selects 22.17.0. Scripts explicitly
include `--experimental-strip-types`, so `npm run collect` works on Node 22.17.0
without a manual flag. No third-party native SQLite package or compiler is needed.
Node's built-in SQLite module is experimental in Node 22; its experimental warning
is expected. Runtime package versions are pinned in `package-lock.json`.

## Install and configure

```bash
npm ci
```

Copy `.env.example` to `.env` using your editor (preserve your existing `.env` when
upgrading). Configure the token **server-side** with `read_api` scope:

```dotenv
GITLAB_TOKEN=replace-me
GITLAB_PROJECT_IDS=87944794,87944512,87944475
PORT=3001
DATABASE_PATH=data/evidence.sqlite
```

Never commit the token, expose it through `VITE_` variables, or paste it in chat.
The IDs are the seeded synthetic test projects; substitute your own when recreating
the environment. Shell environment variables override `.env`. Tests require no token.

## Build and open the application

```bash
npm test
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Keep this terminal running. Enter and save project IDs,
then select **Start collection**. Inspect a project for restrictions, sources,
and changes against its fixed baseline. The sidebar opens older runs; refreshing the
page reconnects to an active collection. Your token stays on the server.

When upgrading, preserve `.env` and `data/`, replace the source files, then rerun
`npm ci` and `npm run build`. Stop the old server before starting the new one.
The server initializes storage automatically. The following CLI commands are optional.

## Set up local storage

```bash
npm run db:setup
```

Creates the configured SQLite file and applies schema migrations through version 2. Other CLI
commands also initialize storage automatically. Files in `data/`, `.env`, and SQLite
files are ignored by git. Keep databases containing private project metadata local.
When changing the storage path, the previous database remains untouched.

## Save a selection and collect

```bash
npm run selection -- 87944794 87944512 87944475
npm run selection
npm run collect
```

Selection priority: explicit CLI IDs, then nonempty `GITLAB_PROJECT_IDS`, then saved
SQLite selection. A collection saves its effective selection and creates a new run.
To change a saved selection permanently while using it as the default, clear or remove
`GITLAB_PROJECT_IDS` from `.env`.

```bash
npm run collect -- 87944794 87944512 87944475
npm run history
npm run history -- RUN_ID
```

The CLI now uses the same bounded worker as the HTTP server (up to three projects
at a time). It waits for completion and prints schema version 4, including a run ID,
requested-ID snapshot, project outcomes, complete evidence, and fixed baseline run IDs.
Historical evidence is never overwritten by a later attempt. A `completed` run means
execution finished, not that every project succeeded; inspect individual outcomes.

Exit codes: `0` all requested projects complete; `2` some project results partial or
failed; `1` configuration/storage/unexpected execution failure. On caught execution
failure, preserve already-recorded outcomes and mark remaining projects interrupted.
Collector startup marks unfinished work interrupted after taking exclusive ownership.
A hard-killed process leaves a lease that expires within 15 seconds. Wait and restart;
do not delete your database. Completed project evidence is retained.

## Start the asynchronous backend

```bash
npm start
```

The server binds to `http://127.0.0.1:3001`. It initializes/migrates your database,
acquires a collector lease, recovers old unfinished runs, and exposes the HTTP API.
`/health` reports phase 7 and whether a token is configured (never its value).

Keep the server running and use the HTTP API for collection. Do not run the collection
CLI concurrently against the same database; it will refuse ownership. Read-only
`npm run history` and selection inspection remain available in a second terminal.

See [HTTP API and PowerShell walkthrough](docs/http-api.md) for exact commands.
The built UI uses this API. Other clients can reconnect using `/api/runs/active`, then poll
`/api/runs/:id` about once per second. A POST returns 202 after the run is committed;
collection continues independently of the connection. Repeat starts return 409 with
an active run ID. Recovery creates an interrupted result rather than silently
replaying an old observation; start a new run explicitly after inspecting it.

## Verify without credentials

```bash
npm run verify
```

This runs all 77 backend tests, backend/frontend type checks, the production build,
and mocked failure/recovery assertions. For the additional automated browser checks:

```bash
npx playwright install chromium
npm run test:ui
```

`npm run verify` builds the UI first. Alternatively run `npm run build` before the
browser check. On Linux, Playwright may need system dependencies; see docs/frontend.md.
Individual commands remain available: `npm test`, `npm run typecheck`, `npm run build`,
and `npm run demo:verify`.

Tests use real local SQLite files and an ephemeral local GitLab HTTP mock. They run
the actual parsing, collection, pagination, and persistence logic. No GitLab access
or credentials are needed. Another-process history reads verify durable storage.

## Failure/recovery demo (no credentials)

```bash
npm run build
npm run demo:mock
```

Open the **URL printed by this command**. A complete synthetic baseline is saved;
click **Start collection** to see a partial 403 failure. Type `recover` in the demo
terminal, then collect again in the UI. Type `quit` to stop. This uses the real backend
with localhost mocked GitLab HTTP and its own temporary database, leaving your normal
configuration and history untouched. `npm run demo:verify` runs the credential-free
scenario assertions and writes synthetic JSON evidence.

See [demo walkthrough and live recording checklist](docs/demos.md). Live collection and
setting changes have been confirmed by the user; sanitized live media still needs
capturing before submission. The included mock evidence is explicitly synthetic.

## Recreate the three GitLab projects

1. Create a free GitLab.com account and three projects with synthetic names/content.
2. **Protected:** initialize with a README; protect the actual default branch in
   Settings > Repository > branch rules/protected branches.
3. **Unprotected:** initialize with a README; remove default-branch protection.
4. **Empty:** create without a README/template/commit. Do not push a commit.
5. Record numeric project IDs; use a token owned by an account with access to the
   project settings. Your own projects simplify verification.
6. Create a personal access token with `read_api`, no write scope, and suitable expiry.
7. Collect all three. Expect protected, unprotected, and no_default_branch, respectively.
8. Later, manually change a protection setting in GitLab for the comparison demo.
   Setup/admin actions are separate; the application only makes GET requests.

GitLab may report a configured `default_branch: "main"` even with `empty_repo: true`.
That is retained as metadata. The collector treats the repository as having no
existing default branch to assess and skips branch-specific configuration requests.

## Architecture, limits, verification

- [Architecture, tradeoffs, and production changes](docs/architecture.md)
- [Submission checklist](docs/submission.md)
- [Mocked and live demonstrations](docs/demos.md)
- [Frontend behavior and browser checks](docs/frontend.md)
- [Storage design and baseline policy](docs/storage-design.md)
- [GitLab API coverage](docs/api-coverage.md)
- [Implementation phases](docs/phase-status.md)
- [Test project verification](docs/test-projects.md)
- [Verification results](docs/verification.md)
- [Execution and recovery](docs/execution.md)
- [Comparison policy and meaningful changes](docs/comparison-policy.md)

One local user, one token, one database. SQLite uses short synchronous transactions
with WAL and a busy timeout; this is suitable for the assessment's small local data,
not a claim of high-throughput database execution. No transaction includes a network
request. No OAuth, cloud deployment, compliance scoring, or effective-user permission
calculation is implemented. Historical baseline references and field-level semantic comparisons are included.

## AI assistance

Codex/ChatGPT assisted implementation of the GitLab client, evidence collector,
persistence, HTTP API, worker/recovery logic, comparisons, React UI, demo, docs, and tests.
Verification included official provider/runtime documentation, TypeScript checks,
mocked GitLab HTTP exercising the real collector/SQLite/API, process lifecycle tests,
and automated browser workflows. Live tests on the seeded GitLab account confirmed
all three project states, persisted history, force-push changes in both directions,
and the corresponding UI comparisons. The empty-repository response exposed a real
edge case that was fixed and covered by a regression test. Failure/recovery was also
checked interactively using the isolated mock. See docs/verification.md for versions,
platform limits and provenance. The author should be prepared to explain and modify
the implementation; passing AI-assisted tests alone is not a production-readiness claim.

## Compare collections

The existing collection and history commands now include a comparison for each project.
It identifies its fixed baseline, lists actual before/after setting changes, and
separately describes availability changes. Equal settings in a different order do not
create differences. Unreadable settings never become confirmed removals.

With the server running, use PowerShell:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/runs/$($collection.run.id)/comparisons" | ConvertTo-Json -Depth 30
```

`$collection` is the POST response from your collection command. See the live change
walkthrough in docs/http-api.md. Preserve `.env` and `data/` when replacing project files.
The final checkpoint uses storage schema version 2 and does not rewrite stored observations.
