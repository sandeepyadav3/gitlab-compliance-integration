import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { schema } from './schema.ts';
import { migration2 } from './migration-2.ts';
import { migration3 } from './migration-3.ts';
import { parseProjectIds } from '../gitlab/collector.ts';
import { projectEvidenceSchema } from '../gitlab/schemas.ts';
import type { ProjectEvidence } from '../gitlab/types.ts';

export interface RunProject {
  projectId: number;
  state: 'pending' | 'running' | 'complete' | 'partial' | 'failed' | 'interrupted';
  baselineRunId: string | null;
  evidence: ProjectEvidence | null;
}
export interface Run {
  id: string; sequence: number; requestedProjectIds: number[];
  status: 'queued' | 'running' | 'completed' | 'interrupted';
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  interruptionReason: string | null;
  projects: RunProject[];
}
interface RunRow {
  id: string; sequence: number; requested_ids_json: string; status: Run['status'];
  created_at: string; started_at: string | null; finished_at: string | null; interruption_reason: string | null;
}
interface ProjectRow {
  project_id: number; state: RunProject['state']; baseline_run_id: string | null; evidence_json: string | null;
}
export class EvidenceStore {
  #db: DatabaseSync;
  #owner: string | null = null;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.#db = new DatabaseSync(path);
    try {
      this.#db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
      this.#transaction(() => {
        const version = this.#db.prepare('PRAGMA user_version').get()?.user_version;
        if (version === 0) this.#db.exec(schema);
        if (version === 0 || version === 1) this.#db.exec(migration2);
        if (version === 0 || version === 1 || version === 2) this.#db.exec(migration3);
        else if (version !== 3) throw new Error('Unsupported database version. Use the matching application version.');
      });
    } catch (error) { this.#db.close(); throw error; }
  }
  close(): void { this.#db.close(); }
  #transaction<T>(operation: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  saveSelection(ids: number[]): number[] {
    const selected = parseProjectIds(ids.map(String));
    this.#db.prepare(`INSERT INTO selection VALUES (1, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET project_ids_json=excluded.project_ids_json, updated_at=excluded.updated_at`)
      .run(JSON.stringify(selected), new Date().toISOString());
    return selected;
  }
  getSelection(): { projectIds: number[]; updatedAt: string | null } {
    const row = this.#db.prepare('SELECT project_ids_json, updated_at FROM selection WHERE singleton=1').get();
    return row ? { projectIds: JSON.parse(row.project_ids_json as string), updatedAt: row.updated_at as string }
      : { projectIds: [], updatedAt: null };
  }
  createRun(ids: number[], requireIdle = false): Run {
    const selected = parseProjectIds(ids.map(String));
    const id = randomUUID();
    this.#writeTransaction(() => {
      if (requireIdle && this.getActiveRun()) throw new ActiveRunError(this.getActiveRun()!.id);
      this.#db.prepare('INSERT INTO runs(id,requested_ids_json,status,created_at) VALUES (?, ?, \'queued\', ?)')
        .run(id, JSON.stringify(selected), new Date().toISOString());
      const baseline = this.#db.prepare(`SELECT rp.run_id FROM run_projects rp JOIN runs r ON r.id=rp.run_id
        WHERE rp.project_id=? AND rp.state='complete' ORDER BY r.sequence DESC LIMIT 1`);
      const insert = this.#db.prepare(`INSERT INTO run_projects(run_id,project_id,position,state,baseline_run_id)
        VALUES (?, ?, ?, 'pending', ?)`);
      selected.forEach((projectId, position) => insert.run(id, projectId, position,
        (baseline.get(projectId)?.run_id as string | undefined) ?? null));
    });
    return this.getRun(id)!;
  }
  startRun(id: string): void {
    this.#writeTransaction(() => {
      const result = this.#db.prepare("UPDATE runs SET status='running', started_at=? WHERE id=? AND status='queued'")
        .run(new Date().toISOString(), id);
      if (result.changes !== 1) throw new Error('Run must exist and be queued.');
    });
  }
  startProject(runId: string, projectId: number): void {
    this.#writeTransaction(() => {
      const result = this.#db.prepare(`UPDATE run_projects SET state='running' WHERE run_id=? AND project_id=? AND state='pending'
        AND EXISTS(SELECT 1 FROM runs WHERE id=? AND status='running')`).run(runId, projectId, runId);
      if (result.changes !== 1) throw new Error('Project must be pending in a running run.');
    });
  }
  // Parse selected evidence again at the persistence boundary; discard unknown fields.
  #validated(input: ProjectEvidence): ProjectEvidence {
    const evidence = projectEvidenceSchema.parse(input);
    if (evidence.finishedAt < evidence.startedAt) throw new Error('Evidence timestamps are out of order.');
    if (evidence.project.value && evidence.project.value.id !== evidence.requestedProjectId) {
      // Contradictory metadata remains valuable when correctly marked as partial.
      if (evidence.outcome === 'complete') throw new Error('Complete evidence must match the requested project.');
    }
    if (evidence.outcome === 'complete' && (evidence.posture === 'unknown' || evidence.project.status !== 'collected' || evidence.issues.length)) {
      throw new Error('Complete evidence requires a known posture and collected project.');
    }
    if (evidence.outcome === 'complete') {
      if (!evidence.project.value) throw new Error('Complete evidence requires project metadata.');
      if (evidence.posture === 'no_default_branch') {
        if (evidence.project.value.empty_repo !== true || evidence.branch.status !== 'not_applicable'
          || evidence.protectionRules.status !== 'not_applicable') throw new Error('Empty repository evidence is inconsistent.');
      } else {
        if (evidence.branch.status !== 'collected' || !evidence.branch.value
          || evidence.protectionRules.status !== 'collected' || !evidence.protectionRules.value
          || evidence.branch.value.name !== evidence.project.value.default_branch
          || evidence.branch.value.protected !== (evidence.posture === 'protected')) {
          throw new Error('Complete evidence requires consistent branch status and collected configuration.');
        }
      }
    }
    return evidence;
  }
  checkpoint(runId: string, input: ProjectEvidence): void {
    const evidence = this.#validated(input);
    if (evidence.outcome !== 'partial' && evidence.outcome !== 'failed') throw new Error('Checkpoints must be partial or failed observations.');
    this.#writeTransaction(() => {
      const result = this.#db.prepare(`INSERT INTO collection_checkpoints(run_id, project_id, evidence_json)
        SELECT ?, ?, ? WHERE EXISTS (
          SELECT 1 FROM run_projects WHERE run_id=? AND project_id=? AND state='running'
        ) AND EXISTS (SELECT 1 FROM runs WHERE id=? AND status='running')
        ON CONFLICT(run_id, project_id) DO UPDATE SET evidence_json=excluded.evidence_json
        WHERE EXISTS (
          SELECT 1 FROM run_projects WHERE run_id=collection_checkpoints.run_id
            AND project_id=collection_checkpoints.project_id AND state='running')`)
        .run(runId, evidence.requestedProjectId, JSON.stringify(evidence), runId, evidence.requestedProjectId, runId);
      if (result.changes !== 1) throw new Error('Checkpoint must belong to a running project.');
    });
  }
  recordEvidence(id: string, input: ProjectEvidence): void {
    const evidence = this.#validated(input);
    this.#writeTransaction(() => {
      const result = this.#db.prepare(`UPDATE run_projects SET state=?, evidence_json=?
        WHERE run_id=? AND project_id=? AND state IN ('pending','running')
        AND EXISTS (SELECT 1 FROM runs WHERE id=? AND status='running')`)
        .run(evidence.outcome, JSON.stringify(evidence), id, evidence.requestedProjectId, id);
      if (result.changes !== 1) throw new Error('Evidence must belong to an unfinished project in a running run.');
      this.#db.prepare('DELETE FROM collection_checkpoints WHERE run_id=? AND project_id=?').run(id, evidence.requestedProjectId);
    });
  }

  completeRun(id: string): void {
    this.#writeTransaction(() => {
      const pending = this.#db.prepare("SELECT COUNT(*) AS count FROM run_projects WHERE run_id=? AND state IN ('pending','running')").get(id);
      if (Number(pending?.count) !== 0) throw new Error('Every requested project must have an outcome before completion.');
      const result = this.#db.prepare("UPDATE runs SET status='completed', finished_at=? WHERE id=? AND status='running'")
        .run(new Date().toISOString(), id);
      if (result.changes !== 1) throw new Error('Run must exist and be running.');
    });
  }
  interruptRun(id: string, reason = 'execution_failure'): void {
    this.#writeTransaction(() => {
      const result = this.#db.prepare("UPDATE runs SET status='interrupted', finished_at=?, interruption_reason=? WHERE id=? AND status IN ('queued','running')")
        .run(new Date().toISOString(), reason, id);
      if (result.changes !== 1) throw new Error('Only unfinished runs can be interrupted.');
      this.#promoteCheckpoints(id);
      this.#db.prepare("UPDATE run_projects SET state='interrupted' WHERE run_id=? AND state IN ('pending','running')").run(id);
    });
  }
  // All execution writes check lease ownership inside the same SQLite write transaction.
  // A paused previous process cannot commit results after a new owner takes over.
  #writeTransaction<T>(operation: () => T): T {
    return this.#transaction(() => {
      const lease = this.#db.prepare('SELECT owner,expires_at FROM collector_lease WHERE singleton=1').get();
      if (lease && (lease.owner !== this.#owner || Number(lease.expires_at) <= Date.now())) throw new LeaseError();
      if (!lease && this.#owner) throw new LeaseError();
      return operation();
    });
  }
  acquireLease(ttlMs = 15_000): void {
    if (!Number.isInteger(ttlMs) || ttlMs < 1000) throw new Error('Lease TTL must be at least 1000ms.');
    const owner = randomUUID();
    this.#transaction(() => {
      const row = this.#db.prepare('SELECT expires_at FROM collector_lease WHERE singleton=1').get();
      if (row && Number(row.expires_at) > Date.now()) throw new LeaseError();
      this.#db.prepare(`INSERT INTO collector_lease VALUES(1,?,?) ON CONFLICT(singleton)
        DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at`).run(owner, Date.now() + ttlMs);
    });
    this.#owner = owner;
  }
  renewLease(ttlMs = 15_000): void {
    const now = Date.now();
    const result = this.#db.prepare('UPDATE collector_lease SET expires_at=? WHERE singleton=1 AND owner=? AND expires_at>?')
      .run(now + ttlMs, this.#owner, now);
    if (result.changes !== 1) throw new LeaseError();
  }
  releaseLease(): void {
    this.#db.prepare('DELETE FROM collector_lease WHERE singleton=1 AND owner=?').run(this.#owner);
    this.#owner = null;
  }
  recoverInterruptedRuns(): number {
    // Recovery is explicit, only invoked by the collector after taking ownership.
    if (!this.#owner) throw new LeaseError();
    return this.#writeTransaction(() => {
      const active = this.#db.prepare("SELECT id FROM runs WHERE status IN ('queued','running')").all();
      const stamp = new Date().toISOString();
      for (const row of active) {
        this.#db.prepare("UPDATE runs SET status='interrupted',finished_at=?,interruption_reason='server_restart' WHERE id=?").run(stamp, row.id!);
        this.#promoteCheckpoints(String(row.id));
        this.#db.prepare("UPDATE run_projects SET state='interrupted' WHERE run_id=? AND state IN ('pending','running')").run(row.id!);
      }
      return active.length;
    });
  }
  // A checkpoint is a scratch copy of reads already returned. Promotion runs before
  // leftover rows are marked interrupted, and only while this write transaction is open.
  #promoteCheckpoints(runId: string): void {
    const rows = this.#db.prepare('SELECT project_id, evidence_json FROM collection_checkpoints WHERE run_id=?').all(runId);
    for (const row of rows) {
      const projectId = Number(row.project_id);
      try {
        const evidence = this.#validated(JSON.parse(String(row.evidence_json)) as ProjectEvidence);
        if ((evidence.outcome === 'partial' || evidence.outcome === 'failed') && evidence.requestedProjectId === projectId) {
          this.#db.prepare(`UPDATE run_projects SET state=?, evidence_json=?
            WHERE run_id=? AND project_id=? AND state IN ('pending','running')`)
            .run(evidence.outcome, JSON.stringify(evidence), runId, projectId);
        }
      } catch { /* An unreadable scratch copy cannot become evidence. */ }
      this.#db.prepare('DELETE FROM collection_checkpoints WHERE run_id=? AND project_id=?').run(runId, projectId);
    }
  }
  getActiveRun(): Run | null {
    const row = this.#db.prepare("SELECT id FROM runs WHERE status IN ('queued','running') ORDER BY sequence DESC LIMIT 1").get();
    return row ? this.getRun(row.id as string) : null;
  }
  getRun(id: string): Run | null {
    const row = this.#db.prepare('SELECT * FROM runs WHERE id=?').get(id) as unknown as RunRow | undefined;
    if (!row) return null;
    const rows = this.#db.prepare('SELECT * FROM run_projects WHERE run_id=? ORDER BY position').all(id) as unknown as ProjectRow[];
    return { id: row.id, sequence: row.sequence, requestedProjectIds: JSON.parse(row.requested_ids_json), status: row.status,
      createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at, interruptionReason: row.interruption_reason,
      projects: rows.map(project => ({ projectId: project.project_id, state: project.state,
        baselineRunId: project.baseline_run_id, evidence: project.evidence_json ? JSON.parse(project.evidence_json) : null })) };
  }
  listRuns(limit = 20): Run[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('History limit must be between 1 and 100.');
    return this.#db.prepare('SELECT id FROM runs ORDER BY sequence DESC LIMIT ?').all(limit).map(row => this.getRun(row.id as string)!);
  }
  getProjectHistory(projectId: number, limit = 20): { runId: string; project: RunProject }[] {
    parseProjectIds([String(projectId)]);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('History limit must be between 1 and 100.');
    return this.#db.prepare(`SELECT rp.run_id FROM run_projects rp JOIN runs r ON r.id=rp.run_id
      WHERE project_id=? ORDER BY r.sequence DESC LIMIT ?`).all(projectId, limit)
      .map(row => ({ runId: row.run_id as string, project: this.getRun(row.run_id as string)!.projects.find(project => project.projectId === projectId)! }));
  }
  getLatestProjectState(projectId: number): { latest: { runId: string; project: RunProject } | null;
    lastComplete: { runId: string; project: RunProject } | null } {
    parseProjectIds([String(projectId)]);
    const find = (complete: boolean) => {
      const row = this.#db.prepare(`SELECT rp.run_id FROM run_projects rp JOIN runs r ON r.id=rp.run_id
        WHERE project_id=? ${complete ? "AND rp.state='complete'" : ''} ORDER BY r.sequence DESC LIMIT 1`).get(projectId);
      return row ? { runId: row.run_id as string, project: this.getRun(row.run_id as string)!.projects.find(project => project.projectId === projectId)! } : null;
    };
    return { latest: find(false), lastComplete: find(true) };
  }
}
export function databasePath(): string { return process.env.DATABASE_PATH || 'data/evidence.sqlite'; }

export class LeaseError extends Error {
  constructor() { super('Collector ownership is unavailable. Another collector may be running; stop it or wait 15 seconds after a crash.'); }
}
export class ActiveRunError extends Error {
  runId: string;
  constructor(runId: string) { super('A collection is already active.'); this.runId = runId; }
}
