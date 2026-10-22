import type { Run, RunProject } from '../storage/store.ts';
import type { ProjectEvidence, ProtectionRule } from '../gitlab/types.ts';
import { matchesRule } from '../gitlab/collector.ts';

export const COMPARISON_POLICY_VERSION = 1;
export type ComparisonStatus = 'pending' | 'first_observation' | 'changed' | 'unchanged'
  | 'coverage_changed' | 'incomplete' | 'unavailable';
export interface Reference { runId: string; sequence: number; observedAt: string | null; defaultBranch: string | null; defaultBranchKnown: boolean; }
export interface Change {
  category: 'metadata' | 'repository' | 'protection';
  field: string; label: string; kind: 'changed' | 'added' | 'removed'; before: unknown; after: unknown;
}
export interface CoverageChange { field: string; label: string; before: 'known' | 'unknown'; after: 'known' | 'unknown'; message: string; }
export interface Comparison {
  policyVersion: number; status: ComparisonStatus; summary: string;
  current: Reference; baselineRunId: string | null; baseline: Reference | null;
  changes: Change[]; coverageChanges: CoverageChange[]; unavailableFields: string[]; notices: string[];
}
const unknownValue = Symbol('unknown');
type Value = unknown;
function reference(run: Run, project: RunProject): Reference {
  const branch = project.evidence ? existingBranch(project.evidence) : unknownValue;
  return { runId: run.id, sequence: run.sequence, observedAt: project.evidence?.finishedAt ?? null,
    defaultBranch: typeof branch === 'string' ? branch : null, defaultBranchKnown: branch !== unknownValue };
}
function knownProject(evidence: ProjectEvidence) {
  return evidence.project.status === 'collected' && evidence.project.value?.id === evidence.requestedProjectId ? evidence.project.value : null;
}
function posture(evidence: ProjectEvidence): Value {
  const project = knownProject(evidence);
  if (!project) return unknownValue;
  if (project.empty_repo === true) return 'no_default_branch';
  if (evidence.issues.length || evidence.branch.status !== 'collected'
    || evidence.branch.value?.name !== project.default_branch) return unknownValue;
  return evidence.branch.value.protected ? 'protected' : 'unprotected';
}
function existingBranch(evidence: ProjectEvidence): Value {
  const project = knownProject(evidence);
  if (!project) return unknownValue;
  if (project.empty_repo === true) return null;
  return evidence.branch.status === 'collected' && evidence.branch.value?.name === project.default_branch
    ? evidence.branch.value.name : unknownValue;
}
function accessValues(levels: ProtectionRule['push_access_levels'] | undefined): Value {
  if (levels === undefined) return unknownValue;
  const values: string[] = [];
  for (const level of levels) {
    const subjects = (['user_id', 'group_id', 'deploy_key_id', 'member_role_id'] as const)
      .filter(key => typeof level[key] === 'number').map(key => `${key}:${level[key]}`);
    if (subjects.length) values.push(subjects.sort().join(','));
    else if (typeof level.access_level === 'number') values.push(`role:${level.access_level}`);
    else return unknownValue; // A description alone is not a stable permission identity.
  }
  return [...new Set(values)].sort();
}
function normalized(rule: ProtectionRule): Record<string, Value> {
  return {
    pushAccess: accessValues(rule.push_access_levels), mergeAccess: accessValues(rule.merge_access_levels),
    unprotectAccess: accessValues(rule.unprotect_access_levels), allowForcePush: rule.allow_force_push,
    codeOwnerApprovalRequired: rule.code_owner_approval_required ?? unknownValue,
    inherited: rule.inherited ?? unknownValue,
  };
}
function serializableRule(rule: ProtectionRule): Record<string, unknown> {
  return Object.fromEntries(Object.entries(normalized(rule)).map(([key, value]) => [key,
    value === unknownValue ? { availability: 'unknown' } : value]));
}
function ruleMap(evidence: ProjectEvidence): Map<string, ProtectionRule> | null {
  const branch = existingBranch(evidence);
  if (typeof branch !== 'string' || evidence.protectionRules.status !== 'collected'
    || evidence.protectionRules.value === null || evidence.issues.length) return null;
  const map = new Map<string, ProtectionRule>();
  for (const rule of evidence.protectionRules.value.filter(rule => matchesRule(rule.name, branch))) {
    if (map.has(rule.name)) return null; // Ambiguous duplicate patterns are not arbitrarily merged.
    map.set(rule.name, rule);
  }
  return map;
}
export function compareProject(currentRun: Run, current: RunProject, baselineRun: Run | null): Comparison {
  const result: Comparison = { policyVersion: COMPARISON_POLICY_VERSION, status: 'unavailable', summary: '',
    current: reference(currentRun, current), baselineRunId: current.baselineRunId, baseline: null,
    changes: [], coverageChanges: [], unavailableFields: [], notices: [] };
  const baseline = baselineRun?.projects.find(project => project.projectId === current.projectId);
  const validBaseline = baselineRun && baseline && baselineRun.id === current.baselineRunId
    && baselineRun.sequence < currentRun.sequence && baseline.state === 'complete'
    && baseline.evidence?.outcome === 'complete';
  if (validBaseline) result.baseline = reference(baselineRun, baseline);
  if (current.state === 'pending' || current.state === 'running') {
    result.status = 'pending'; result.summary = 'Collection has not produced a completed project observation yet.'; return result;
  }
  if (!current.evidence || current.state === 'failed' || current.state === 'interrupted') {
    result.summary = 'Current evidence is unavailable. Older evidence does not establish the current protection state.'; return result;
  }
  if (!current.baselineRunId) {
    result.status = current.state === 'complete' ? 'first_observation' : 'incomplete';
    result.summary = current.state === 'complete' ? 'First complete observation; no earlier complete baseline exists.'
      : 'First observation is incomplete; no protection change can be established.';
    return result;
  }
  if (!validBaseline) {
    result.summary = 'The recorded baseline is missing or invalid. No substitute baseline was selected.'; return result;
  }
  const before = baseline.evidence!; const after = current.evidence;
  let incompleteComparison = false;
  const field = (category: Change['category'], path: string, label: string, left: Value, right: Value) => {
    if (left === unknownValue || right === unknownValue) {
      result.unavailableFields.push(path);
      if ((left === unknownValue) !== (right === unknownValue)) {
        result.coverageChanges.push({ field: path, label, before: left === unknownValue ? 'unknown' : 'known', after: right === unknownValue ? 'unknown' : 'known',
          message: right === unknownValue ? 'Previously observed information is unavailable now; no setting removal is inferred.'
            : 'Information is newly available; no prior value is assumed.' });
      }
    } else if (JSON.stringify(left) !== JSON.stringify(right)) {
      result.changes.push({ category, field: path, label, kind: 'changed', before: left, after: right });
    }
  };
  const leftProject = knownProject(before); const rightProject = knownProject(after);
  for (const key of ['name', 'web_url', 'visibility'] as const) {
    field('metadata', `project.${key}`, { name: 'Project name', web_url: 'Project URL', visibility: 'Visibility' }[key],
      leftProject?.[key] ?? unknownValue, rightProject?.[key] ?? unknownValue);
  }
  const leftBranch = existingBranch(before); const rightBranch = existingBranch(after);
  field('repository', 'defaultBranch', 'Existing default branch', leftBranch, rightBranch);
  field('protection', 'posture', 'GitLab-reported protection posture', posture(before), posture(after));
  if (leftBranch === null && rightBranch === null) {
    field('metadata', 'project.configuredDefaultBranch', 'Configured branch name for an empty repository',
      leftProject ? leftProject.default_branch : unknownValue, rightProject ? rightProject.default_branch : unknownValue);
    result.notices.push('Both repositories are empty; branch protection configuration is not applicable.');
  } else if (typeof leftBranch === 'string' && leftBranch === rightBranch) {
    const leftRules = ruleMap(before); const rightRules = ruleMap(after);
    if (!leftRules || !rightRules) {
      incompleteComparison = true;
      field('protection', 'rules', 'Default-branch protection configuration', leftRules ? 'collected' : unknownValue, rightRules ? 'collected' : unknownValue);
      result.notices.push('Configuration comparison is incomplete or ambiguous; missing rules are not treated as removed.');
    } else {
      const names = [...new Set([...leftRules.keys(), ...rightRules.keys()])].sort();
      for (const name of names) {
        const left = leftRules.get(name); const right = rightRules.get(name);
        const path = `rules[${JSON.stringify(name)}]`;
        if (!left || !right) {
          result.changes.push({ category: 'protection', field: path, label: `Matching protection rule ${name}`,
            kind: left ? 'removed' : 'added', before: left ? serializableRule(left) : null, after: right ? serializableRule(right) : null });
        } else {
          const leftNormalized = normalized(left); const rightNormalized = normalized(right);
          const labels: Record<string, string> = { pushAccess: 'Allowed to push', mergeAccess: 'Allowed to merge',
            unprotectAccess: 'Allowed to unprotect', allowForcePush: 'Force push allowed', codeOwnerApprovalRequired: 'Code owner approval required', inherited: 'Inherited setting' };
          for (const key of Object.keys(leftNormalized)) field('protection', `${path}.${key}`, `${name}: ${labels[key]}`, leftNormalized[key], rightNormalized[key]);
        }
      }
    }
  } else {
    if (leftBranch === unknownValue || rightBranch === unknownValue) incompleteComparison = true;
    result.notices.push('The default branch changed or could not be established. Rule-level settings are not compared across different branch scopes.');
  }
  if (current.state === 'partial' || after.outcome !== 'complete' || incompleteComparison) {
    result.status = 'incomplete'; result.summary = 'A full protection comparison is unavailable. Listed differences concern observed facts only.';
  } else if (result.changes.length) {
    result.status = 'changed'; result.summary = `${result.changes.length} observed change(s) compared with the recorded baseline.`;
  } else if (result.coverageChanges.length) {
    result.status = 'coverage_changed'; result.summary = 'Evidence availability changed; no setting change was established in comparable fields.';
  } else {
    result.status = 'unchanged'; result.summary = 'No changes in comparable observed fields.';
  }
  if (result.unavailableFields.length) result.notices.push('Unavailable fields are not assumed to be false or empty.');
  return result;
}
