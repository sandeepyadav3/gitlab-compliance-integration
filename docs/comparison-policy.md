# Comparison policy (version 1)

## Fixed baseline and reproducibility

Each run/project already stores baselineRunId. Comparisons use that exact earlier
complete project observation, never a dynamically selected latest run. The baseline
must contain the same project, be complete, and have an earlier run sequence. A missing
or invalid recorded baseline yields unavailable, not a substitute comparison. A null
baseline means first observation. Complete project observations inside otherwise
interrupted runs are eligible under the existing storage policy.

Comparisons are pure, deterministic projections of immutable observations. They are
not written back into evidence_json and do not require a database migration. Results
include policyVersion=1, current/baseline run IDs, sequence, observation timestamps,
and confirmed branch information. Future semantic policy changes must bump the policy
version; use the matching code revision to reproduce that version's presentation.

## Meaningful fields

- Metadata: project name, URL and visibility, kept separate from protection settings.
- Repository: actual existing default branch, including empty-to-initialized transitions.
- Protection: GitLab-reported protected/unprotected/no_default_branch posture.
- Rules: matching exact and case-sensitive '*' wildcard protection patterns, configured
  push/merge/unprotect restrictions, force push, returned code-owner and inherited flags.

For empty repositories, configured default_branch metadata is preserved but is not
an existing branch. A configured-name change between two empty observations is a
metadata change. If branch lookup fails, configured names are not used to assert an
existing-branch change. References explicitly include defaultBranchKnown; null plus
false is unknown, whereas null plus true is a confirmed absence of an existing branch.

If the default branch changes, compare the confirmed branch and posture facts but
skip rule-level diffs across those different scopes. Show a notice explaining this;
do not describe the old branch's settings as removed from the new branch.

## Canonicalization

Rule IDs, access-row IDs, timestamps, source ordering, grant ordering, duplicate grants,
and display-description changes are excluded. Rules are matched by pattern name and
derived from the full collected configuration, not cached matchingRules. Unrelated
rules do not change the default branch's comparison.

Access entries use explicit user/group/deploy-key/custom-role IDs when present;
otherwise use numeric access_level. A role number attached to an explicitly named
principal is not independently interpreted as a grant to every member of that role.
No effective-user permission calculation or group-policy traversal is performed.
Role 0 (explicit no access) remains distinct from an empty returned array. A description
without a stable numeric principal/role is unknown, not a guessed permission.

## Unknown versus absent

A failed/partial rule list cannot prove a rule was removed. Rule addition/removal
requires two fully collected rule lists for the same confirmed default branch.
Ambiguous duplicate matching patterns are not arbitrarily merged and make a full
configuration comparison unavailable.

Optional fields missing in either snapshot create availability information, not
assumed false/empty values. Unknown -> known is newly observed, not a proven setting
change; known -> unknown is unavailable, not removed. Unknown in both observations is
listed in unavailableFields. Actual explicit boolean and empty-array values remain
known. A new/removed rule may include unknown markers for unavailable optional fields.

## Result states

| Status | Meaning |
| --- | --- |
| pending | Project work has not produced a completed observation |
| first_observation | Complete evidence with no earlier complete baseline |
| changed | Complete comparable evidence contains observed field/rule changes |
| unchanged | No change in comparable observed fields, not proof every setting is known |
| coverage_changed | Availability changed, with no observed setting difference |
| incomplete | Partial collection or ambiguous required comparison information |
| unavailable | No current result, failed/interrupted project, or invalid recorded baseline |

Partial results may list differences in successfully observed facts, but their overall
comparison remains incomplete. They cannot be presented as a full posture assessment.
Failures remain visible in the underlying evidence, and old successful evidence stays
available separately. None of these labels is a compliance score or a verdict that a
project is secure. Data collected at different times is not an atomic GitLab snapshot.
