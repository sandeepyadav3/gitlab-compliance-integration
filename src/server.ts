import { EvidenceStore, databasePath } from './storage/store.ts';
import { GitLabClient } from './gitlab/client.ts';
import { CollectionService } from './collection/service.ts';
import { createApplication } from './http/app.ts';
const log = (entry: Record<string, unknown>) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...entry }));
async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
  const token = process.env.GITLAB_TOKEN?.trim();
  const configured = Boolean(token && token !== 'replace-me');
  const store = new EvidenceStore(databasePath());
  const service = new CollectionService({ store, logger: log,
    clientFactory: signal => new GitLabClient({ token: token ?? '', signal }) });
  let started = false;
  try {
    service.start(); started = true;
    const server = createApplication({ store, service, tokenConfigured: configured, logger: log });
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return; shuttingDown = true;
      server.close(); server.closeAllConnections();
      try { await service.stop(); } finally { store.close(); }
      log({ event: 'server_stopped' });
      if (process.connected) process.disconnect();
    };
    // Internal parent/child control channel for portable process lifecycle tests.
    // This is not an HTTP shutdown endpoint and is absent in normal npm start.
    if (process.send) process.on('message', message => {
      if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'shutdown') void shutdown();
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void shutdown(); });
    server.once('error', () => { process.exitCode = 1; log({ event: 'server_listen_failed' }); void shutdown(); });
    server.listen(port, '127.0.0.1', () => log({ event: 'server_started', port }));
  } catch (error) {
    if (started) await service.stop(); store.close(); throw error;
  }
}
main().catch(() => {
  console.error(JSON.stringify({ event: 'startup_failed', message: 'Check PORT, database access, and whether another collector is running. After a crash, wait 15 seconds and retry.' }));
  process.exitCode = 1;
});
