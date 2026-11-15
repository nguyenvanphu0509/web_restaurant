import dotenv from 'dotenv';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { hashPassword } from '../shared/server/auth/crypto.js';

const mode = process.argv.includes('--api') ? 'api' : 'legacy';
const path = new URL(`../${mode}/.env`, import.meta.url);
const apiEnv = dotenv.parse(readFileSync(new URL('../api/.env', import.meta.url)));
const appEnv = dotenv.parse(readFileSync(path));
const env = { ...apiEnv, ...appEnv, ...process.env };
const pool = new pg.Pool({ connectionString: mode === 'api' ? env.AUTH_DATABASE_URL || env.DATABASE_URL : env.SSR_DATABASE_URL || env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  // A random encryption key per account database; never print or commit it.
  const connection = mode === 'api' ? env.AUTH_DATABASE_URL || env.DATABASE_URL : env.SSR_DATABASE_URL || env.DATABASE_URL;
  const sameDatabase = (left, right) => { try { const a = new URL(left), b = new URL(right); return a.hostname === b.hostname && a.pathname === b.pathname && a.username === b.username; } catch { return false; } };
  const sharedDatabase = mode === 'legacy' && sameDatabase(connection, apiEnv.AUTH_DATABASE_URL || apiEnv.DATABASE_URL);
  const selectedKey = sharedDatabase ? apiEnv.MFA_ENCRYPTION_KEY : appEnv.MFA_ENCRYPTION_KEY;
  const encryptionKey = selectedKey || randomBytes(32).toString('base64');
  if (appEnv.MFA_ENCRYPTION_KEY !== encryptionKey) {
    const text = readFileSync(path, 'utf8').replace(/^MFA_ENCRYPTION_KEY=.*$/gm, '');
    writeFileSync(path, text + `\nMFA_ENCRYPTION_KEY=${encryptionKey}\n`, { mode: 0o600 });
  }
  if (process.argv.includes('--seed')) {
    if (env.BLOCK9_ALLOW_DEMO_SEED !== 'true') throw new Error('Set BLOCK9_ALLOW_DEMO_SEED=true explicitly to create isolated demo accounts.');
    const credentialPath = new URL(`../.local-backups/block9-${sharedDatabase ? 'api' : mode}-credentials.json`, import.meta.url);
    mkdirSync(new URL('../.local-backups/', import.meta.url), { recursive: true });
    const credentials = existsSync(credentialPath) ? JSON.parse(readFileSync(credentialPath)) : {};
    for (const [role, suffix] of [['viewer', 'viewer'], ['admin', 'admin'], ['editor', 'editor-a'], ['editor', 'editor-b']]) {
      const email = `block9-${suffix}@example.test`, password = credentials[email] || `B9-${randomBytes(20).toString('hex')}`;
      credentials[email] = password;
      let chefId = null;
      if (role === 'editor') {
        const key = `block9:${suffix}`;
        chefId = (await pool.query('INSERT INTO public.chefs(name,"catalogKey","createdAt") VALUES($1,$2,now()) ON CONFLICT("catalogKey") DO UPDATE SET name=EXCLUDED.name RETURNING id', [`Demo ${suffix}`, key])).rows[0].id;
        for (const status of ['draft', 'published']) await pool.query('INSERT INTO public.dishes(name,status,"chefId","importKey","createdAt") VALUES($1,$2,$3,$4,now()) ON CONFLICT("importKey") DO NOTHING', [`Block9 ${suffix} ${status}`, status, chefId, `block9:${suffix}:${status}`]);
      }
      await pool.query("INSERT INTO block8_auth.users(email,name,password_hash,role,status,email_verified_at,chef_id) VALUES($1,$2,$3,$4,'active',now(),$5) ON CONFLICT(email) DO NOTHING", [email, `Demo ${suffix}`, await hashPassword(password), role, chefId]);
    }
    writeFileSync(credentialPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    console.log(`Demo seed ready for ${mode}; credentials stored locally in .local-backups (not printed).`);
  } else {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(new URL('../shared/server/auth/mfa.sql', import.meta.url), 'utf8'));
      await client.query(`ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';
        DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='block9_dish_status') THEN
        ALTER TABLE public.dishes ADD CONSTRAINT block9_dish_status CHECK(status IN ('draft','published')); END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='block9_user_chef') THEN
        ALTER TABLE block8_auth.users ADD CONSTRAINT block9_user_chef FOREIGN KEY(chef_id) REFERENCES public.chefs(id) ON DELETE SET NULL; END IF; END $$;`);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    console.log(`Block9 migration ready for ${mode}; existing accounts remain unchanged, MFA is never enabled automatically.`);
  }
} finally { await pool.end(); }
