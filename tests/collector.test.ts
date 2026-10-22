import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GitLabClient } from '../src/gitlab/client.ts';
import { collectProject, matchesRule, parseProjectIds } from '../src/gitlab/collector.ts';
import { projectSchema } from '../src/gitlab/schemas.ts';
import type { ProjectEvidence } from '../src/gitlab/types.ts';

type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; hang?: boolean };
const project = { id: 101, name: 'Example', web_url: 'https://gitlab.com/synthetic/example', visibility: 'private', default_branch: 'main', empty_repo: false };
const rule = { id: 1, name: 'main', push_access_levels: [{ access_level: 40, access_level_description: 'Maintainers' }], merge_access_levels: [{ access_level: 40 }], allow_force_push: false };
async function mocked(replies: Reply[], run: (client: GitLabClient, requests: { path: string; method: string | undefined }[], sleeps: number[]) => Promise<void>, options: { timeoutMs?: number } = {}): Promise<void> {
  const requests: { path: string; method: string | undefined }[] = [];
  const sleeps: number[] = [];
  const server = createServer((req, res) => {
    requests.push({ path: req.url!, method: req.method });
    assert.equal(req.headers['private-token'], 'test-only-token');
    const reply = replies.shift();
    if (!reply) { res.writeHead(500); res.end(); return; }
    if (reply.hang) return;
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers });
    res.end(JSON.stringify(reply.body ?? {}));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const transport: typeof fetch = async (input, init) => {
    const original = new URL(String(input));
    assert.equal(original.origin, 'https://gitlab.com');
    return fetch(`http://127.0.0.1:${port}${original.pathname}${original.search}`, init);
  };
  const client = new GitLabClient({ token: 'test-only-token', transport, timeoutMs: options.timeoutMs ?? 1000, sleep: async ms => { sleeps.push(ms); } });
  try { await run(client, requests, sleeps); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

test('protected project retains selected metadata, status, restrictions, and sources', async () => {
  await mocked([{ body: { ...project, secret_extra: 'discarded' } }, { body: { name: 'main', protected: true, commit: { message: 'not collected' } } }, { body: [rule] }], async (client, requests) => {
    const value = await collectProject(client, 101);
    assert.equal(value.outcome, 'complete'); assert.equal(value.posture, 'protected');
    assert.equal(value.matchingRules[0]?.push_access_levels[0]?.access_level, 40);
    assert.equal(value.project.sources[0]?.httpStatus, 200);
    assert.ok(value.project.sources[0]?.observedAt);
    assert.ok(!JSON.stringify(value).includes('secret_extra'));
    assert.ok(!JSON.stringify(value).includes('not collected'));
    assert.ok(!JSON.stringify(value).includes('test-only-token'));
    assert.ok(requests.every(request => request.method === 'GET'));
  });
});
test('successful empty rules and unprotected branch confirm unprotected posture', async () => {
  await mocked([{ body: project }, { body: { name: 'main', protected: false } }, { body: [] }], async client => {
    const value = await collectProject(client, 101);
    assert.equal(value.outcome, 'complete'); assert.equal(value.posture, 'unprotected');
  });
});
test('confirmed empty repository is complete with no default branch, not unprotected', async () => {
  await mocked([{ body: { ...project, default_branch: null, empty_repo: true } }], async (client, requests) => {
    const value = await collectProject(client, 101);
    assert.equal(value.outcome, 'complete'); assert.equal(value.posture, 'no_default_branch');
    assert.equal(value.branch.status, 'not_applicable'); assert.equal(requests.length, 1);
  });
});
test('null default branch without confirmed emptiness remains unknown', async () => {
  await mocked([{ body: { ...project, default_branch: null } }], async client => {
    const value = await collectProject(client, 101);
    assert.equal(value.outcome, 'partial'); assert.equal(value.posture, 'unknown');
  });
});
test('unreadable rules preserve observed protected status and project metadata', async () => {
  await mocked([{ body: project }, { body: { name: 'main', protected: true } }, { status: 403 }], async (client, requests) => {
    const value = await collectProject(client, 101);
    assert.equal(value.outcome, 'partial'); assert.equal(value.posture, 'protected');
    assert.equal(value.protectionRules.value, null);
    assert.equal(value.protectionRules.sources[0]?.error?.code, 'forbidden');
    assert.equal(requests.length, 3);
  });
});
test('404 for a project records failure, not a confirmed absence', async () => {
  await mocked([{ status: 404 }], async (client, requests) => {
    const value = await collectProject(client, 101);
    assert.equal(value.outcome, 'failed'); assert.equal(value.posture, 'unknown');
    assert.equal(value.project.sources[0]?.error?.code, 'not_found_or_inaccessible');
    assert.equal(requests.length, 1);
  });
});
test('branch lookup failure can coexist with successfully collected rule configuration', async () => {
  await mocked([{ body: project }, { status: 404 }, { body: [rule] }], async client => {
    const value = await collectProject(client, 101);
    assert.equal(value.outcome, 'partial'); assert.equal(value.posture, 'unknown');
    assert.equal(value.protectionRules.status, 'collected'); assert.equal(value.matchingRules.length, 1);
  });
});
test('all paginated rules are read and wildcard matches retained', async () => {
  await mocked([{ body: project }, { body: { name: 'main', protected: true } }, { body: [{ ...rule, name: 'release/*' }], headers: { 'x-next-page': '2' } }, { body: [{ ...rule, id: 2, name: 'm*' }], headers: { 'x-next-page': '' } }], async (client, requests) => {
    const value = await collectProject(client, 101);
    assert.equal(value.outcome, 'complete'); assert.equal(value.protectionRules.value?.length, 2);
    assert.deepEqual(value.matchingRules.map(rule => rule.name), ['m*']);
    assert.ok(requests[3]?.path.endsWith('page=2'));
    assert.equal(value.matchingRules[0]?.inherited, undefined);
  });
});
test('later-page failure preserves earlier rules without asserting completeness', async () => {
  await mocked([{ body: project }, { body: { name: 'main', protected: true } }, { body: [rule], headers: { 'x-next-page': '2' } }, { status: 403 }], async client => {
    const value = await collectProject(client, 101);
    assert.equal(value.outcome, 'partial'); assert.equal(value.protectionRules.status, 'partial');
    assert.equal(value.protectionRules.value?.length, 1);
    assert.equal(value.protectionRules.sources.length, 2);
  });
});
test('pagination loops are bounded and visible', async () => {
  await mocked([{ body: project }, { body: { name: 'main', protected: true } }, { body: [rule], headers: { 'x-next-page': '1' } }], async client => {
    const value = await collectProject(client, 101);
    assert.equal(value.protectionRules.status, 'partial');
    assert.equal(value.protectionRules.sources.at(-1)?.error?.code, 'pagination_limit');
  });
});
test('contradictory status and configuration remain partial', async () => {
  await mocked([{ body: project }, { body: { name: 'main', protected: true } }, { body: [] }], async client => {
    const value = await collectProject(client, 101);
    assert.equal(value.outcome, 'partial'); assert.equal(value.posture, 'protected');
    assert.equal(value.issues[0]?.code, 'inconsistent_evidence');
  });
});
test('wrong project and branch identities are not accepted as complete evidence', async () => {
  await mocked([{ body: { ...project, id: 202 } }], async client => {
    const value = await collectProject(client, 101);
    assert.equal(value.outcome, 'partial'); assert.equal(value.posture, 'unknown');
  });
  await mocked([{ body: project }, { body: { name: 'other', protected: false } }, { body: [] }], async client => {
    const value = await collectProject(client, 101);
    assert.equal(value.outcome, 'partial'); assert.equal(value.posture, 'unknown');
  });
});
test('branch names containing slashes are encoded as one path segment', async () => {
  await mocked([{ body: { ...project, default_branch: 'release/1.0' } }, { body: { name: 'release/1.0', protected: false } }, { body: [] }], async (client, requests) => {
    await collectProject(client, 101);
    assert.ok(requests[1]?.path.endsWith('/branches/release%2F1.0'));
  });
});
test('schema mismatch is a visible failure without exposing response contents', async () => {
  await mocked([{ body: { message: 'do not expose test-only-token' } }], async client => {
    const value = await collectProject(client, 101);
    assert.equal(value.project.sources[0]?.error?.code, 'invalid_response');
    assert.ok(!JSON.stringify(value).includes('test-only-token'));
  });
});
test('429 retry respects Retry-After and records the attempt count', async () => {
  await mocked([{ status: 429, headers: { 'retry-after': '2' } }, { body: project }], async (client, requests, sleeps) => {
    const value = await client.get('/projects/101', projectSchema);
    assert.equal(value.value?.id, 101); assert.equal(value.source.attempts, 2);
    assert.deepEqual(sleeps, [2000]); assert.equal(requests.length, 2);
  });
});
test('long Retry-After returns a visible error rather than retrying early', async () => {
  await mocked([{ status: 429, headers: { 'retry-after': '120' } }], async (client, requests, sleeps) => {
    const value = await client.get('/projects/101', projectSchema);
    assert.equal(value.source.error?.code, 'rate_limited');
    assert.equal(requests.length, 1); assert.equal(sleeps.length, 0);
  });
});
test('transient provider failures stop after three attempts', async () => {
  await mocked([{ status: 503 }, { status: 503 }, { status: 503 }], async (client, requests) => {
    const value = await client.get('/projects/101', projectSchema);
    assert.equal(value.source.error?.code, 'provider_error'); assert.equal(requests.length, 3);
  });
});
test('request timeout stops hanging connections after bounded retries', async () => {
  await mocked([{ hang: true }, { hang: true }, { hang: true }], async client => {
    const value = await client.get('/projects/101', projectSchema);
    assert.equal(value.source.error?.code, 'timeout'); assert.equal(value.source.attempts, 3);
  }, { timeoutMs: 30 });
});
test('unsafe paths and missing tokens are rejected before making requests', async () => {
  assert.throws(() => new GitLabClient({ token: '' }));
  const client = new GitLabClient({ token: 'test' });
  await assert.rejects(client.get('//attacker.example/projects/101', projectSchema));
});
test('wildcards are case sensitive; regex punctuation is literal', () => {
  assert.equal(matchesRule('release/*', 'release/1.2'), true);
  assert.equal(matchesRule('main', 'Main'), false);
  assert.equal(matchesRule('release.1', 'releaseX1'), false);
  assert.equal(matchesRule('*', 'main'), true);
});
test('project selection validates and deduplicates numeric IDs', () => {
  assert.deepEqual(parseProjectIds(['101,202', '101']), [101, 202]);
  for (const input of [[], ['0'], ['-1'], ['abc'], ['1.5'], ['9007199254740992']]) assert.throws(() => parseProjectIds(input));
});

test('progress snapshots stay non-baseline and record the project before later reads', async () => {
  const seen: ProjectEvidence[] = [];
  await mocked([{ body: { ...project, secret_extra: 'discarded' } }, { body: { name: 'main', protected: true } }, { body: [rule] }], async client => {
    const value = await collectProject(client, 101, snapshot => seen.push(snapshot));
    assert.equal(value.outcome, 'complete');
    assert.ok(seen.length >= 3);
    assert.equal(seen[0]?.project.status, 'collected');
    assert.equal(seen[0]?.branch.status, 'not_collected');
    assert.equal(seen.some(snapshot => snapshot.branch.status === 'collected' && snapshot.protectionRules.status === 'not_collected'), true);
    assert.equal(seen.at(-1)?.protectionRules.status, 'collected');
    assert.equal(seen.every(snapshot => snapshot.outcome !== 'complete'), true);
    assert.equal(seen.some(snapshot => JSON.stringify(snapshot).includes('secret_extra')), false);
  });
});
test('live-response regression: empty repository can report configured default_branch main', async () => {
  await mocked([{ body: { ...project, default_branch: 'main', empty_repo: true } }], async (client, requests) => {
    const value = await collectProject(client, 101);
    assert.equal(value.outcome, 'complete');
    assert.equal(value.posture, 'no_default_branch');
    assert.equal(value.project.value?.default_branch, 'main');
    assert.equal(value.branch.status, 'not_applicable');
    assert.equal(value.protectionRules.status, 'not_applicable');
    assert.deepEqual(value.issues, []);
    assert.equal(requests.length, 1, 'Do not request a nonexistent configured branch');
  });
});
