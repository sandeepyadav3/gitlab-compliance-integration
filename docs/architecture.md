# Architecture and engineering decisions

## Components and data flow

React/TypeScript uses the same-origin HTTP API. The Node server serves the built UI,
validates selections, accepts runs, and returns saved progress/history. CollectionService
owns background execution and a renewable SQLite lease. GitLabClient handles only GET
requests to fixed GitLab.com API paths; the collector validates selected response fields
and combines them into an evidence snapshot. EvidenceStore persists immutable outcomes.
Pure comparison functions derive API/CLI changes against stored baseline references.

Production code is under `src/`, the client under `web/`, credential-free tests under
`tests/`, and explicitly mocked development entry points under `demo/`. The demo injects
a localhost HTTP transport through the shared test harness. Production configuration
does not accept an alternative GitLab base URL. No provider token reaches the browser.

## Decisions and tradeoffs

| Decision | Reason and tradeoff |
| --- | --- |
| Native HTTP + Zod | Small API surface; strict runtime validation without a server framework. Routing, body bounds and error handling remain explicit. |
| Native node:sqlite, WAL | Simple durable local setup without native build dependencies. Short synchronous writes can still block the event loop; intentionally small local scope. |
| One leased in-process collector | Durable acceptance, bounded execution and crash interruption without external infrastructure. Restart does not resume half-observed work automatically. |
| Three project workers | Independent projects progress concurrently; dependent requests within a project remain sequential. Results retain requested order. |
| Evidence JSON plus relational lifecycle columns | Preserves partial fields/provenance faithfully while indexing history/baselines. Large histories cost more serialization and disk space. |
| Fixed last-complete baseline per project | Failures cannot replace a usable baseline; comparisons are reproducible. Changes between two snapshots cannot explain every intermediate provider event. |
| Separate known values and coverage changes | Missing/denied fields never become false or deleted. Some comparisons remain incomplete rather than claiming certainty. |
| Bounded polling | Refresh/reconnection works with a small API; less infrastructure than WebSockets/SSE, with modest extra local requests. |
| Browser stale warning after 24h | Makes evidence age visible; a product policy, not a provider guarantee or automatic compliance judgment. |

SQLite tables include saved selection, runs, ordered run projects and the collector lease.
Run creation freezes requested IDs and baselines transactionally. Every requested project
receives a terminal outcome. Completed observations are protected by database constraints
and triggers. Schema migrations retain prior IDs and snapshots. See storage-design.md.

## Highest-risk verification

Tests prioritize API ambiguity (403/404, schema mismatch, configured branch on an empty
repository), bounded retries/timeouts/pagination, cross-process ownership/recovery, and
immutable history/baselines. Pure comparison cases reject ordering/ID noise and false
removals from partial lists. Integration tests exercise real parsing, collection, SQLite
and API boundaries with HTTP fixtures. Browser tests verify successful/partial collection,
refresh reconnection, recovery, honest historical fallback, offline retention and escaping.
The interactive mocked demo makes these failure semantics reviewable without inducing
real provider failures. It supplements rather than replaces the live GitLab walkthrough.

## Assumptions and known limitations

- One trusted local user, one token and one local machine. Loopback Host/origin checks
  help local boundaries but do not provide authentication. Do not expose this server.
- No effective-user permissions, source-code collection, separate group-policy traversal,
  OAuth, scheduling, compliance scoring, multi-tenancy, paid-tier assumptions or cloud deployment.
- GitLab responses are sequential observations, not an atomic provider snapshot.
  Contradictory evidence remains partial. Missing optional/tier-dependent fields remain unknown.
- Limits are 25 selected IDs, 3 project workers, 20 rule pages of 100 items, 10 seconds
  per provider request, 3 attempts, and a 120-second run deadline. Long Retry-After is
  surfaced rather than retried early. API JSON input is limited to 16 KiB.
- Provider JSON is parsed in memory; no streaming parser or explicit provider response-byte
  cap is implemented. Large responses/history can consume memory. History requests return
  at most 100 runs; the UI shows that recent window rather than unlimited pagination.
- Local history has no retention/deletion policy. In-flight reads are checkpointed and
  promoted to partial or failed evidence on interrupt or restart. Projects that have not
  returned a read stay interrupted. Collection does not resume an old run.
- Node 22 native SQLite/type stripping is experimental. Linux Node 22/24 was checked.
  Browser qualification is recorded in verification.md.

## Priorities before a production deployment

Keep the assessment scope unchanged. For a real hosted service, first add authentication,
project-level authorization, tenant isolation and managed secret storage. Add explicit
provider response size bounds, data retention/privacy rules, encryption/backups and restore
verification. Move sustained workloads to a durable queue and a database appropriate for
multiple workers; retain idempotency, ownership fencing and immutable evidence semantics.
Add metrics/alerts for queue age, latency, provider failures and interruptions, with redacted
structured logs. Add CI on supported operating systems and the matching browser version,
provider-contract regression fixtures, load tests and deployment health checks. These are
future changes, not capabilities claimed by this local assessment implementation.
