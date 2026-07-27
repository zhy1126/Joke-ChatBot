CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  participant_token TEXT NOT NULL UNIQUE,
  participant_code TEXT NOT NULL DEFAULT '',
  assignment_method TEXT NOT NULL,
  condition TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_participant_token
  ON sessions(participant_token);

CREATE INDEX IF NOT EXISTS idx_sessions_created_at
  ON sessions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_condition
  ON sessions(condition);
