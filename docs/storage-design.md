# Storage and history

## Tables

- `collector_lease`: current owner, expiry and renewal for fenced execution writes.
- `selection`: one saved ID array and modification timestamp.
- `runs`: UUID, increasing sequence, immutable requested IDs, execution state and times.
- `run_projects`: every requested ID, position, state, immutable baseline run ID, and
  a selected evidence JSON snapshot containing source observations and safe errors.

Selected evidence is one JSON document per run/project so partially collected fields,
source timestamps, and errors round-trip without flattening away availability. The
indexed relational columns support lifecycle and baseline queries. Source code,
commit contents, token headers, and provider error bodies are never persisted.

Migrations use `PRAGMA user_version`. Schema versions 1 and 2 are applied transactionally on a new
database; newer unsupported versions fail without resetting data. Foreign keys,
check constraints, unique positions and immutable-history triggers enforce key rules.
SQL arguments are parameterized. Run creation and baseline assignment are atomic.
Schema setup is idempotent. There is no destructive reset command.

## States and history

Runs: queued -> running -> completed, or queued/running -> interrupted.
Projects: pending/running -> complete/partial/failed, or unfinished -> interrupted.
`completed` is execution completion, not a successful evidence guarantee. A run cannot
complete until every requested project has a terminal outcome. Repeated collection
always creates a new run; project outcomes cannot be overwritten or deleted.

The CLI and HTTP server now share the Phase 3 bounded worker. A SQLite lease gates
collector ownership, and startup recovery explicitly interrupts unfinished work.
Opening a history reader never performs recovery. See execution.md for lease,
cancellation, concurrency, and restart decisions. Completed/partial/failed observations
remain immutable through migration and recovery.

## Baselines

For each project, choose the complete observation from the highest earlier run
sequence available at the moment the new run is created. Persist its run ID. Partial,
failed, pending, and interrupted project entries are excluded. A complete project
observation in an otherwise interrupted run remains eligible: that project finished
successfully, even though other work did not. Empty-repository observations count as
complete observations. Later collections cannot silently change an existing baseline.

`getLatestProjectState` returns the latest attempt and last complete observation
separately, each with its run ID. Older complete evidence must be labeled historical,
not displayed as if it came from a failed latest attempt. `getProjectHistory` returns
run references and immutable project snapshots. Phase 4 derives deterministic comparisons without modifying stored observations.
The Phase 5 UI labels evidence older than 24 hours as stale. This is a display policy,
not a claim that provider settings have changed; timestamps and recollection remain available.

## Upgrade from Phase 1

Replace code/package/lock/docs with the latest checkpoint, preserve `.env` and `data/`, then run
`npm ci`, `npm run db:setup`, and `npm run collect`. Phase 1 did not persist results;
its console output is not imported automatically. A fresh collection establishes the
first baseline observation. Back up the entire SQLite database consistently if moving
it while open; use a clean shutdown rather than copying just the main WAL-backed file.
