import { EvidenceStore, databasePath } from '../storage/store.ts';
import { parseProjectIds } from '../gitlab/collector.ts';
try {
  const values = process.argv.slice(2);
  const ids = values.length ? parseProjectIds(values) : null;
  const store = new EvidenceStore(databasePath());
  try { if (ids) store.saveSelection(ids); console.log(JSON.stringify(store.getSelection(), null, 2)); }
  finally { store.close(); }
} catch { console.error('Selection failed. Supply 1-25 numeric IDs and check the database path.'); process.exitCode = 1; }
