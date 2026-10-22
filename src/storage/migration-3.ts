export const migration3 = `
CREATE TABLE collection_checkpoints (
  run_id TEXT NOT NULL,
  project_id INTEGER NOT NULL CHECK (project_id > 0),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  PRIMARY KEY (run_id, project_id),
  FOREIGN KEY (run_id, project_id) REFERENCES run_projects(run_id, project_id)
) STRICT;
PRAGMA user_version=3;
`;
