import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EvidenceStore } from '../src/storage/store.ts';
import { collectProject } from '../src/gitlab/collector.ts';
import { GitLabClient } from '../src/gitlab/client.ts';
import type { ProjectEvidence } from '../src/gitlab/types.ts';

const stamp = '2026-10-22T07:17:19.049Z';
function empty(id = 101): ProjectEvidence {
  return { requestedProjectId: id, startedAt: stamp, finishedAt: stamp, outcome: 'complete', posture: 'no_default_branch',
    project: { status: 'collected', value: { id, name: 'Synthetic empty project', web_url: `https://gitlab.com/synthetic/${id}`, visibility: 'private', default_branch: 'main', empty_repo: true },
      sources: [{ url: `https://gitlab.com/api/v4/projects/${id}`, observedAt: stamp, httpStatus: 200, attempts: 1, error: null }] },
    branch: { status: 'not_applicable', value: null, sources: [] },
    protectionRules: { status: 'not_applicable', value: null, sources: [] }, matchingRules: [], issues: [] };
}
function failed(id = 101): ProjectEvidence {
  const evidence = empty(id);
  evidence.outcome = 'failed'; evidence.posture = 'unknown';
  evidence.project = { status: 'failed', value: null, sources: [{ url: `https://gitlab.com/api/v4/projects/${id}`, observedAt: stamp, httpStatus: 403, attempts: 1,
    error: { code: 'forbidden', message: 'GitLab denied access.', action: 'Check permissions.' } }] };
  evidence.branch.status = 'not_collected'; evidence.protectionRules.status = 'not_collected';
  return evidence;
}
function finish(store: EvidenceStore, evidence = empty()): string {
  const run = store.createRun([evidence.requestedProjectId]); store.startRun(run.id);
  store.recordEvidence(run.id, evidence); store.completeRun(run.id); return run.id;
}
function withStore(run: (store: EvidenceStore, path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-evidence-'));
  const path = join(dir, 'nested', 'history.sqlite');
  const store = new EvidenceStore(path);
  try { run(store, path); } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}
test('selection and observations survive reopening and another Node process', () => {
  withStore((store, path) => {
    store.saveSelection([202, 101, 202]);
    const id = finish(store);
    const reopened = new EvidenceStore(path);
    try {
      assert.deepEqual(reopened.getSelection().projectIds, [202, 101]);
      assert.deepEqual(reopened.getRun(id)?.projects[0]?.evidence, empty());
    } finally { reopened.close(); }
    const output = spawnSync(process.execPath, ['--experimental-strip-types', 'src/cli/history.ts', id], {
      encoding: 'utf8', env: { ...process.env, DATABASE_PATH: path },
    });
    assert.equal(output.status, 0, output.stderr);
    assert.equal(JSON.parse(output.stdout).id, id);
  });
});
test('requested selection is an immutable snapshot with one entry per distinct ID', () => {
  withStore(store => {
    store.saveSelection([202, 101]);
    const run = store.createRun([202, 101, 202]);
    store.saveSelection([303]);
    assert.deepEqual(store.getRun(run.id)?.requestedProjectIds, [202, 101]);
    assert.deepEqual(store.getRun(run.id)?.projects.map(project => project.projectId), [202, 101]);
    assert.equal(store.getRun(run.id)?.projects.every(project => project.state === 'pending'), true);
  });
});
test('invalid selections do not create a run or alter saved configuration', () => {
  withStore(store => {
    store.saveSelection([101]);
    for (const ids of [[], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1]]) {
      assert.throws(() => store.saveSelection(ids)); assert.throws(() => store.createRun(ids));
    }
    assert.deepEqual(store.getSelection().projectIds, [101]); assert.equal(store.listRuns().length, 0);
  });
});
test('each project has its own previous complete baseline, frozen at run creation', () => {
  withStore(store => {
    const first = finish(store, empty(101));
    const other = finish(store, empty(202));
    const pending = store.createRun([101, 202, 303]);
    finish(store, empty(101));
    assert.deepEqual(store.getRun(pending.id)?.projects.map(project => project.baselineRunId), [first, other, null]);
  });
});
test('failed attempts preserve complete evidence and are skipped as baselines', () => {
  withStore(store => {
    const first = finish(store);
    const failure = finish(store, failed());
    const latest = store.getLatestProjectState(101);
    assert.equal(latest.latest?.runId, failure); assert.equal(latest.lastComplete?.runId, first);
    assert.equal(latest.latest?.project.state, 'failed');
    assert.equal(store.createRun([101]).projects[0]?.baselineRunId, first);
    assert.deepEqual(store.getRun(first)?.projects[0]?.evidence, empty());
  });
});
test('observations cannot be overwritten, duplicated, or added to the wrong run', () => {
  withStore(store => {
    const run = store.createRun([101]);
    assert.throws(() => store.recordEvidence(run.id, empty()));
    store.startRun(run.id);
    assert.throws(() => store.recordEvidence(run.id, empty(202)));
    store.recordEvidence(run.id, empty());
    assert.throws(() => store.recordEvidence(run.id, failed()));
    store.completeRun(run.id);
    assert.throws(() => store.startRun(run.id));
    assert.throws(() => store.interruptRun(run.id));
    assert.throws(() => store.recordEvidence(run.id, empty()));
  });
});
test('completion rejects missing outcomes; mixed complete/failed results are retained', () => {
  withStore(store => {
    const run = store.createRun([101, 202]); store.startRun(run.id);
    store.recordEvidence(run.id, empty(101));
    assert.throws(() => store.completeRun(run.id));
    assert.equal(store.getRun(run.id)?.status, 'running');
    store.recordEvidence(run.id, failed(202)); store.completeRun(run.id);
    assert.equal(store.getRun(run.id)?.status, 'completed');
    assert.deepEqual(store.getRun(run.id)?.projects.map(project => project.state), ['complete', 'failed']);
  });
});
test('interruption accounts for unfinished projects and preserves completed observations', () => {
  withStore(store => {
    const run = store.createRun([101, 202]); store.startRun(run.id); store.recordEvidence(run.id, empty());
    store.interruptRun(run.id);
    assert.deepEqual(store.getRun(run.id)?.projects.map(project => project.state), ['complete', 'interrupted']);
    assert.deepEqual(store.getRun(run.id)?.projects[0]?.evidence, empty());
    assert.equal(store.getRun(run.id)?.status, 'interrupted');
    assert.ok(store.getRun(run.id)?.finishedAt);
    assert.equal(store.createRun([101]).projects[0]?.baselineRunId, run.id);
  });
});
test('storage schema prevents history rewrites and invalid direct writes', () => {
  withStore((store, path) => {
    const id = finish(store);
    const raw = new DatabaseSync(path);
    try {
      raw.exec('PRAGMA foreign_keys=ON');
      assert.throws(() => raw.prepare("UPDATE run_projects SET evidence_json='{}' WHERE run_id=?").run(id));
      assert.throws(() => raw.prepare('DELETE FROM run_projects WHERE run_id=?').run(id));
      assert.throws(() => raw.prepare('DELETE FROM runs WHERE id=?').run(id));
      assert.throws(() => raw.prepare("UPDATE runs SET requested_ids_json='[]' WHERE id=?").run(id));
      assert.throws(() => raw.prepare("UPDATE runs SET status='running' WHERE id=?").run(id));
    } finally { raw.close(); }
  });
});
test('evidence is validated and detached from caller-owned mutable objects', () => {
  withStore(store => {
    const run = store.createRun([101]); store.startRun(run.id);
    const invalid = empty(); invalid.posture = 'unknown';
    assert.throws(() => store.recordEvidence(run.id, invalid));
    const input = empty(); store.recordEvidence(run.id, input);
    input.project.value!.name = 'Changed after storage';
    const read = store.getRun(run.id)!; read.projects[0]!.evidence!.project.value!.name = 'Changed after read';
    assert.equal(store.getRun(run.id)?.projects[0]?.evidence?.project.value?.name, 'Synthetic empty project');
  });
});
test('unsupported future schema versions fail without destroying data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-schema-'));
  const path = join(dir, 'future.sqlite'); const raw = new DatabaseSync(path);
  raw.exec('CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES (\'keep\'); PRAGMA user_version=99'); raw.close();
  try {
    assert.throws(() => new EvidenceStore(path), /Unsupported database version/);
    const check = new DatabaseSync(path);
    try { assert.equal(check.prepare('SELECT value FROM marker').get()?.value, 'keep'); } finally { check.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('history is newest first with bounded limits; absent projects have no invented evidence', () => {
  withStore(store => {
    const first = finish(store); const second = finish(store, failed());
    assert.deepEqual(store.listRuns(2).map(run => run.id), [second, first]);
    assert.equal(store.getProjectHistory(101).length, 2);
    assert.deepEqual(store.getLatestProjectState(202), { latest: null, lastComplete: null });
    assert.equal(store.getRun('missing'), null);
    assert.throws(() => store.listRuns(101)); assert.throws(() => store.getProjectHistory(101, 0));
  });
});
test('real collector HTTP partial failure round-trips through SQLite and retains provenance', async () => {
  const server = createServer((req, res) => {
    assert.equal(req.method, 'GET');
    if (req.url === '/api/v4/projects/101') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 101, name: 'Synthetic protected', web_url: 'https://gitlab.com/test/synthetic', visibility: 'private', default_branch: 'main', empty_repo: false }));
    } else if (req.url === '/api/v4/projects/101/repository/branches/main') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ name: 'main', protected: true }));
    } else { res.writeHead(403); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const client = new GitLabClient({ token: 'mock-only', transport: async (input, init) => {
      const url = new URL(String(input)); return fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, init);
    } });
    const evidence = await collectProject(client, 101);
    withStore(store => {
      const id = finish(store, evidence);
      const saved = store.getRun(id)!.projects[0]!;
      assert.equal(saved.state, 'partial'); assert.equal(saved.evidence?.posture, 'protected');
      assert.equal(saved.evidence?.protectionRules.sources[0]?.error?.code, 'forbidden');
      assert.deepEqual(saved.evidence, evidence);
      assert.equal(store.getLatestProjectState(101).lastComplete, null);
    });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
