import { setTimeout as delay } from 'node:timers/promises';
import { harness, waitUntil } from '../tests/helpers.ts';
import { withComparisons } from '../src/comparison/views.ts';

/** Development-only HTTP fixture: production GitLab origin/configuration is unchanged. */
export async function createDemo(slow = false) {
  let mode: 'healthy' | 'denied' = 'healthy';
  const app = await harness({
    beforeReply: async () => { if (slow) await delay(250); },
    reply: url => url.pathname === '/api/v4/projects/1/protected_branches' && mode === 'denied'
      ? { status: 403, body: { message: 'Synthetic permission denial' } } : undefined,
  });
  app.store.saveSelection([1, 2, 3]);
  return { ...app,
    setMode: (next: typeof mode) => { mode = next; },
    getMode: () => mode,
    collect: async () => {
      const response = await app.request('/api/runs', {});
      if (response.status !== 202) throw new Error(`Demo collection was not accepted (${response.status}).`);
      const { run } = await response.json() as { run: { id: string } };
      await waitUntil(() => app.store.getRun(run.id)?.status === 'completed', 10000);
      return withComparisons(app.store, app.store.getRun(run.id)!);
    },
  };
}
