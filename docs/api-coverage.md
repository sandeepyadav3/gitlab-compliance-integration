# GitLab API coverage

Documentation checked: 2026-10-22. GitLab documentation evolves; real responses from
the seeded free-tier projects must be verified before describing live coverage as tested.

| Endpoint | Evidence retained |
| --- | --- |
| `GET /projects/:id` | stable ID, name, web URL, visibility, default branch, empty-repository flag |
| `GET /projects/:id/repository/branches/:branch` | branch name and GitLab-reported protected boolean |
| `GET /projects/:id/protected_branches?per_page=100&page=N` | rule ID/name, push/merge restrictions, unprotect restrictions when returned, force-push setting, optional code-owner and inheritance fields |

Sources:
- https://docs.gitlab.com/api/projects/
- https://docs.gitlab.com/api/branches/
- https://docs.gitlab.com/api/protected_branches/
- https://docs.gitlab.com/api/rest/
- https://docs.gitlab.com/api/rest/troubleshooting/
- https://docs.gitlab.com/user/profile/personal_access_tokens/

## Honest evidence

- `protected` comes from the Branches API, not an inferred rule lookup.
- All protection rules are listed; exact and `*` wildcard rules matching the default
  branch are retained. Matching is case-sensitive; non-asterisk regex characters are
  literal. This is pattern association, not effective-user permission calculation.
- Pagination follows `X-Next-Page`. If absent, a full 100-item page triggers a further
  page request. Empty final results are legitimate. Pagination is capped at 20 pages;
  malformed/looping pagination or a failed later page remains visibly incomplete.
- Optional or tier-dependent fields remain absent if not returned. Missing does not
  become false. Inheritance is recorded only when exposed; no group traversal occurs.
- Complete protection lists are retained alongside matching rules so observations can
  be inspected later. Unrelated rule changes should not become default-branch diffs.
- A 403/404 on a setting does not prove that protection is absent. Project metadata
  and successfully collected rule pages survive later failures.
- If `empty_repo: true`, classify as `no_default_branch` even when a configured
  `default_branch` name is returned. Keep that name as metadata; no existing branch
  is inferred and branch-specific requests are skipped. Null default branch without
  confirmed emptiness remains partial and unknown.
- Project and branch identities are validated. Contradictory status/configuration
  remains partial. GitLab can change between requests; collection is not atomic.
- Sources record collection timestamps, sanitized URL, HTTP status, attempt count,
  and a safe error/action. Provider response bodies and arbitrary exception text are
  never forwarded. Commit/source contents and token headers are not retained.

## Request execution

Only GET against a fixed GitLab.com origin is permitted by the client. Redirects are
rejected to avoid forwarding credentials. Branch names are URL-encoded. Each request
has a 10-second timeout covering headers and response JSON parsing. At most three
attempts are made for network failures, timeouts, 429, and 500/502/503/504. Other HTTP
failures and schema failures are not retried.

Backoff includes jitter. Retry-After seconds or HTTP dates are honored. If a requested
wait exceeds five seconds, return the rate-limit/provider failure without retrying
prematurely. The background worker has a 120-second run deadline; waits are bounded. Selection is capped at 25 IDs and rule listing at 2,000
items per project. No promise of large-organization throughput is made.
