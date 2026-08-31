-- Records every write/destructive tool call made through this MCP server.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,               -- GitHub login of the authenticated user
  tool TEXT NOT NULL,                -- tool name, e.g. "push_files"
  summary TEXT NOT NULL,             -- short human-readable description of what was done
  is_error INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
