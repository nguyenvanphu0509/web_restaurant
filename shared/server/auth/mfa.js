import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { token, digest, verifyPassword } from './crypto.js';

export class MfaError extends Error {
  constructor(code, message, status = 200) { super(message); this.code = code; this.status = status; }
}
const error = (code = 'INVALID_OTP', message = 'Mã không hợp lệ hoặc đã dùng.', status = 200) => ({ error: new MfaError(code, message, status) });
export function createMfa({ transaction, encryptionKey = process.env.MFA_ENCRYPTION_KEY, issuer = 'Ẩm thực Việt', now = () => Date.now() }) {
  const key = Buffer.from(encryptionKey || '', 'base64');
  const requireKey = () => { if (key.length !== 32) throw new MfaError('MFA_UNAVAILABLE', 'Chưa cấu hình khóa mã hóa MFA.', 503); };
  const encrypt = (value, id) => {
    requireKey(); const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`mfa:${id}`));
    return (() => {
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64')).join('.');
    })();
  };
  const decrypt = (value, id) => {
    requireKey(); const [iv, tag, encrypted] = value.split('.').map(value => Buffer.from(value, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(`mfa:${id}`)); cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
  };
  const totp = (secret, email) => new OTPAuth.TOTP({ issuer, label: email, algorithm: 'SHA1', digits: 6, period: 30, secret });
  async function locked(id, work) {
    const result = await transaction(async client => {
      const user = (await client.query('SELECT * FROM block8_auth.users WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!user || user.status !== 'active' || !user.email_verified_at) return error('UNAUTHENTICATED', 'Tài khoản không hoạt động.', 401);
      return work(client, user);
    });
    if (result?.error) throw result.error; return result;
  }
  const blocked = user => new Date(user.mfa_locked_until).getTime() > now();
  async function failed(client, user) {
    await client.query("UPDATE block8_auth.users SET mfa_attempts=$2,mfa_locked_until=$3 WHERE id=$1", [user.id, (user.mfa_attempts || 0) + 1, (user.mfa_attempts || 0) + 1 >= 5 ? new Date(now() + 900000) : null]);
    return (user.mfa_attempts || 0) + 1 >= 5 ? error('RATE_LIMITED', 'Thử MFA quá nhiều lần. Vui lòng chờ 15 phút.', 429) : error();
  }
  async function ready(client, user) {
    if (blocked(user)) return false;
    if (user.mfa_locked_until) { user.mfa_attempts = 0; await client.query('UPDATE block8_auth.users SET mfa_attempts=0,mfa_locked_until=NULL WHERE id=$1', [user.id]); }
    return true;
  }
  async function proof(client, user, input) {
    if (!await ready(client, user)) return error('RATE_LIMITED', 'MFA đang tạm khóa.', 429);
    if (input.recoveryCode && !input.otp) {
      const code = (await client.query('UPDATE block8_auth.recovery_codes SET used_at=$3 WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash', [user.id, digest(String(input.recoveryCode).trim().toUpperCase()), new Date(now())])).rows[0];
      if (code) { await client.query('UPDATE block8_auth.users SET mfa_attempts=0,mfa_locked_until=NULL WHERE id=$1', [user.id]); return null; }
    } else if (typeof input.otp === 'string' && /^[0-9]{6}$/.test(input.otp) && !input.recoveryCode && user.mfa_secret) {
      const delta = totp(decrypt(user.mfa_secret, user.id), user.email).validate({ token: input.otp, window: 1, timestamp: now() });
      const step = Math.floor(now() / 30000) + (delta ?? 0);
      if (delta !== null && step > Number(user.mfa_last_step)) {
        await client.query('UPDATE block8_auth.users SET mfa_last_step=$2,mfa_attempts=0,mfa_locked_until=NULL WHERE id=$1', [user.id, step]); return null;
      }
    }
    return failed(client, user);
  }
  async function reauth(client, user, input) {
    if (!await ready(client, user)) return error('RATE_LIMITED', 'MFA đang tạm khóa.', 429);
    if (!await verifyPassword(input.password, user.password_hash)) { const failedResult = await failed(client, user); return failedResult.error.status === 429 ? failedResult : error('INVALID_CREDENTIALS', 'Mật khẩu không đúng.'); }
    return user.mfa_enabled ? proof(client, user, input) : null;
  }
  async function codes(client, user) {
    const values = Array.from({ length: 10 }, () => randomBytes(10).toString('hex').toUpperCase());
    await client.query('DELETE FROM block8_auth.recovery_codes WHERE user_id=$1', [user.id]);
    for (const value of values) await client.query('INSERT INTO block8_auth.recovery_codes(user_id,code_hash) VALUES($1,$2)', [user.id, digest(value)]);
    return values;
  }
  async function bump(client, user) {
    await client.query('UPDATE block8_auth.users SET mfa_version=mfa_version+1,version=version+1,mfa_attempts=0,mfa_locked_until=NULL WHERE id=$1', [user.id]);
    return { ...user, version: user.version + 1, mfa_version: user.mfa_version + 1 };
  }
  return {
    async cancel(id) { return locked(id, async client => { await client.query('DELETE FROM block8_auth.mfa_setup WHERE user_id=$1', [id]); return { cancelled: true }; }); },
    async status(id) { return locked(id, async (client, user) => ({ enabled: user.mfa_enabled, remaining: Number((await client.query('SELECT count(*) AS count FROM block8_auth.recovery_codes WHERE user_id=$1 AND used_at IS NULL', [id])).rows[0].count) })); },
    async setup(id, input) {
      return locked(id, async (client, user) => {
        requireKey(); const denied = await reauth(client, user, input); if (denied) return denied;
        const secret = new OTPAuth.Secret({ size: 20 }).base32;
        await client.query('INSERT INTO block8_auth.mfa_setup(user_id,secret,version,mfa_version,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET secret=$2,version=$3,mfa_version=$4,expires_at=$5', [id, encrypt(secret, id), user.version, user.mfa_version, new Date(now() + 600000)]);
        const uri = totp(secret, user.email).toString();
        return { secret, qr: await QRCode.toDataURL(uri), expiresIn: 600 };
      });
    },
    async confirm(id, input) {
      return locked(id, async (client, user) => {
        if (!await ready(client, user)) return error('RATE_LIMITED', 'MFA đang tạm khóa.', 429);
        const setup = (await client.query('SELECT * FROM block8_auth.mfa_setup WHERE user_id=$1', [id])).rows[0];
        if (!setup || new Date(setup.expires_at).getTime() <= now() || setup.version !== user.version || setup.mfa_version !== user.mfa_version) return error('INVALID_MFA_CHALLENGE', 'Thiết lập đã hết hạn. Vui lòng bắt đầu lại.');
        const delta = typeof input.otp === 'string' && /^[0-9]{6}$/.test(input.otp) ? totp(decrypt(setup.secret, id), user.email).validate({ token: input.otp, timestamp: now(), window: 1 }) : null;
        if (delta === null) return failed(client, user);
        const lastStep = Math.floor(now() / 30000) + delta;
        await client.query('UPDATE block8_auth.users SET mfa_enabled=true,mfa_secret=$2,mfa_last_step=$3 WHERE id=$1', [id, setup.secret, lastStep]);
        await client.query('DELETE FROM block8_auth.mfa_setup WHERE user_id=$1', [id]);
        return { user: { ...await bump(client, user), mfa_enabled: true }, recoveryCodes: await codes(client, user) };
      });
    },
    async change(id, action, input) {
      return locked(id, async (client, user) => {
        if (!user.mfa_enabled) return error('MFA_NOT_ENABLED', 'MFA chưa bật.');
        const denied = await reauth(client, user, input); if (denied) return denied;
        const recoveryCodes = action === 'regenerate' ? await codes(client, user) : undefined;
        if (action === 'disable') {
          await client.query('UPDATE block8_auth.users SET mfa_enabled=false,mfa_secret=NULL,mfa_last_step=-1 WHERE id=$1', [id]);
          await client.query('DELETE FROM block8_auth.recovery_codes WHERE user_id=$1', [id]);
        }
        await client.query('DELETE FROM block8_auth.mfa_setup WHERE user_id=$1', [id]);
        return { user: { ...await bump(client, user), mfa_enabled: action !== 'disable' }, ...(recoveryCodes && { recoveryCodes }) };
      });
    },
    async challenge(user) {
      return locked(user.id, async (client, current) => {
        if (user.version !== current.version || user.mfa_version !== current.mfa_version || !current.mfa_enabled) return error('INVALID_MFA_CHALLENGE', 'Thông tin tài khoản đã đổi. Đăng nhập lại.');
        const value = token();
        await client.query('INSERT INTO block8_auth.mfa_challenges(hash,user_id,version,mfa_version,expires_at) VALUES($1,$2,$3,$4,$5)', [digest(value), user.id, current.version, current.mfa_version, new Date(now() + 300000)]);
        return { next: 'mfa', challenge: value, expiresIn: 300 };
      });
    },
    async finish(value, input) {
      if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new MfaError('INVALID_MFA_CHALLENGE', 'Phiên MFA không hợp lệ.');
      const candidate = await transaction(async client => (await client.query('SELECT user_id FROM block8_auth.mfa_challenges WHERE hash=$1', [digest(value)])).rows[0]);
      if (!candidate) throw new MfaError('INVALID_MFA_CHALLENGE', 'Phiên MFA không hợp lệ.');
      return locked(candidate.user_id, async (client, user) => {
        const row = (await client.query('SELECT * FROM block8_auth.mfa_challenges WHERE hash=$1 FOR UPDATE', [digest(value)])).rows[0];
        if (!row || row.used_at || new Date(row.expires_at).getTime() <= now() || row.version !== user.version || row.mfa_version !== user.mfa_version || !user.mfa_enabled) return error('INVALID_MFA_CHALLENGE', 'Phiên MFA hết hạn hoặc đã dùng.');
        const denied = await proof(client, user, input); if (denied) return denied;
        await client.query('UPDATE block8_auth.mfa_challenges SET used_at=$2 WHERE hash=$1', [digest(value), new Date(now())]);
        return user;
      });
    },
  };
}
