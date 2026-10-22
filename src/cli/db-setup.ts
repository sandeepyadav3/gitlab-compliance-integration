import { EvidenceStore, databasePath } from '../storage/store.ts';
try { const store = new EvidenceStore(databasePath()); store.close(); console.log('SQLite schema is ready.'); }
catch { console.error('Could not initialize SQLite. Check DATABASE_PATH and folder permissions.'); process.exitCode = 1; }
