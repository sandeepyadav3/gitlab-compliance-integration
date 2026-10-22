import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EvidenceStore } from '../src/storage/store.ts';
import { GitLabClient } from '../src/gitlab/client.ts';
import { CollectionService } from '../src/collection/service.ts';
import { createApplication } from '../src/http/app.ts';
export function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
export async function waitUntil(check: () => boolean, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Condition did not become true.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
export async function harness(options: {
  beforeReply?: (url: URL) => Promise<void>;
  reply?: (url: URL) => Reply | undefined;
  concurrency?: number;
  runTimeoutMs?: number;
  tokenConfigured?: boolean;
} = {}) {
  const requests: string[] = []; const logs: Record<string, unknown>[] = [];
  const provider = createServer((req, res) => {
    void (async () => {
      requests.push(req.url!);
      if (req.method !== 'GET' || req.headers['private-token'] !== 'http-mock-only-token') throw new Error('Unsafe provider request');
      const url = new URL(req.url!, 'http://mock');
      await options.beforeReply?.(url);
      const reply = options.reply?.(url);
      const match = /^\/api\/v4\/projects\/(\d+)(.*)$/.exec(url.pathname);
      const id = Number(match?.[1]); const suffix = match?.[2];
      const body = suffix === '' ? { id, name: `Synthetic ${id}`, web_url: `https://gitlab.com/synthetic/${id}`,
        visibility: 'private', default_branch: 'main', empty_repo: id === 3 }
        : suffix === '/repository/branches/main' ? { name: 'main', protected: id === 1 }
        : suffix === '/protected_branches' ? id === 1 ? [{ id: 9, name: 'main', push_access_levels: [{ access_level: 40 }], merge_access_levels: [{ access_level: 40 }], allow_force_push: false }] : [] : {};
      res.writeHead(reply?.status ?? 200, { 'content-type': 'application/json', ...reply?.headers });
      res.end(JSON.stringify(reply?.body ?? body));
    })().catch(() => { if (!res.destroyed) { res.writeHead(500); res.end(); } });
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerPort = (provider.address() as AddressInfo).port;
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-http-'));
  const path = join(dir, 'history.sqlite'); const store = new EvidenceStore(path);
  const service = new CollectionService({ store, concurrency: options.concurrency ?? 3, runTimeoutMs: options.runTimeoutMs ?? 5000,
    logger: entry => logs.push(entry), clientFactory: signal => new GitLabClient({ token: 'http-mock-only-token', signal,
      transport: async (input, init) => { const url = new URL(String(input)); return fetch(`http://127.0.0.1:${providerPort}${url.pathname}${url.search}`, init); } }) });
  service.start();
  const server = createApplication({ store, service, tokenConfigured: options.tokenConfigured ?? true, logger: entry => logs.push(entry) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, body?: unknown, method = 'POST') => fetch(base + path, body === undefined ? {} : {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { store, service, base, request, requests, logs, path,
    close: async () => {
      await service.stop(); server.closeAllConnections(); provider.closeAllConnections();
      await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => provider.close(() => resolve()))]);
      store.close(); rmSync(dir, { recursive: true, force: true });
    } };
}
