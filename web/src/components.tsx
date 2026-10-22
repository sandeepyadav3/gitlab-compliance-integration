import type { ReactNode } from 'react';
import type { Project, Run } from './types.ts';
import type { ProjectEvidence } from '../../src/gitlab/types.ts';
import { date, human, safeLink, shortId, valueText } from './presentation.ts';
export function Badge({ value }: { value: string }) { return <span className={`badge badge-${value}`}>{human(value)}</span>; }
export function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return <section className="panel"><div className="panel-heading"><h2>{title}</h2>{note && <span className="muted">{note}</span>}</div>{children}</section>;
}
export function GitLabLink({ url, children }: { url: string; children: ReactNode }) {
  const href = safeLink(url); return href ? <a href={href} target="_blank" rel="noreferrer">{children}<span aria-hidden="true"> ↗</span></a> : <span>{children}</span>;
}
export function ErrorList({ evidence }: { evidence: ProjectEvidence | null }) {
  if (!evidence) return null;
  const errors = [ ...evidence.issues, ...[evidence.project, evidence.branch, evidence.protectionRules].flatMap(observation => observation.sources.flatMap(source => source.error ? [source.error] : [])) ];
  return <>{errors.map((error, i) => <div className="notice warning" key={`${error.code}-${i}`}><strong>{human(error.code)}</strong><p>{error.message}</p><p><b>Next action:</b> {error.action}</p></div>)}</>;
}
export function ComparisonPanel({ project, navigate }: { project: Project; navigate: (runId: string, projectId?: number) => void }) {
  const comparison = project.comparison;
  return <Section title="Changes since baseline"><div className="inline"><Badge value={comparison.status}/><span>{comparison.summary}</span></div>
    <div className="baseline">{comparison.baseline ? <>Baseline: <button className="text-button" onClick={() => navigate(comparison.baseline!.runId, project.projectId)}>Run {comparison.baseline.sequence} · {shortId(comparison.baseline.runId)}</button><span className="muted"> · {date(comparison.baseline.observedAt)}</span></> : comparison.baselineRunId ? 'Recorded baseline could not be read.' : 'No earlier complete baseline for this project.'}</div>
    {comparison.changes.length > 0 && <div className="table-scroll"><table><caption className="sr-only">Observed setting changes</caption><thead><tr><th>Setting</th><th>Before</th><th>After</th></tr></thead><tbody>{comparison.changes.map(change => <tr key={change.field}><td><span className="eyebrow">{change.category} · {change.kind}</span><strong>{change.label}</strong></td><td className="old-value">{valueText(change.before)}</td><td className="new-value">{valueText(change.after)}</td></tr>)}</tbody></table></div>}
    {comparison.coverageChanges.map(change => <div className="notice warning" key={change.field}><strong>{change.label}</strong><p>{change.message}</p></div>)}
    {comparison.notices.length > 0 && <ul className="notes">{comparison.notices.map(note => <li key={note}>{note}</li>)}</ul>}
    {comparison.unavailableFields.length > 0 && <details><summary>Unavailable comparison fields ({comparison.unavailableFields.length})</summary><ul>{comparison.unavailableFields.map(field => <li key={field}><code>{field}</code></li>)}</ul></details>}
  </Section>;
}
export function EvidencePanel({ evidence, label = 'Observed evidence' }: { evidence: ProjectEvidence; label?: string }) {
  const project = evidence.project.value;
  return <Section title={label} note={date(evidence.finishedAt)}>
    <dl className="facts"><div><dt>GitLab protection posture</dt><dd><Badge value={evidence.posture}/></dd></div><div><dt>Default branch metadata</dt><dd>{project?.default_branch ?? 'Not returned'}{project?.empty_repo && ' (configured name; repository empty)'}</dd></div><div><dt>Visibility</dt><dd>{project?.visibility ?? 'Unavailable'}</dd></div><div><dt>Project URL</dt><dd>{project ? <GitLabLink url={project.web_url}>{project.web_url}</GitLabLink> : 'Unavailable'}</dd></div></dl>
    <div className="observation-status">{[['Project', evidence.project.status], ['Branch', evidence.branch.status], ['Protection configuration', evidence.protectionRules.status]].map(([label, status]) => <div key={label}><span>{label}</span><Badge value={status!}/></div>)}</div>
    {evidence.matchingRules.map(rule => <div className="rule-card" key={`${rule.name}-${rule.id}`}><div className="inline"><h3>{rule.name}</h3><span className="muted">Matching protection rule</span></div><dl className="facts">
      <div><dt>Allowed to push</dt><dd>{accessLabel(rule.push_access_levels)}</dd></div><div><dt>Allowed to merge</dt><dd>{accessLabel(rule.merge_access_levels)}</dd></div><div><dt>Allowed to unprotect</dt><dd>{accessLabel(rule.unprotect_access_levels)}</dd></div><div><dt>Force push allowed</dt><dd>{valueText(rule.allow_force_push)}</dd></div><div><dt>Code owner approval</dt><dd>{rule.code_owner_approval_required === undefined ? 'Not returned' : valueText(rule.code_owner_approval_required)}</dd></div><div><dt>Inherited</dt><dd>{rule.inherited === undefined ? 'Not returned' : valueText(rule.inherited)}</dd></div></dl></div>)}
    {evidence.protectionRules.status === 'not_applicable' && <p className="muted">No existing default branch to assess. Protection configuration is not applicable.</p>}
    {evidence.protectionRules.status === 'collected' && evidence.matchingRules.length === 0 && <p className="muted">No matching protection rules were returned in the complete rule list.</p>}
    {evidence.protectionRules.status === 'partial' && <p className="notice warning">The rule list is incomplete. Any matching rules shown are only the successfully collected subset.</p>}
    <details><summary>Source references and collection attempts</summary>{[ ['Project', evidence.project], ['Branch', evidence.branch], ['Protection configuration', evidence.protectionRules] ].map(([name, observation]) => {
      const item = observation as ProjectEvidence['project']; return <div className="source-group" key={String(name)}><h3>{String(name)}</h3>{item.sources.length ? item.sources.map((source, i) => <div className="source" key={`${source.url}-${i}`}><GitLabLink url={source.url}>{source.url}</GitLabLink><p>{date(source.observedAt)} · HTTP {source.httpStatus ?? 'unavailable'} · {source.attempts} attempt(s)</p></div>) : <p className="muted">No request was made ({human(item.status)}).</p>}</div>;
    })}</details>
    <details><summary>Inspect selected evidence JSON</summary><pre>{JSON.stringify(evidence, null, 2)}</pre></details>
  </Section>;
}
function accessLabel(levels: ProjectEvidence['matchingRules'][number]['push_access_levels'] | undefined): string {
  if (!levels) return 'Not returned'; if (!levels.length) return 'Empty returned list; no effective permission inferred';
  return levels.map(level => {
    const subjects = (['user_id', 'group_id', 'deploy_key_id', 'member_role_id'] as const).filter(key => typeof level[key] === 'number').map(key => `${human(key)} ${level[key]}`);
    return subjects.length ? subjects.join(', ') : typeof level.access_level === 'number' ? valueText(`role:${level.access_level}`) : 'Unidentified returned entry';
  }).join('; ');
}
export function RunProgress({ run }: { run: Run }) {
  return <div className="run-progress"><div className="inline spread"><span>Run {run.sequence} · <Badge value={run.status}/></span><strong>{run.progress.finished} / {run.progress.total} accounted for</strong></div><progress max={run.progress.total} value={run.progress.finished} aria-label="Collection progress"/><p className="muted">{run.progress.complete} complete · {run.progress.partial} partial · {run.progress.failed} failed · {run.progress.interrupted} interrupted</p></div>;
}
