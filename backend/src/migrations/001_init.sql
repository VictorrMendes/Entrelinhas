-- IF NOT EXISTS: databases created by the first single-file server already have these tables.
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  device_id TEXT UNIQUE,
  device_secret TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  used INTEGER NOT NULL,
  PRIMARY KEY (account_id, day)
);

CREATE TABLE IF NOT EXISTS snapshots (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (account_id, sha256)
);

CREATE TABLE IF NOT EXISTS crashes (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  app_version TEXT,
  report TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS crashes_account_created ON crashes (account_id, created_at);
