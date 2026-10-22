import { useEffect, useRef, useState } from 'react';
import { api, ApiError, parseIds } from './api.ts';
import { useWorkspace } from './useWorkspace.ts';
import type { Project, ProjectState, Run, Selection } from './types.ts';
import { Badge, ComparisonPanel, ErrorList, EvidencePanel, RunProgress, Section } from './components.tsx';
import { date, human, shortId, stale } from './presentation.ts';
function route() { const query = new URLSearchParams(location.hash.slice(1)); return { runId: query.get('run'), projectId: Number(query.get('project')) || null }; }
export function App() {
  const [locationState, setLocationState] = useState(route);
  const [revision, setRevision] = useState(0); const { snapshot, error: refreshError } = useWorkspace(locationState.runId, revision);
  const [draft, setDraft] = useState(''); const initialized = useRef(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  useEffect(() => { const changed = () => setLocationState(route()); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  useEffect(() => { if (snapshot && !initialized.current) { setDraft(snapshot.selection.projectIds.join('\n')); initialized.current = true; } }, [snapshot]);
  const navigate = (runId: string, projectId?: number) => { location.hash = new URLSearchParams({ run: runId, ...(projectId ? { project: String(projectId) } : {}) }).toString(); };
  const refresh = () => setRevision(value => value + 1);
  const run = locationState.runId ? snapshot?.detail?.id === locationState.runId ? snapshot.detail : null : snapshot?.active ?? snapshot?.runs[0] ?? null;
  const dirty = snapshot ? draft.trim().split(/[\s,]+/).filter(Boolean).join(',') !== snapshot.selection.projectIds.join(',') : false;
  const save = async () => {
    setBusy(true); setError(null); setMessage(null);
    try { const ids = parseIds(draft); const saved = await api<Selection>('/api/selection', undefined, { projectIds: ids }, 'PUT'); setDraft(saved.projectIds.join('\n')); setMessage('Project selection saved.'); refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Selection could not be saved.'); }
    finally { setBusy(false); }
  };
  const start = async (ids?: number[]) => {
    setBusy(true); setError(null); setMessage(null);
    try {
      const accepted = await api<{ run: Run }>('/api/runs', undefined, ids ? { projectIds: ids } : {});
      navigate(accepted.run.id, ids?.[0]); setMessage('Collection accepted. Results are saved as each project finishes.'); refresh();
    } catch (error) {
      if (error instanceof ApiError && error.activeRunId && error.activeRunId !== 'finishing') { navigate(error.activeRunId); refresh(); }
      setError(error instanceof Error ? error.message : 'Collection could not be started.');
    } finally { setBusy(false); }
  };
  const active = Boolean(snapshot?.active); const canCollect = Boolean(snapshot?.health.tokenConfigured) && !active && !busy;
  const shownProjects = run?.projects.filter(project => filter === 'all' || (filter === 'attention' ? ['partial', 'failed', 'interrupted'].includes(project.state) : project.comparison.status === 'changed')) ?? [];
  const selected = shownProjects.find(project => project.projectId === locationState.projectId) ?? shownProjects[0] ?? null;
  return <div className="app-shell"><a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to workspace</a><header className="topbar"><a className="brand" href="/" aria-label="GitLab Evidence home"><span className="brand-icon" aria-hidden="true">G</span><span>GitLab <b>Evidence</b><small>COLLECTION WORKSPACE</small></span></a><div className="top-meta"><span className="local-dot"/> Local workspace <span className="top-divider"/> Read-only GitLab integration</div></header>
    <main id="main" tabIndex={-1}><div className="page-heading"><div><p className="eyebrow">PROJECT PROTECTION / EVIDENCE COLLECTION</p><h1>Know what was observed.</h1><p className="subtitle">Collect GitLab evidence, investigate gaps, and track protection changes.</p></div><button className="secondary" onClick={refresh}>Refresh workspace</button></div>
      {(refreshError || error) && <div className="notice danger" role="alert"><strong>{error ?? refreshError}</strong>{refreshError && <p>Previously loaded results are retained. Collection may still be running. <button className="text-button" onClick={() => { if (refreshError && locationState.runId) location.hash = ''; refresh(); }}>Retry connection</button></p>}</div>}
      {message && <div className="notice success" role="status">{message}</div>}
      {!snapshot && !refreshError && <div className="empty" role="status">Loading your saved workspace…</div>}
      {snapshot && <>
        {!snapshot.health.tokenConfigured && <div className="notice warning"><strong>GitLab token is not configured.</strong><p>Configure GITLAB_TOKEN in the server-side .env file and restart the server. Existing history remains available.</p></div>}
        {snapshot.active && run?.id !== snapshot.active.id && <div className="notice info">Run {snapshot.active.sequence} is collecting in the background. <button className="text-button" onClick={() => navigate(snapshot.active!.id)}>View active run</button></div>}
        <div className="workspace-grid"><aside className="sidebar"><Section title="Project selection" note={`${snapshot.selection.projectIds.length} saved`}><label htmlFor="project-ids">GitLab project IDs</label><textarea id="project-ids" value={draft} onChange={event => setDraft(event.target.value)} rows={5} spellCheck={false} placeholder={'87944794\n87944512\n87944475'} aria-describedby="selection-help"/><p id="selection-help" className="muted small">Use numeric IDs, one per line or separated by commas. Up to 25 projects.</p><div className="button-stack"><button className="secondary" onClick={() => void save()} disabled={busy || !dirty}>Save selection</button><button className="primary" onClick={() => void start()} disabled={!canCollect || dirty || !snapshot.selection.projectIds.length}>{active ? 'Collection in progress' : busy ? 'Please wait…' : 'Start collection'}<span aria-hidden="true"> →</span></button></div>{dirty && <p className="small warning-text">Save your edits before starting a collection.</p>}</Section>
          <Section title="Run history" note={`${snapshot.runs.length} recent`}><p className="muted small">Historical observations are preserved. Select a run to inspect it.</p><div className="history-list">{snapshot.runs.map(item => <button className={`history-item ${run?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => { setFilter('all'); navigate(item.id); }} aria-pressed={run?.id === item.id}><span><strong>Run {item.sequence}</strong><Badge value={item.status}/></span><small>{date(item.createdAt)}</small><small>{item.projects.length} {item.projects.length === 1 ? 'project' : 'projects'} · {shortId(item.id)}</small></button>)}</div>{!snapshot.runs.length && <p className="muted">Your first collection will appear here.</p>}</Section><p className="sidebar-note">Server synced {date(snapshot.syncedAt)}<br/>Times shown in your local timezone.</p></aside>
          <div className="main-column">{run ? <><Section title={`Collection run ${run.sequence}`} note={date(run.createdAt)}><RunProgress run={run}/>{run.interruptionReason && <div className="notice warning">Run interrupted: {human(run.interruptionReason)}. Completed project evidence is retained. Start a new collection to recover unfinished work.</div>}<div className="run-id">Run ID <code>{run.id}</code></div></Section>
            <Section title="Project outcomes"><div className="inline spread"><p className="muted small">Collection outcome and protection posture are separate facts.</p><label className="filter-label">Show <select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All projects</option><option value="attention">Needs attention</option><option value="changed">Changed</option></select></label></div><div className="project-list">{shownProjects.map(project => <button className={`project-row ${selected?.projectId === project.projectId ? 'selected' : ''}`} key={project.projectId} onClick={() => navigate(run.id, project.projectId)} aria-pressed={selected?.projectId === project.projectId}><span className="project-title"><strong>{project.evidence?.project.value?.name ?? `Project ${project.projectId}`}</strong><small>#{project.projectId}</small></span><span className="project-badges"><Badge value={project.state}/><Badge value={project.evidence?.posture ?? 'unknown'}/><Badge value={project.comparison.status}/></span></button>)}</div>{!shownProjects.length && <p className="empty small">No projects match this filter.</p>}</Section>
            {selected && <ProjectDetail key={`${run.id}-${selected.projectId}`} project={selected} run={run} navigate={navigate} revision={revision} refreshStamp={snapshot.syncedAt} collect={() => void start([selected.projectId])} canCollect={canCollect}/>}
          </> : <div className="empty panel"><span className="empty-mark" aria-hidden="true">◎</span><h2>{locationState.runId ? 'Opening selected run…' : 'Start with a collection'}</h2><p>Save your project IDs and collect evidence. Results and comparisons will appear here.</p></div>}</div></div>
      </>}
    </main><footer>GITLAB EVIDENCE <span>Observed settings, with source references. No compliance score or effective-user permission calculation.</span></footer></div>;
}
function ProjectDetail({ project, run, navigate, revision, refreshStamp, collect, canCollect }: { project: Project; run: Run; navigate: (runId: string, projectId?: number) => void; revision: number; refreshStamp: string; collect: () => void; canCollect: boolean }) {
  const [state, setState] = useState<ProjectState | null>(null);
  const [lastComplete, setLastComplete] = useState<{ runId: string; project: Project } | null>(null); const [stateError, setStateError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([api<ProjectState>(`/api/projects/${project.projectId}`, controller.signal),
      project.baselineRunId && project.state !== 'complete' ? api<{ run: Run }>(`/api/runs/${project.baselineRunId}`, controller.signal) : Promise.resolve(null),
    ]).then(([value, baseline]) => {
      setState(value); setStateError(null);
      const entry = baseline?.run.projects.find(entry => entry.projectId === project.projectId && entry.state === 'complete');
      setLastComplete(entry && baseline ? { runId: baseline.run.id, project: entry } : null);
    }).catch(error => { if (!controller.signal.aborted) setStateError(error instanceof Error ? error.message : 'Could not load latest state.'); });
    return () => controller.abort();
  }, [project.projectId, project.state, project.baselineRunId, run.status, revision, refreshStamp]);
  const historical = Boolean(state?.latest && state.latest.runId !== run.id);
  const showOlder = project.state !== 'complete' && Boolean(lastComplete && lastComplete.runId !== run.id);
  return <div className="detail"><div className="detail-heading"><div><p className="eyebrow">PROJECT DETAIL</p><h2>{project.evidence?.project.value?.name ?? `Project ${project.projectId}`}</h2></div><button className="secondary" onClick={collect} disabled={!canCollect}>Recollect project</button></div>
    {historical && <div className="notice info">You are inspecting historical run {run.sequence}. <button className="text-button" onClick={() => navigate(state!.latest!.runId, project.projectId)}>Open latest attempt</button></div>}
    {stateError && <div className="notice warning">{stateError}</div>}
    {project.state !== 'complete' && <div className="notice warning"><strong>{['pending', 'running'].includes(project.state) ? 'Collection has not finished for this project.' : 'This attempt did not produce complete evidence.'}</strong><p>Unknown or missing information is not confirmation that protection is absent.</p></div>}
    {stale(project.evidence?.finishedAt) && <div className="notice warning">This observation is older than 24 hours. Recollect before relying on it as current evidence.</div>}
    <ErrorList evidence={project.evidence}/>
    <ComparisonPanel project={project} navigate={navigate}/>
    {project.evidence && <EvidencePanel evidence={project.evidence}/>}
    {showOlder && lastComplete?.project.evidence && <Section title="Last complete evidence before this run (historical)"><div className="notice warning">Latest complete observation: {date(lastComplete.project.evidence.finishedAt)}. This is older evidence, not a successful result from the selected attempt.</div><button className="text-button" onClick={() => navigate(lastComplete.runId, project.projectId)}>Open last complete run {shortId(lastComplete.runId)}</button><p>Previously observed posture: <Badge value={lastComplete.project.evidence.posture}/></p>{stale(lastComplete.project.evidence.finishedAt) && <p className="warning-text">This older observation is also stale (over 24 hours).</p>}</Section>}
  </div>;
}
