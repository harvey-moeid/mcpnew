-- Strongly consistent ticket claims/cancellation. KV-only tickets from the previous
-- version remain accepted for their remaining ten-minute lifetime.
CREATE TABLE IF NOT EXISTS file_upload_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','uploading','completed','cancelled','failed')),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upload_expiry ON file_upload_sessions(expires_at);
