// Version 1: additive migrations must be introduced explicitly, never overwrite history.
export const schema = `
CREATE TABLE selection (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  project_ids_json TEXT NOT NULL CHECK (json_valid(project_ids_json)),
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE runs (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  requested_ids_json TEXT NOT NULL CHECK (json_valid(requested_ids_json)),
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','interrupted')),
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
) STRICT;
CREATE TABLE run_projects (
  run_id TEXT NOT NULL REFERENCES runs(id),
  project_id INTEGER NOT NULL CHECK (project_id > 0),
  position INTEGER NOT NULL CHECK (position >= 0),
  state TEXT NOT NULL CHECK (state IN ('pending','running','complete','partial','failed','interrupted')),
  baseline_run_id TEXT,
  evidence_json TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json)),
  PRIMARY KEY (run_id, project_id),
  UNIQUE (run_id, position),
  FOREIGN KEY (baseline_run_id, project_id) REFERENCES run_projects(run_id, project_id),
  CHECK ((state IN ('complete','partial','failed') AND evidence_json IS NOT NULL)
    OR (state IN ('pending','running','interrupted') AND evidence_json IS NULL))
) STRICT;
CREATE INDEX project_history ON run_projects(project_id, state);
CREATE TRIGGER freeze_run_identity BEFORE UPDATE ON runs
WHEN NEW.id IS NOT OLD.id OR NEW.sequence IS NOT OLD.sequence
  OR NEW.requested_ids_json IS NOT OLD.requested_ids_json OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'Run identity is immutable'); END;
CREATE TRIGGER freeze_terminal_run BEFORE UPDATE ON runs
WHEN OLD.status IN ('completed','interrupted')
BEGIN SELECT RAISE(ABORT, 'Terminal runs are immutable'); END;
CREATE TRIGGER freeze_project_identity BEFORE UPDATE ON run_projects
WHEN NEW.run_id IS NOT OLD.run_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.position IS NOT OLD.position OR NEW.baseline_run_id IS NOT OLD.baseline_run_id
BEGIN SELECT RAISE(ABORT, 'Project identity and baseline are immutable'); END;
CREATE TRIGGER freeze_terminal_project BEFORE UPDATE ON run_projects
WHEN OLD.state IN ('complete','partial','failed','interrupted')
BEGIN SELECT RAISE(ABORT, 'Completed observations are immutable'); END;
CREATE TRIGGER no_project_delete BEFORE DELETE ON run_projects
BEGIN SELECT RAISE(ABORT, 'History cannot be deleted'); END;
CREATE TRIGGER no_run_delete BEFORE DELETE ON runs
BEGIN SELECT RAISE(ABORT, 'History cannot be deleted'); END;
`;
