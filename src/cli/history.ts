import { withComparisons } from '../comparison/views.ts';
import { EvidenceStore, databasePath } from '../storage/store.ts';
try {
  const store = new EvidenceStore(databasePath());
  try { const run = process.argv[2] ? store.getRun(process.argv[2]) : null; console.log(JSON.stringify(process.argv[2] ? run ? withComparisons(store, run) : null : store.listRuns().map(value => withComparisons(store, value)), null, 2)); }
  finally { store.close(); }
} catch { console.error('Could not read history. Check the database path and schema version.'); process.exitCode = 1; }
