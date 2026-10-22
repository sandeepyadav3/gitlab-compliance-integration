import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareProject } from '../src/comparison/compare.ts';
import type { ProjectEvidence, ProtectionRule } from '../src/gitlab/types.ts';
import type { Run, RunProject } from '../src/storage/store.ts';

function rule(): ProtectionRule {
  return { id: 9, name: 'main', push_access_levels: [{ access_level: 40, access_level_description: 'Maintainers' }],
    merge_access_levels: [{ access_level: 40 }], unprotect_access_levels: [], allow_force_push: false,
    code_owner_approval_required: false, inherited: false };
}
function evidence(): ProjectEvidence {
  return { requestedProjectId: 101, startedAt: '2026-10-22T07:00:00.000Z', finishedAt: '2026-10-22T07:00:01.000Z',
    outcome: 'complete', posture: 'protected', project: { status: 'collected', value: { id: 101, name: 'Synthetic', web_url: 'https://gitlab.com/test/synthetic',
      visibility: 'private', default_branch: 'main', empty_repo: false }, sources: [] },
    branch: { status: 'collected', value: { name: 'main', protected: true }, sources: [] },
    protectionRules: { status: 'collected', value: [rule()], sources: [] }, matchingRules: [rule()], issues: [] };
}
function run(id: string, sequence: number, input: ProjectEvidence, baseline: string | null = null): Run {
  return { id, sequence, requestedProjectIds: [101], status: 'completed', createdAt: input.startedAt, startedAt: input.startedAt,
    finishedAt: input.finishedAt, interruptionReason: null, projects: [{ projectId: 101, state: input.outcome, baselineRunId: baseline, evidence: input }] };
}
function pair() {
  const before = evidence(); const after = evidence();
  const baseline = run('baseline', 1, before); const current = run('current', 2, after, 'baseline');
  return { before, after, baseline, current, compare: () => compareProject(current, current.projects[0]!, baseline) };
}
function unprotected(input: ProjectEvidence) {
  input.posture = 'unprotected'; input.branch.value!.protected = false;
  input.protectionRules.value = []; input.matchingRules = [];
}
function empty(input: ProjectEvidence) {
  input.posture = 'no_default_branch'; input.project.value!.empty_repo = true;
  input.branch = { status: 'not_applicable', value: null, sources: [] };
  input.protectionRules = { status: 'not_applicable', value: null, sources: [] }; input.matchingRules = [];
}
test('first observation has an explicit null baseline without invented differences', () => {
  const current = run('first', 1, evidence());
  const result = compareProject(current, current.projects[0]!, null);
  assert.equal(result.status, 'first_observation'); assert.equal(result.baseline, null); assert.deepEqual(result.changes, []);
});
test('identical snapshots are unchanged despite timestamps, source differences, and rule IDs', () => {
  const p = pair(); p.after.finishedAt = '2026-10-22T08:00:01.000Z'; p.after.protectionRules.value![0]!.id = 999;
  p.after.protectionRules.value![0]!.push_access_levels[0]!.access_level_description = 'Localized label';
  const result = p.compare(); assert.equal(result.status, 'unchanged'); assert.equal(result.changes.length, 0);
  assert.equal(result.baseline?.runId, 'baseline'); assert.equal(result.current.observedAt, p.after.finishedAt);
});
test('rule and access ordering, duplicate grants, and unrelated rules do not create noise', () => {
  const p = pair(); const wildcard = { ...rule(), id: 10, name: 'm*' };
  p.before.protectionRules.value!.push(wildcard); p.after.protectionRules.value!.unshift(wildcard);
  p.before.protectionRules.value![0]!.push_access_levels.push({ access_level: 30 });
  p.after.protectionRules.value![1]!.push_access_levels.unshift({ access_level: 30 });
  p.after.protectionRules.value![1]!.push_access_levels.push({ access_level: 40 });
  p.after.protectionRules.value!.push({ ...rule(), name: 'unrelated/*' });
  assert.equal(p.compare().status, 'unchanged');
});
test('force-push changes are field-level differences with before and after values', () => {
  const p = pair(); p.after.protectionRules.value![0]!.allow_force_push = true;
  const result = p.compare(); assert.equal(result.status, 'changed');
  assert.deepEqual(result.changes[0], { category: 'protection', field: 'rules["main"].allowForcePush', label: 'main: Force push allowed', kind: 'changed', before: false, after: true });
});
test('numeric access restrictions change even when descriptions remain the same', () => {
  const p = pair(); p.after.protectionRules.value![0]!.push_access_levels = [{ access_level: 30, access_level_description: 'Maintainers' }];
  const change = p.compare().changes[0]!;
  assert.deepEqual(change.before, ['role:40']); assert.deepEqual(change.after, ['role:30']);
});
test('specific users, groups, deploy keys and custom roles retain stable principal identities', () => {
  const p = pair();
  p.before.protectionRules.value![0]!.push_access_levels = [{ user_id: 10, access_level: 40 }, { group_id: 20 }, { deploy_key_id: 30 }, { member_role_id: 40 }];
  p.after.protectionRules.value![0]!.push_access_levels = [{ member_role_id: 40 }, { deploy_key_id: 30 }, { group_id: 20 }, { user_id: 11, access_level: 40 }];
  assert.equal(p.compare().changes.length, 1);
  assert.ok(JSON.stringify(p.compare().changes[0]?.before).includes('user_id:10'));
  assert.ok(JSON.stringify(p.compare().changes[0]?.after).includes('user_id:11'));
});
test('explicit no-access role 0 and an empty grant array are not conflated', () => {
  const p = pair(); p.before.protectionRules.value![0]!.push_access_levels = [{ access_level: 0 }];
  p.after.protectionRules.value![0]!.push_access_levels = [];
  assert.deepEqual(p.compare().changes[0]?.before, ['role:0']); assert.deepEqual(p.compare().changes[0]?.after, []);
});
test('optional settings becoming available are coverage changes, not false-to-true changes', () => {
  const p = pair(); delete p.before.protectionRules.value![0]!.inherited;
  const result = p.compare(); assert.equal(result.status, 'coverage_changed'); assert.equal(result.changes.length, 0);
  assert.equal(result.coverageChanges[0]?.before, 'unknown'); assert.equal(result.coverageChanges[0]?.after, 'known');
});
test('optional settings disappearing are unavailable, never assumed false or empty', () => {
  const p = pair(); delete p.after.protectionRules.value![0]!.unprotect_access_levels;
  delete p.after.protectionRules.value![0]!.code_owner_approval_required;
  const result = p.compare(); assert.equal(result.status, 'coverage_changed'); assert.equal(result.changes.length, 0);
  assert.equal(result.coverageChanges.length, 2);
});
test('fields unavailable in both observations do not invent changes or claim known defaults', () => {
  const p = pair(); delete p.before.protectionRules.value![0]!.inherited; delete p.after.protectionRules.value![0]!.inherited;
  const result = p.compare(); assert.equal(result.status, 'unchanged'); assert.equal(result.coverageChanges.length, 0);
  assert.ok(result.unavailableFields.includes('rules["main"].inherited'));
});
test('descriptive-only access entries are unavailable rather than guessed role permissions', () => {
  const p = pair(); p.after.protectionRules.value![0]!.merge_access_levels = [{ access_level_description: 'Maintainers' }];
  assert.equal(p.compare().status, 'coverage_changed'); assert.equal(p.compare().changes.length, 0);
});
test('confirmed protection removal differs from failed rule collection', () => {
  const p = pair(); unprotected(p.after);
  const result = p.compare(); assert.equal(result.status, 'changed');
  assert.ok(result.changes.some(change => change.field === 'posture' && change.after === 'unprotected'));
  assert.ok(result.changes.some(change => change.kind === 'removed'));
});
test('confirmed protection addition is visible against an unprotected baseline', () => {
  const p = pair(); unprotected(p.before);
  const result = p.compare(); assert.equal(result.status, 'changed'); assert.ok(result.changes.some(change => change.kind === 'added'));
});
test('failed or partial rule listing cannot fabricate removed rules', () => {
  for (const state of ['failed', 'partial'] as const) {
    const p = pair(); p.after.outcome = 'partial'; p.current.projects[0]!.state = 'partial';
    p.after.protectionRules.status = state; p.after.protectionRules.value = state === 'failed' ? null : [];
    const result = p.compare(); assert.equal(result.status, 'incomplete'); assert.equal(result.changes.length, 0);
    assert.equal(result.coverageChanges[0]?.after, 'unknown'); assert.equal(result.baseline?.runId, 'baseline');
  }
});
test('partial evidence may expose known fact changes but cannot claim a complete comparison', () => {
  const p = pair(); p.after.outcome = 'partial'; p.current.projects[0]!.state = 'partial';
  p.after.project.value!.name = 'Renamed'; p.after.protectionRules.status = 'failed'; p.after.protectionRules.value = null;
  const result = p.compare(); assert.equal(result.status, 'incomplete');
  assert.equal(result.changes[0]?.category, 'metadata'); assert.equal(result.changes[0]?.after, 'Renamed');
});
test('empty-to-initialized and initialized-to-empty transitions do not compare rules across branch scopes', () => {
  const p = pair(); empty(p.before);
  const result = p.compare(); assert.equal(result.status, 'changed');
  assert.ok(result.changes.some(change => change.field === 'defaultBranch' && change.before === null && change.after === 'main'));
  assert.ok(!result.changes.some(change => change.field.startsWith('rules')));
  const reverse = pair(); empty(reverse.after);
  assert.ok(reverse.compare().changes.some(change => change.field === 'defaultBranch' && change.after === null));
});
test('two empty projects compare consistently while retaining configured-branch metadata', () => {
  const p = pair(); empty(p.before); empty(p.after);
  assert.equal(p.compare().status, 'unchanged');
  p.after.project.value!.default_branch = 'trunk';
  const changed = p.compare(); assert.equal(changed.changes[0]?.category, 'metadata');
  assert.equal(changed.changes[0]?.field, 'project.configuredDefaultBranch');
});
test('changing default branch explains the scope and avoids fictitious rule deletions', () => {
  const p = pair(); p.after.project.value!.default_branch = 'develop'; p.after.branch.value!.name = 'develop';
  p.after.protectionRules.value = [{ ...rule(), name: 'develop' }];
  const result = p.compare(); assert.equal(result.status, 'changed');
  assert.equal(result.changes.length, 1); assert.equal(result.changes[0]?.field, 'defaultBranch');
  assert.ok(result.notices.some(notice => notice.includes('different branch scopes')));
});
test('contradictory evidence and duplicate matching patterns are not arbitrarily compared', () => {
  const p = pair(); p.after.issues.push({ code: 'inconsistent_evidence', message: 'Mismatch', action: 'Collect again' });
  p.after.outcome = 'partial'; p.current.projects[0]!.state = 'partial';
  assert.equal(p.compare().status, 'incomplete'); assert.equal(p.compare().changes.length, 0);
  const duplicate = pair(); duplicate.after.protectionRules.value!.push({ ...rule(), id: 100, allow_force_push: true });
  assert.equal(duplicate.compare().status, 'incomplete'); assert.equal(duplicate.compare().changes.length, 0);
});
test('pending, failed and interrupted outcomes do not reuse old evidence as current', () => {
  for (const state of ['pending', 'running', 'failed', 'interrupted'] as const) {
    const p = pair(); p.current.projects[0]!.state = state; p.current.projects[0]!.evidence = null;
    const result = p.compare(); assert.equal(result.status, ['pending', 'running'].includes(state) ? 'pending' : 'unavailable');
    assert.equal(result.changes.length, 0); assert.equal(result.baseline?.runId, 'baseline');
  }
});
test('missing, noncomplete, future, or wrong-project baselines never cause fallback', () => {
  const p = pair();
  assert.equal(compareProject(p.current, p.current.projects[0]!, null).status, 'unavailable');
  for (const bad of [ { ...p.baseline, sequence: 3 }, { ...p.baseline, id: 'other' },
    { ...p.baseline, projects: [{ ...p.baseline.projects[0]!, state: 'partial' as const }] },
    { ...p.baseline, projects: [{ ...p.baseline.projects[0]!, projectId: 202 }] } ]) {
    assert.equal(compareProject(p.current, p.current.projects[0]!, bad).status, 'unavailable');
  }
});
test('comparisons are deterministic and do not mutate original observations', () => {
  const p = pair(); p.after.protectionRules.value![0]!.allow_force_push = true;
  const original = JSON.stringify([p.baseline, p.current]);
  assert.deepEqual(p.compare(), p.compare()); assert.equal(JSON.stringify([p.baseline, p.current]), original);
});
test('metadata changes stay separate from protection settings', () => {
  const p = pair(); p.after.project.value!.visibility = 'public'; p.after.project.value!.name = 'New name';
  const result = p.compare(); assert.equal(result.status, 'changed');
  assert.equal(result.changes.length, 2); assert.ok(result.changes.every(change => change.category === 'metadata'));
});

test('a failed branch lookup cannot turn a configured name into a confirmed branch change', () => {
  const p = pair(); p.after.outcome = 'partial'; p.current.projects[0]!.state = 'partial';
  p.after.project.value!.default_branch = 'unverified';
  p.after.branch.status = 'failed'; p.after.branch.value = null;
  const result = p.compare(); assert.equal(result.status, 'incomplete');
  assert.equal(result.current.defaultBranch, null); assert.equal(result.current.defaultBranchKnown, false);
  assert.ok(!result.changes.some(change => change.field === 'defaultBranch'));
  assert.ok(result.coverageChanges.some(change => change.field === 'defaultBranch' && change.after === 'unknown'));
});
test('wildcard rule removal is visible while incidental cached matchingRules are ignored', () => {
  const p = pair(); p.before.protectionRules.value!.push({ ...rule(), id: 11, name: 'm*' });
  p.after.matchingRules = []; // Derive matches from actual complete configuration rather than trusting a cache.
  const result = p.compare(); assert.equal(result.status, 'changed');
  assert.equal(result.changes.length, 1); assert.equal(result.changes[0]?.field, 'rules["m*"]');
  assert.equal(result.changes[0]?.kind, 'removed');
});
