import { GitLabClient } from './client.ts';
import { projectSchema, branchSchema, rulesSchema } from './schemas.ts';
import type { CollectionError, Observation, ProjectEvidence, ProtectionRule } from './types.ts';

const MAX_PAGES = 20;
export function matchesRule(pattern: string, branch: string): boolean {
  // GitLab protection patterns use '*'. Other regex characters are literal.
  const expression = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + expression + '$', 'u').test(branch);
}
const unavailable = <T>(): Observation<T> => ({ status: 'not_collected', value: null, sources: [] });

export async function collectProject(client: GitLabClient, projectId: number): Promise<ProjectEvidence> {
  if (!Number.isSafeInteger(projectId) || projectId < 1) throw new Error('Project IDs must be positive safe integers.');
  const evidence: ProjectEvidence = {
    requestedProjectId: projectId, startedAt: new Date().toISOString(), finishedAt: '',
    outcome: 'failed', posture: 'unknown', project: unavailable(), branch: unavailable(),
    protectionRules: unavailable(), matchingRules: [], issues: [],
  };
  const issue = (message: string): void => {
    evidence.issues.push({ code: 'inconsistent_evidence', message,
      action: 'Collect again. GitLab settings may have changed during collection, or API coverage may be incomplete.' });
  };
  const result = await client.get(`/projects/${projectId}`, projectSchema);
  evidence.project = { status: result.value ? 'collected' : 'failed', value: result.value, sources: [result.source] };
  if (result.value) {
    evidence.outcome = 'partial';
    if (result.value.id !== projectId) {
      issue('The returned project ID did not match the requested project.');
    } else if (result.value.empty_repo === true) {
      // GitLab can expose a configured default branch name before any branch exists.
      // Preserve that metadata, but do not request a nonexistent branch or infer protection.
      evidence.branch.status = 'not_applicable';
      evidence.protectionRules.status = 'not_applicable';
      evidence.posture = 'no_default_branch';
      evidence.outcome = 'complete';
    } else if (result.value.default_branch === null) {
      issue('No default branch was returned, but an empty repository was not confirmed.');
    } else {
      const branchName = result.value.default_branch;
      const branchResult = await client.get(`/projects/${projectId}/repository/branches/${encodeURIComponent(branchName)}`, branchSchema);
      evidence.branch = { status: branchResult.value ? 'collected' : 'failed', value: branchResult.value, sources: [branchResult.source] };
      if (branchResult.value?.name === branchName) {
        evidence.posture = branchResult.value.protected ? 'protected' : 'unprotected';
      } else if (branchResult.value) issue('The returned branch did not match the requested default branch.');
      evidence.protectionRules = await collectRules(client, projectId);
      evidence.matchingRules = (evidence.protectionRules.value ?? []).filter(rule => matchesRule(rule.name, branchName));
      if (evidence.protectionRules.status === 'collected' && branchResult.value?.name === branchName) {
        const hasRules = evidence.matchingRules.length > 0;
        if (branchResult.value.protected !== hasRules) issue('Branch protection status and matching rule configuration disagree.');
      }
      if (evidence.branch.status === 'collected' && evidence.protectionRules.status === 'collected' && !evidence.issues.length) evidence.outcome = 'complete';
    }
  }
  evidence.finishedAt = new Date().toISOString();
  return evidence;
}
async function collectRules(client: GitLabClient, projectId: number): Promise<Observation<ProtectionRule[]>> {
  const observation: Observation<ProtectionRule[]> = { status: 'failed', value: null, sources: [] };
  const rules: ProtectionRule[] = [];
  let page = 1;
  const seen = new Set<number>();
  for (let count = 0; count < MAX_PAGES; count++) {
    seen.add(page);
    const result = await client.get(`/projects/${projectId}/protected_branches?per_page=100&page=${page}`, rulesSchema);
    observation.sources.push(result.source);
    if (!result.value) {
      observation.status = rules.length ? 'partial' : 'failed';
      observation.value = rules.length ? rules : null;
      return observation;
    }
    rules.push(...result.value);
    observation.value = rules;
    // Header may be absent; request one extra page for an exactly full page.
    if (result.nextPage === '' || (result.nextPage === null && result.value.length < 100)) {
      observation.status = 'collected';
      return observation;
    }
    const next = result.nextPage === null ? page + 1 : Number(result.nextPage);
    if (!Number.isSafeInteger(next) || next <= page || seen.has(next)) break;
    page = next;
  }
  const error: CollectionError = { code: 'pagination_limit', message: 'Protection rule pagination was incomplete or exceeded 20 pages.', action: 'Inspect API pagination and collect again. Listed rules may be incomplete.' };
  observation.status = 'partial';
  observation.sources.push({ url: `https://gitlab.com/api/v4/projects/${projectId}/protected_branches`, observedAt: new Date().toISOString(), httpStatus: null, attempts: 0, error });
  return observation;
}
export function parseProjectIds(values: string[]): number[] {
  const parts = values.flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
  if (!parts.length || parts.length > 25) throw new Error('Provide between 1 and 25 numeric project IDs.');
  if (parts.some(value => !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) throw new Error('Project IDs must be positive safe integers.');
  return [...new Set(parts.map(Number))];
}
