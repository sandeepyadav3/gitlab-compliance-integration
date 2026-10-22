import { compareProject } from './compare.ts';
import type { EvidenceStore, Run, RunProject } from '../storage/store.ts';

export function withComparisons(store: EvidenceStore, run: Run) {
  const baselines = new Map<string, Run | null>();
  return { ...run, projects: run.projects.map(project => {
    if (project.baselineRunId && !baselines.has(project.baselineRunId)) baselines.set(project.baselineRunId, store.getRun(project.baselineRunId));
    return { ...project, comparison: compareProject(run, project, project.baselineRunId ? baselines.get(project.baselineRunId)! : null) };
  }) };
}
export function projectReferenceView(store: EvidenceStore, reference: { runId: string; project: RunProject } | null) {
  if (!reference) return null;
  const run = store.getRun(reference.runId);
  if (!run) return null;
  return { ...reference, project: { ...reference.project, comparison: compareProject(run, reference.project,
    reference.project.baselineRunId ? store.getRun(reference.project.baselineRunId) : null) } };
}
