import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore } from '../src/storage/store.ts';

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
async function launch(path: string, port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--experimental-strip-types', 'src/server.ts'], {
    env: { ...process.env, PORT: String(port), DATABASE_PATH: path, GITLAB_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Server startup timed out')); }, 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Server exited before listening')); });
      child.stdout!.on('data', chunk => {
        text += chunk.toString();
        if (text.includes('"event":"server_started"')) { clearTimeout(timer); resolve(); }
      });
    });
    return child;
  } catch (error) { child.kill('SIGKILL'); throw error; }
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Server shutdown timed out')); }, 5000);
    child.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`Server exit ${code}`)); });
    // child.kill(SIGTERM) is abrupt on Windows; use the same graceful handler via IPC.
    child.send({ type: 'shutdown' }, error => {
      if (error) { clearTimeout(timer); child.kill('SIGKILL'); reject(error); }
    });
  });
}
test('actual server entry point recovers unfinished work, releases ownership, and reopens history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-server-')); const path = join(dir, 'state.sqlite');
  const store = new EvidenceStore(path); store.saveSelection([101]);
  const run = store.createRun([101]); store.startRun(run.id); store.close();
  const port = await availablePort(); let child: ChildProcess | null = null;
  try {
    child = await launch(path, port);
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.status, 'ok'); assert.equal(health.phase, undefined); assert.equal(health.tokenConfigured, false);
    const recovered = (await (await fetch(`http://127.0.0.1:${port}/api/runs/${run.id}`)).json()).run;
    assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.interruptionReason, 'server_restart');
    assert.equal(recovered.projects[0].state, 'interrupted');
    await stop(child); child = null;
    child = await launch(path, port); // No crash wait needed after graceful lease release.
    const history = await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json();
    assert.equal(history.runs[0].id, run.id);
    const selected = await (await fetch(`http://127.0.0.1:${port}/api/selection`)).json();
    assert.deepEqual(selected.projectIds, [101]);
  } finally { if (child) await stop(child); rmSync(dir, { recursive: true, force: true }); }
});
