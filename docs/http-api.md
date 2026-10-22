# HTTP API

Base URL: `http://127.0.0.1:3001`. Token stays on the server. JSON bodies only;
16 KiB maximum, 1-25 project IDs. The API accepts numeric IDs, not GitLab URLs or tokens.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/health` | Local liveness and token-configured flag |
| GET | `/api/selection` | Saved project IDs and update time |
| PUT | `/api/selection` | Save `{ "projectIds": [123,456] }` |
| POST | `/api/runs` | Queue `{ "projectIds": [123,456] }` or `{}` for saved selection; return 202 and Location |
| GET | `/api/runs/active` | `{ "run": ... }` or `{ "run": null }` for refresh/reconnection |
| GET | `/api/runs/:id` | Full immutable results so far and progress counters |
| GET | `/api/runs?limit=20` | Most recent runs, newest first; limit 1-100 |
| GET | `/api/projects/:id` | Latest attempt and last complete evidence, separately |
| GET | `/api/projects/:id/history?limit=20` | Historical project outcomes with run references |

POST IDs affect that run only. PUT changes the saved selection. Each run retains the
selection snapshot it was created with. Environment `GITLAB_PROJECT_IDS` is a CLI
default, not a browser/API selection source. The HTTP server reads the same SQLite database.

## Windows PowerShell walkthrough

With the server running (`npm start` after `npm ci`, `npm run db:setup`, and `npm run build`), use PowerShell:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3001/health'

Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/selection' -Method Put -ContentType 'application/json' -Body '{"projectIds":[87944794,87944512,87944475]}'

$collection = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/runs' -Method Post -ContentType 'application/json' -Body '{}'
$collection.run.id

Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/runs/$($collection.run.id)" | ConvertTo-Json -Depth 30

Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/runs/active' | ConvertTo-Json -Depth 30

Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/runs?limit=5' | ConvertTo-Json -Depth 30
```

Repeat the run-detail GET until status is completed or interrupted. After completion,
start a second run; its project baseline references should point to the prior complete
observations. `npm run history` also works while the HTTP server is running.

## Interpretation and errors

Run states: queued, running, completed, interrupted. Project states: pending, running,
complete, partial, failed, interrupted. `completed` means execution finished, not that
all evidence succeeded. Progress includes total, finished, each state count, and percent;
interrupted projects count as finished execution, not successful evidence.

Errors use `{ "error": { "code", "message", "requestId" } }`:
- 400 invalid selection, malformed JSON, missing saved selection, or invalid history limit.
- 403 unapproved browser origin; 421 wrong Host.
- 404 unknown route/run; this is separate from GitLab resource failures stored in evidence.
- 409 collection already active; includes `activeRunId` for reconnection.
- 413 oversized JSON; 415 wrong content type; 408 request-body deadline exceeded.
- 503 token missing or collector unavailable.
- 500 sanitized unexpected local failure.

Local requests are restricted to the server's localhost/127.0.0.1 Host and known browser
origins, including the Vite dev server on localhost/127.0.0.1:5173. No sign-in is provided:
this is a one-user local assessment, not a remotely exposed authenticated service.

## Comparisons

Each run project's JSON contains `comparison`, including its status, human-readable
summary, fixed baseline reference, categorized changes, coverage changes, and notices.
Run detail/history, project detail/history, and CLI history include this projection.
For a concise comparison response use:

`GET /api/runs/:id/comparisons`

Comparisons are derived from stored observations. A saved baseline is used when one exists; evidence is not rewritten.

### Live change walkthrough (synthetic projects only)

1. Collect a fresh baseline through POST /api/runs and wait for completion.
2. In GitLab's UI, open company-assistant (87944475), Settings > Repository, and edit
   the main branch's protection rule. Change only the force-push allowance from its
   baseline value. UI labels may vary; the relevant API field is allow_force_push.
3. Start another collection and wait for completion.
4. Inspect its comparison using PowerShell:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/runs/$($collection.run.id)/comparisons" | ConvertTo-Json -Depth 30
```

Here `$collection` must refer to the POST response for the new run, not the baseline.
The protected project's comparison should be changed with a field such as
`rules["main"].allowForcePush`, showing actual before/after booleans and a baseline
run ID. Unmodified projects should be unchanged. Collect once more without edits to
see unchanged against the immediately previous complete observation. Restore the
setting manually afterward if desired; the collector remains GET-only throughout.

See comparison-policy.md for missing fields, partial failures, normalization, and
branch-scope decisions. Full comparison views do not claim settings were absent just
because a GitLab call failed.

## Built UI

`npm run build` creates the React client; `npm start` serves it at the backend root.
`GET /health` reports status and whether a token is configured. It has no phase field. Storage schema is 3. The CLI JSON shape is output contract 4. Existing API contracts and PowerShell collection
commands remain available. See frontend.md for UI behavior and optional dev setup.
