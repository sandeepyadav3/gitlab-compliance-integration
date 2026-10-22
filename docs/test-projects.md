# Seeded test projects

| Project | ID | URL | Observed scenario |
| --- | --- | --- | --- |
| company-assistant | 87944475 | https://gitlab.com/personal-group1833443/company-assistant | Protected main |
| document-ingestion | 87944512 | https://gitlab.com/personal-group1833443/document-ingestion | Unprotected main |
| ecommerce-car-parts | 87944794 | https://gitlab.com/personal-group1833443/ecommerce-car-parts | Empty repository; configured main |

Evidence provenance: authenticated live collection on 2026-10-22, starting 07:17:19 UTC.
All projects were private. No token is stored in this repository.

The protected project returned Maintainers (40) for push and merge restrictions,
force push false, code-owner approval false, inherited false, and an empty unprotect
access array. Preserve that array literally; do not infer effective permissions.
The unprotected project returned branch protected=false and a successful empty rule
list. The empty project returned empty_repo=true and default_branch=main. The collector
keeps that name as metadata, treats the repository as having no existing default branch,
and does not request branch or protection configuration. An HTTP regression test covers
that response shape.

Live run cf306a6e-07da-4997-8b68-d5c9a89ee4f6, collected 2026-10-22 07:31:07-07:31:11 UTC,
confirmed the fix. All three project results were complete, with no issues. The empty
project reported no_default_branch and not_applicable branch/configuration observations.
Baseline IDs were null, correctly, for this first persisted run. A separate CLI history
read returned the same completed run.

HTTP run 8b292169-02ab-434f-9fcd-ebb370494e31 (sequence 2), completed 2026-10-22
07:58:02 UTC, confirmed a later collection. All three outcomes were complete, progress
was 100%, interruptionReason was null, and every project referenced baseline
cf306a6e-07da-4997-8b68-d5c9a89ee4f6. No protection setting change was demonstrated
in that output; it validates collection and persisted baseline assignment.

A later live pass enabled force push on the protected project, collected, and observed
the setting change, then disabled it and observed the reverse change on a new collection.
That validates both directions.

The built UI was then used to collect all three projects and to confirm the changes on
their respective runs.
