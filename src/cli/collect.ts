import { withComparisons } from '../comparison/views.ts';
import { GitLabClient } from '../gitlab/client.ts';
import { parseProjectIds } from '../gitlab/collector.ts';
import { EvidenceStore, databasePath } from '../storage/store.ts';
import { CollectionService } from '../collection/service.ts';
async function main(): Promise<void> {
  const token = process.env.GITLAB_TOKEN?.trim();
  if (!token || token === 'replace-me') { console.error('Set GITLAB_TOKEN in a local .env file with read_api scope.'); process.exitCode = 1; return; }
  const store = new EvidenceStore(databasePath());
  const service = new CollectionService({ store, clientFactory: signal => new GitLabClient({ token, signal }) });
  let started = false;
  const stop = () => { void service.stop(); };
  try {
    const args = process.argv.slice(2);
    const ids = args.length ? parseProjectIds(args) : process.env.GITLAB_PROJECT_IDS?.trim()
      ? parseProjectIds([process.env.GITLAB_PROJECT_IDS]) : store.getSelection().projectIds;
    if (!ids.length) throw new Error('No selection.');
    service.start(); started = true;
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    store.saveSelection(ids);
    const run = service.enqueue(ids);
    await service.waitForIdle();
    const completed = store.getRun(run.id)!;
    console.log(JSON.stringify({ schemaVersion: 4, run: withComparisons(store, completed) }, null, 2));
    if (completed.status === 'interrupted') process.exitCode = 1;
    else if (completed.projects.some(project => project.state !== 'complete')) process.exitCode = 2;
  } catch {
    console.error('Collection unavailable. Check project IDs, storage, and whether the server or another collector is running. After a crash, wait 15 seconds and retry.');
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    if (started) await service.stop(); store.close();
  }
}
main().catch(() => { console.error('Collection could not initialize. Check configuration and storage.'); process.exitCode = 1; });
