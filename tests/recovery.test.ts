import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EvidenceStore, LeaseError } from '../src/storage/store.ts';
import { schema } from '../src/storage/schema.ts';
import { CollectionService } from '../src/collection/service.ts';
import { GitLabClient } from '../src/gitlab/client.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-recovery-')); const path = join(dir, 'state.sqlite');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
test('version 1 database migrates in place without changing existing run IDs or snapshots', () => {
  const fixture = setup(); const raw = new DatabaseSync(fixture.path);
  raw.exec(schema + '; PRAGMA user_version=1;');
  raw.prepare("INSERT INTO runs(id,requested_ids_json,status,created_at,finished_at) VALUES('phase2-run','[101]','completed','2026-10-22T00:00:00Z','2026-10-22T00:00:01Z')").run();
  raw.prepare("INSERT INTO run_projects(run_id,project_id,position,state) VALUES('phase2-run',101,0,'interrupted')").run();
  raw.close();
  const store = new EvidenceStore(fixture.path);
  try {
    assert.equal(store.getRun('phase2-run')?.status, 'completed');
    assert.deepEqual(store.getRun('phase2-run')?.requestedProjectIds, [101]);
    assert.equal(store.getRun('phase2-run')?.interruptionReason, null);
    const check = new DatabaseSync(fixture.path);
    try { assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 2); } finally { check.close(); }
  } finally { store.close(); fixture.cleanup(); }
});
test('opening history does not recover work; owned collector startup recovers unfinished runs', async () => {
  const fixture = setup(); let store = new EvidenceStore(fixture.path);
  const run = store.createRun([101, 202]); store.startRun(run.id); store.startProject(run.id, 101); store.close();
  store = new EvidenceStore(fixture.path);
  try {
    assert.equal(store.getRun(run.id)?.status, 'running');
    const service = new CollectionService({ store, clientFactory: signal => new GitLabClient({ token: 'unused-test', signal }) });
    assert.equal(service.start(), 1);
    assert.equal(store.getRun(run.id)?.status, 'interrupted');
    assert.equal(store.getRun(run.id)?.interruptionReason, 'server_restart');
    assert.deepEqual(store.getRun(run.id)?.projects.map(project => project.state), ['interrupted', 'interrupted']);
    await service.stop();
  } finally { store.close(); fixture.cleanup(); }
});
test('lease blocks a second collector and its execution writes without interrupting the first', () => {
  const fixture = setup(); const first = new EvidenceStore(fixture.path); const second = new EvidenceStore(fixture.path);
  try {
    first.acquireLease(); const run = first.createRun([101], true); first.startRun(run.id);
    assert.throws(() => second.acquireLease(), LeaseError);
    assert.throws(() => second.createRun([202]), LeaseError);
    assert.throws(() => second.interruptRun(run.id), LeaseError);
    assert.equal(first.getRun(run.id)?.status, 'running');
    first.interruptRun(run.id); first.releaseLease(); second.acquireLease(); second.releaseLease();
  } finally { first.close(); second.close(); fixture.cleanup(); }
});
test('expired-owner takeover fences old writes and old release cannot delete the new lease', () => {
  const fixture = setup(); const old = new EvidenceStore(fixture.path); const next = new EvidenceStore(fixture.path);
  try {
    old.acquireLease(); const run = old.createRun([101]); old.startRun(run.id);
    const raw = new DatabaseSync(fixture.path); raw.exec('UPDATE collector_lease SET expires_at=0'); raw.close();
    next.acquireLease(); assert.equal(next.recoverInterruptedRuns(), 1);
    assert.throws(() => old.renewLease(), LeaseError);
    assert.throws(() => old.startProject(run.id, 101), LeaseError);
    old.releaseLease();
    const third = new EvidenceStore(fixture.path);
    try { assert.throws(() => third.acquireLease(), LeaseError); } finally { third.close(); }
    next.releaseLease();
  } finally { old.close(); next.close(); fixture.cleanup(); }
});
test('atomic idle check prevents two accepted active runs', () => {
  const store = new EvidenceStore(':memory:');
  try { store.createRun([101], true); assert.throws(() => store.createRun([202], true), /already active/); assert.equal(store.listRuns().length, 1); }
  finally { store.close(); }
});
test('unexpected worker failures are sanitized and leave no permanently running work', async () => {
  const store = new EvidenceStore(':memory:'); const logs: unknown[] = [];
  const service = new CollectionService({ store, clientFactory: signal => new GitLabClient({ token: 'test-only', signal }),
    logger: entry => logs.push(entry), collector: async () => { throw new Error('secret-from-exception'); } });
  try {
    service.start(); const run = service.enqueue([101]); await service.waitForIdle();
    assert.equal(store.getRun(run.id)?.status, 'interrupted');
    assert.equal(store.getRun(run.id)?.interruptionReason, 'execution_failure');
    assert.ok(!JSON.stringify(logs).includes('secret-from-exception'));
  } finally { await service.stop(); store.close(); }
});
