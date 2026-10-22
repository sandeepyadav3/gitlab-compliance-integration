export const migration2 = `
ALTER TABLE runs ADD COLUMN interruption_reason TEXT;
CREATE TABLE collector_lease (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1),
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
PRAGMA user_version=2;
`;
