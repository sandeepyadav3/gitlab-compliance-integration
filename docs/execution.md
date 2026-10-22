# Execution and recovery

## Acceptance and progress

The API commits a queued run, requested-project rows, and fixed baselines before
returning 202. A scheduled task starts it outside the request handler. Clients can
close their connection or refresh; collection belongs to the server, not the browser.
A later client discovers the active ID and polls stored state. One run is accepted at
a time; a transactional idle check and in-process task guard reject duplicate starts.

Three worker loops claim distinct projects; each project's dependent API requests are
sequential. No network call occurs inside a SQLite transaction. Each project enters
running, then its complete/partial/failed observation is immediately saved. Run output
stays in requested order even if projects finish in another order. Expected provider
errors produce failed/partial evidence and do not stop unrelated projects.

## Limits and cancellation

Each provider request has the existing timeout and bounded retry policy. A full run
has a 120-second deadline, including retries and pagination. Deadline or shutdown
aborts active fetch and retry sleeps. Workers are joined before terminalizing the run;
no task can write after the service has released ownership. Reads that already returned
are checkpointed. Interrupt and startup recovery promote those checkpoints to partial
or failed evidence. Projects with no checkpoint stay interrupted and empty. Earlier
completed project snapshots survive. A checkpoint is not a resume cursor: startup does
not continue the old run. Unexpected execution errors
interrupt unfinished work with a safe reason; exception text is never logged.

## Ownership and crash recovery

One SQLite lease protects the database's collector role across HTTP and CLI processes.
It expires after 15 seconds and renews every 3 seconds. Acquisition is transactional;
an existing live lease prevents a second collector from recovering or modifying its
work. All run/project execution writes verify lease ownership and expiry inside their
SQLite write transaction. This fences old workers after another process takes over.
An old process cannot release a new owner's lease. History reads do not acquire ownership
or recover runs. Selection edits remain allowed and cannot change an active snapshot.

After taking ownership, startup atomically marks queued/running runs interrupted with
reason server_restart and only their unfinished projects interrupted. Terminal results
and baseline references remain intact. No old collection is automatically replayed;
the analyst starts a new run, preserving the meaning of each observation window.
A process hard kill may require waiting up to 15 seconds before restart. This uses a
local wall clock and assumes one machine, not distributed clock synchronization.

Graceful shutdown stops accepting HTTP traffic, aborts collection, stores interrupted
outcomes with server_shutdown, releases the lease, then closes SQLite. Lease loss
makes the worker unavailable and cancels ongoing work; the new owner performs recovery.

## Migration and observability

Schema version 2 adds a nullable interruption_reason column and a collector_lease table.
Schema version 3 adds collection_checkpoints for in-flight reads.
Version 1 run IDs, evidence JSON, timestamps, and baseline references are retained.
No reset or deletion is performed.

Structured JSON events report startup/recovery counts, run/project outcomes, duration,
and safe request IDs/statuses. Logs omit tokens, headers, provider response bodies,
request bodies, exception strings, full request URLs, and stack traces. HTTP logs
are intentionally minimal. API evidence itself contains the requested project metadata.

## Scope limits

This is an in-process worker using persisted state with explicit interruption recovery,
not a distributed job system. Small synchronous SQLite writes and response serialization
run on the Node event loop. Database busy timeout is five seconds; this implementation
does not claim high-load multi-process throughput. The service must remain local.
No automatic run-level retry or scheduler is implemented. The later React UI uses
the same durable execution and progress API.
