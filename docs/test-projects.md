# User-provided test projects

| Project | ID | URL | Observed scenario |
| --- | --- | --- | --- |
| company-assistant | 87944475 | https://gitlab.com/personal-group1833443/company-assistant | Protected main |
| document-ingestion | 87944512 | https://gitlab.com/personal-group1833443/document-ingestion | Unprotected main |
| ecommerce-car-parts | 87944794 | https://gitlab.com/personal-group1833443/ecommerce-car-parts | Empty repository; configured main |

Evidence provenance: user supplied CLI output from authenticated live collection on
2026-10-22, starting 07:17:19 UTC. All projects were private. This was not a live run
performed in the coding workspace. No token was supplied here.

The protected project returned Maintainers (40) for push and merge restrictions,
force push false, code-owner approval false, inherited false, and an empty unprotect
access array. Preserve that array literally; do not infer effective permissions.
The unprotected project returned branch protected=false and a successful empty rule
list. The empty project returned empty_repo=true, default_branch=main, a branch 404,
and an empty protection list. Phase 1 incorrectly labeled that combination partial.
Phase 2 checks confirmed emptiness first, retains configured branch metadata, and
marks branch-specific evidence not_applicable. The response shape is covered by an HTTP regression test. The subsequent user-run
verification below confirms the fix against GitLab.com.

The user subsequently supplied a Phase 2 live run and matching history output:
run cf306a6e-07da-4997-8b68-d5c9a89ee4f6, collected 2026-10-22 07:31:07-07:31:11 UTC.
All three project results were complete, with no issues. The empty project correctly
reported no_default_branch and not_applicable branch/configuration observations.
Baseline IDs were null, correctly, for this first persisted run. This confirms the
empty-repository fix and a separate CLI history read on the user's machine. Phase 3
HTTP execution and restart handling still require a live user-side smoke check.

Phase 3 live HTTP output supplied in Pasted text(1).txt confirmed run
8b292169-02ab-434f-9fcd-ebb370494e31 (sequence 2), completed 2026-10-22
07:58:02 UTC. All three outcomes were complete, progress was 100%, interruptionReason
was null, and every project referenced baseline
cf306a6e-07da-4997-8b68-d5c9a89ee4f6. No protection setting change was demonstrated in
that output; it validates collection and persisted baseline assignment.

Phase 4 live follow-up: the user reported enabling force push on the protected project,
collecting and observing the setting/change, then disabling it and observing the reverse
change on a new collection. This is user-reported validation of both directions, not
a live call or a recorded demonstration from the coding environment.

Phase 5 live follow-up: the user ran the built UI, confirmed all three project
collection details, and confirmed the correct changes in their respective runs. This
is user-reported verification; no live screenshot or recording was supplied here.
