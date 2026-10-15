-- tokens issued before a password change stop working (seconds, compared with the token's iat)
ALTER TABLE accounts ADD COLUMN password_changed_at INTEGER;

-- one pending reset code per account; only its hash is kept
CREATE TABLE password_resets (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
