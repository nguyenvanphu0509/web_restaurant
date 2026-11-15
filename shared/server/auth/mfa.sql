ALTER TABLE block8_auth.users ADD COLUMN IF NOT EXISTS chef_id integer;
ALTER TABLE block8_auth.users ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE block8_auth.users ADD COLUMN IF NOT EXISTS mfa_secret text;
ALTER TABLE block8_auth.users ADD COLUMN IF NOT EXISTS mfa_last_step bigint NOT NULL DEFAULT -1;
ALTER TABLE block8_auth.users ADD COLUMN IF NOT EXISTS mfa_version integer NOT NULL DEFAULT 0;
ALTER TABLE block8_auth.users ADD COLUMN IF NOT EXISTS mfa_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE block8_auth.users ADD COLUMN IF NOT EXISTS mfa_locked_until timestamptz;
CREATE TABLE IF NOT EXISTS block8_auth.mfa_setup (
 user_id integer PRIMARY KEY REFERENCES block8_auth.users(id) ON DELETE CASCADE,
 secret text NOT NULL, version integer NOT NULL, mfa_version integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS block8_auth.recovery_codes (
 user_id integer NOT NULL REFERENCES block8_auth.users(id) ON DELETE CASCADE,
 code_hash text NOT NULL, used_at timestamptz, PRIMARY KEY(user_id,code_hash)
);
CREATE TABLE IF NOT EXISTS block8_auth.mfa_challenges (
 hash text PRIMARY KEY, user_id integer NOT NULL REFERENCES block8_auth.users(id) ON DELETE CASCADE,
 version integer NOT NULL, mfa_version integer NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE INDEX IF NOT EXISTS mfa_challenge_expiry ON block8_auth.mfa_challenges(expires_at);
