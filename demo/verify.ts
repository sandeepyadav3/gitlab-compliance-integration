import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createDemo } from './scenario.ts';

const app = await createDemo();
try {
  const baseline = await app.collect();
  assert.deepEqual(baseline.projects.map(p => p.evidence?.posture), ['protected', 'unprotected', 'no_default_branch']);
  assert.ok(baseline.projects.every(p => p.state === 'complete'));
  const frozen = JSON.stringify(app.store.getRun(baseline.id));
  app.setMode('denied');
  const partial = await app.collect();
  assert.deepEqual(partial.projects.map(p => p.state), ['partial', 'complete', 'complete']);
  const failed = partial.projects[0]!;
  assert.equal(failed.baselineRunId, baseline.id);
  assert.equal(failed.evidence?.branch.value?.protected, true);
  assert.equal(failed.evidence?.protectionRules.status, 'failed');
  assert.equal(failed.evidence?.protectionRules.sources[0]?.httpStatus, 403);
  assert.equal(failed.comparison.status, 'incomplete');
  assert.equal(failed.comparison.changes.length, 0);
  assert.equal(app.store.getLatestProjectState(1).lastComplete?.runId, baseline.id);
  app.setMode('healthy');
  const recovery = await app.collect();
  assert.ok(recovery.projects.every(p => p.state === 'complete'));
  assert.equal(recovery.projects[0]!.baselineRunId, baseline.id);
  assert.equal(recovery.projects[0]!.comparison.status, 'unchanged');
  assert.equal(recovery.projects[1]!.baselineRunId, partial.id);
  assert.equal(JSON.stringify(app.store.getRun(baseline.id)), frozen);
  assert.equal(app.store.getRun(partial.id)!.projects[0]!.state, 'partial');
  assert.ok(app.requests.length > 0);
  const output = resolve(process.argv[2] ?? 'artifacts/mock-demo.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({
    provenance: 'SYNTHETIC: actual backend/collector/SQLite with localhost mocked GitLab HTTP. Not live GitLab evidence.',
    generatedAt: new Date().toISOString(),
    verified: ['three project states', '403 preserves known protected status', 'other projects complete',
      'incomplete comparison does not infer removals', 'previous complete evidence retained',
      'recovery skips partial baseline per project', 'historical observations unchanged'],
    runs: [baseline, partial, recovery],
  }, null, 2) + '\n');
  console.log(`Mock demo verified: complete -> partial 403 -> recovered.\nSynthetic evidence: ${output}`);
} finally { await app.close(); }
