import { useEffect, useState } from 'react';
import { api } from './api.ts';
import type { Health, Run, Selection } from './types.ts';
interface Snapshot { runs: Run[]; active: Run | null; selection: Selection; health: Health; detail: Run | null; syncedAt: string; }
export function useWorkspace(selectedRunId: string | null, revision: number) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const [history, active, selection, health, detail] = await Promise.all([
          api<{ runs: Run[] }>('/api/runs?limit=100', controller.signal),
          api<{ run: Run | null }>('/api/runs/active', controller.signal),
          api<Selection>('/api/selection', controller.signal), api<Health>('/health', controller.signal),
          selectedRunId ? api<{ run: Run }>(`/api/runs/${selectedRunId}`, controller.signal) : Promise.resolve(null),
        ]);
        if (controller.signal.aborted) return;
        setSnapshot({ runs: history.runs, active: active.run, selection, health, detail: detail?.run ?? null, syncedAt: new Date().toISOString() });
        setError(null); timer = setTimeout(() => { void load(); }, active.run ? 1000 : 5000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setError(error instanceof Error ? error.message : 'Could not refresh the workspace.');
        timer = setTimeout(() => { void load(); }, 5000);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [selectedRunId, revision]);
  return { snapshot, error };
}
