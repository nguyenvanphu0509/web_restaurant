CREATE SCHEMA IF NOT EXISTS block8_auth;
CREATE TABLE IF NOT EXISTS block8_auth.users(id serial PRIMARY KEY,email text UNIQUE NOT NULL,name text, password_hash text NOT NULL,role text NOT NULL DEFAULT 'viewer',status text NOT NULL DEFAULT 'pending',email_verified_at timestamptz,version integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS block8_auth.activation(user_id integer PRIMARY KEY REFERENCES block8_auth.users(id), hash text NOT NULL,expires_at timestamptz NOT NULL,attempts integer NOT NULL DEFAULT 0,locked_until timestamptz,last_sent_at timestamptz NOT NULL DEFAULT now(),used_at timestamptz);
CREATE TABLE IF NOT EXISTS block8_auth.resets(hash text PRIMARY KEY,user_id integer REFERENCES block8_auth.users(id),expires_at timestamptz NOT NULL,used_at timestamptz);
CREATE TABLE IF NOT EXISTS block8_auth.session(sid varchar PRIMARY KEY,sess json NOT NULL,expire timestamp NOT NULL);
CREATE INDEX IF NOT EXISTS session_expire ON block8_auth.session(expire);
CREATE TABLE IF NOT EXISTS block8_auth.limits(key text PRIMARY KEY,count integer NOT NULL DEFAULT 0,started_at timestamptz NOT NULL DEFAULT now(),locked_until timestamptz);
DROP TABLE IF EXISTS block8_auth.captcha;

-- Safe to rerun against existing Block 8 databases.
ALTER TABLE block8_auth.activation ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'activation';
CREATE TABLE IF NOT EXISTS block8_auth.mail_cooldowns(key text PRIMARY KEY,available_at timestamptz NOT NULL);

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
