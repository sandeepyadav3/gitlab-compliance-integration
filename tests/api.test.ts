import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { harness, deferred, waitUntil } from './helpers.ts';

test('accepted collection is durable, responsive, reconnectable, and rejects duplicate starts', async () => {
  const gate = deferred(); let blocked = false;
  const app = await harness({ beforeReply: async url => { if (url.pathname === '/api/v4/projects/1') { blocked = true; await gate.promise; } } });
  try {
    const selection = await app.request('/api/selection', { projectIds: [1, 2, 3] }, 'PUT');
    assert.equal(selection.status, 200);
    const response = await app.request('/api/runs', {});
    assert.equal(response.status, 202);
    const accepted = (await response.json()).run;
    assert.equal(response.headers.get('location'), `/api/runs/${accepted.id}`);
    assert.deepEqual(app.store.getRun(accepted.id)?.requestedProjectIds, [1, 2, 3]);
    await waitUntil(() => blocked);
    assert.equal((await app.request('/health')).status, 200);
    const active = (await (await app.request('/api/runs/active')).json()).run;
    assert.equal(active.id, accepted.id); assert.equal(active.status, 'running');
    const conflict = await app.request('/api/runs', { projectIds: [4] });
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error.activeRunId, accepted.id);
    await app.request('/api/selection', { projectIds: [4] }, 'PUT');
    assert.deepEqual(app.store.getRun(accepted.id)?.requestedProjectIds, [1, 2, 3]);
    gate.resolve(); await app.service.waitForIdle();
    const result = (await (await app.request(`/api/runs/${accepted.id}`)).json()).run;
    assert.equal(result.status, 'completed'); assert.equal(result.progress.finished, 3); assert.equal(result.progress.percent, 100);
    assert.deepEqual(result.projects.map((project: { evidence: { posture: string } }) => project.evidence.posture), ['protected', 'unprotected', 'no_default_branch']);
    assert.equal((await (await app.request('/api/runs/active')).json()).run, null);
    assert.equal((await (await app.request('/api/runs')).json()).runs[0].id, accepted.id);
    assert.ok(!JSON.stringify([result, app.logs]).includes('http-mock-only-token'));
  } finally { gate.resolve(); await app.close(); }
});
test('partial failure preserves baseline, exposes latest versus last complete, and recovers on a new run', async () => {
  let fail = false;
  const app = await harness({ reply: url => fail && url.pathname.endsWith('/protected_branches') ? { status: 403 } : undefined });
  try {
    const first = (await (await app.request('/api/runs', { projectIds: [1] })).json()).run.id;
    await app.service.waitForIdle(); fail = true;
    const second = (await (await app.request('/api/runs', { projectIds: [1] })).json()).run.id;
    await app.service.waitForIdle();
    const detail = await (await app.request(`/api/runs/${second}`)).json();
    assert.equal(detail.run.status, 'completed'); assert.equal(detail.run.progress.partial, 1);
    assert.equal(detail.run.projects[0].baselineRunId, first);
    assert.equal(detail.run.projects[0].evidence.posture, 'protected');
    assert.equal(detail.run.projects[0].evidence.protectionRules.sources[0].error.code, 'forbidden');
    const state = await (await app.request('/api/projects/1')).json();
    assert.equal(state.latest.runId, second); assert.equal(state.lastComplete.runId, first);
    fail = false;
    const third = (await (await app.request('/api/runs', { projectIds: [1] })).json()).run.id;
    await app.service.waitForIdle();
    assert.equal(app.store.getRun(third)?.projects[0]?.state, 'complete');
    assert.equal(app.store.getRun(third)?.projects[0]?.baselineRunId, first);
    const history = await (await app.request('/api/projects/1/history')).json();
    assert.deepEqual(history.history.map((row: { runId: string }) => row.runId), [third, second, first]);
  } finally { await app.close(); }
});
test('worker concurrency is bounded while project output order is preserved', async () => {
  const gate = deferred(); let started = 0;
  const app = await harness({ concurrency: 2, beforeReply: async url => { if (/\/projects\/\d+$/.test(url.pathname)) { started++; await gate.promise; } } });
  try {
    const id = (await (await app.request('/api/runs', { projectIds: [4, 3, 2, 1] })).json()).run.id;
    await waitUntil(() => started === 2);
    assert.equal(app.requests.length, 2);
    assert.equal(app.store.getRun(id)?.projects.filter(project => project.state === 'running').length, 2);
    gate.resolve(); await app.service.waitForIdle();
    assert.equal(started, 4);
    assert.deepEqual(app.store.getRun(id)?.projects.map(project => project.projectId), [4, 3, 2, 1]);
  } finally { gate.resolve(); await app.close(); }
});
test('deadline aborts a hanging provider and accounts for unfinished projects', async () => {
  const gate = deferred();
  const app = await harness({ runTimeoutMs: 100, concurrency: 1, beforeReply: async () => gate.promise });
  try {
    const id = (await (await app.request('/api/runs', { projectIds: [1, 2] })).json()).run.id;
    await app.service.waitForIdle();
    const run = app.store.getRun(id)!;
    assert.equal(run.status, 'interrupted'); assert.equal(run.interruptionReason, 'time_limit');
    assert.deepEqual(run.projects.map(project => project.state), ['interrupted', 'interrupted']);
  } finally { gate.resolve(); await app.close(); }
});
test('graceful stop aborts active I/O and preserves finished projects', async () => {
  const gate = deferred(); let blocked = false;
  const app = await harness({ concurrency: 1, beforeReply: async url => { if (url.pathname === '/api/v4/projects/1') { blocked = true; await gate.promise; } } });
  try {
    const id = (await (await app.request('/api/runs', { projectIds: [3, 1] })).json()).run.id;
    await waitUntil(() => blocked);
    await app.service.stop();
    const run = app.store.getRun(id)!;
    assert.equal(run.status, 'interrupted'); assert.equal(run.interruptionReason, 'server_shutdown');
    assert.deepEqual(run.projects.map(project => project.state), ['complete', 'interrupted']);
  } finally { gate.resolve(); await app.close(); }
});
test('API rejects invalid selections, unknown properties, oversized or malformed JSON', async () => {
  const app = await harness();
  try {
    for (const body of [{ projectIds: [] }, { projectIds: ['1'] }, { projectIds: [-1] }, { projectIds: [1.5] }, { projectIds: [1], token: 'not-accepted' }, { projectIds: Array(26).fill(1) }]) {
      assert.equal((await app.request('/api/runs', body)).status, 400);
    }
    const malformed = await fetch(app.base + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
    const large = await fetch(app.base + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(17000) });
    assert.equal(large.status, 413);
    assert.equal((await fetch(app.base + '/api/runs', { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await app.request('/api/runs', {})).status, 400);
    assert.equal(app.store.listRuns().length, 0); assert.equal(app.requests.length, 0);
  } finally { await app.close(); }
});
test('local API enforces host/origin boundaries and returns safe not-found/limit errors', async () => {
  const app = await harness();
  try {
    const hostStatus = await new Promise<number>(resolve => {
      const request = httpRequest(app.base + '/api/runs', { headers: { host: 'attacker.example' } }, response => {
        response.resume(); resolve(response.statusCode!);
      });
      request.end();
    });
    assert.equal(hostStatus, 421);
    for (const origin of ['https://attacker.example', 'null']) {
      assert.equal((await fetch(app.base + '/api/runs', { headers: { origin } })).status, 403);
    }
    const cors = await fetch(app.base + '/api/selection', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } });
    assert.equal(cors.status, 204); assert.equal(cors.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal((await app.request('/api/runs?limit=101')).status, 400);
    assert.equal((await app.request('/api/runs?limit=-1')).status, 400);
    assert.equal((await app.request('/api/projects/9007199254740992')).status, 400);
    const missing = await app.request('/api/runs/00000000-0000-0000-0000-000000000000');
    assert.equal(missing.status, 404); assert.ok((await missing.json()).error.requestId);
    assert.equal((await app.request('/.env')).status, 404);
  } finally { await app.close(); }
});
test('missing token allows inspection but prevents provider collection', async () => {
  const app = await harness({ tokenConfigured: false });
  try {
    assert.equal((await app.request('/health')).status, 200);
    assert.equal((await app.request('/api/selection', { projectIds: [1] }, 'PUT')).status, 200);
    const response = await app.request('/api/runs', {});
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'token_not_configured');
    assert.equal(app.requests.length, 0);
  } finally { await app.close(); }
});

test('shutdown cancels retry backoff without sending another provider request', async () => {
  const app = await harness({ reply: () => ({ status: 503, headers: { 'retry-after': '5' } }) });
  try {
    const id = (await (await app.request('/api/runs', { projectIds: [1] })).json()).run.id;
    await waitUntil(() => app.requests.length === 1);
    await app.service.stop();
    assert.equal(app.requests.length, 1);
    assert.equal(app.store.getRun(id)?.status, 'interrupted');
    assert.equal(app.store.getRun(id)?.interruptionReason, 'server_shutdown');
  } finally { await app.close(); }
});

test('API comparisons identify stable baselines, real setting changes, failure coverage, and recovery', async () => {
  let forcePush = false; let fail = false;
  const app = await harness({ reply: url => {
    if (!url.pathname.endsWith('/protected_branches')) return undefined;
    if (fail) return { status: 403 };
    return { body: [{ id: forcePush ? 100 : 9, name: 'main', push_access_levels: [{ access_level: 40 }],
      merge_access_levels: [{ access_level: 40 }], allow_force_push: forcePush }] };
  } });
  try {
    const collect = async () => {
      const run = (await (await app.request('/api/runs', { projectIds: [1] })).json()).run;
      await app.service.waitForIdle(); return run.id as string;
    };
    const first = await collect(); forcePush = true; const second = await collect();
    const detail = (await (await app.request(`/api/runs/${second}`)).json()).run;
    const comparison = detail.projects[0].comparison;
    assert.equal(comparison.status, 'changed'); assert.equal(comparison.baseline.runId, first);
    assert.equal(comparison.changes[0].field, 'rules["main"].allowForcePush');
    const dedicated = await (await app.request(`/api/runs/${second}/comparisons`)).json();
    assert.deepEqual(dedicated.projects[0].comparison, comparison);
    fail = true; const third = await collect();
    const partial = (await (await app.request(`/api/runs/${third}`)).json()).run.projects[0].comparison;
    assert.equal(partial.status, 'incomplete'); assert.equal(partial.baseline.runId, second);
    assert.equal(partial.changes.length, 0);
    fail = false; const fourth = await collect();
    const recovered = (await (await app.request(`/api/runs/${fourth}`)).json()).run.projects[0].comparison;
    assert.equal(recovered.status, 'unchanged'); assert.equal(recovered.baseline.runId, second);
    assert.deepEqual((await (await app.request(`/api/runs/${second}/comparisons`)).json()).projects[0].comparison, comparison);
    assert.equal(app.store.getRun(second)?.projects[0]?.evidence?.protectionRules.value?.[0]?.allow_force_push, true);
  } finally { await app.close(); }
});
