-- R2 holds bytes; D1 holds owner-scoped labels, trash state and revocable shares.
CREATE TABLE IF NOT EXISTS dashboard_file_state (
  actor TEXT NOT NULL,
  key TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT '',
  deleted_at INTEGER,
  purging INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (actor, key)
);
CREATE INDEX IF NOT EXISTS idx_file_trash ON dashboard_file_state(deleted_at);
CREATE TABLE IF NOT EXISTS dashboard_file_shares (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  key TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_shares_owner ON dashboard_file_shares(actor, key);
