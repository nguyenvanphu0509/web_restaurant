import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { newDb } from 'pg-mem';
import { createAuth } from '../api/src/auth/index.js';
import { createJwt } from '../api/src/auth/jwt.js';
import { createApi } from '../api/src/app.js';
import { createFixture } from './fixtures.js';
const secret = 'test-key-only-at-least-32-bytes-long';
const logger = { error() {}, warn() {} };
async function setup(options = {}) {
  const { Pool } = newDb().adapters.createPg(), pool = new Pool();
  await pool.query(await readFile(new URL('../api/migrations/001-auth.sql', import.meta.url), 'utf8'));
  const messages = [];
  const auth = createAuth({ pool, secret, logger, recaptchaVerifier: async value => value === 'captcha', mailer: { sendMail: async message => { messages.push(message); return { accepted: [message.to] }; } }, ...options });
  const { db, storage } = createFixture();
  let uploads = 0;
  const app = createApi({ db, auth, logger, storage: { upload: async () => { uploads++; return '/images/greens.svg'; } } });
  return { pool, auth, messages, app, storage, uploads: () => uploads };
}
const payload = { email: 'new@example.com', name: 'New user', password: 'valid-long-password-123', confirmPassword: 'valid-long-password-123', captcha: 'captcha' };
async function registered(ctx) {
  const result = await request(ctx.app).post('/api/auth/register').send({ ...payload, role: 'admin' }).expect(200);
  assert.equal(result.body.data.accessToken, undefined);
  await ctx.auth.drainMail();
  return ctx.messages[0].text.match(/\d{6}/)[0];
}
async function active(ctx) {
  const otp = await registered(ctx);
  await request(ctx.app).post('/api/auth/activate').send({ email: payload.email, otp }).expect(200);
  return (await request(ctx.app).post('/api/auth/login').send(payload)).body.data.accessToken;
}
async function errorCode(app, path, data, code, status = 200) {
  const result = await request(app).post(`/api/auth/${path}`).send(data).expect(status);
  assert.equal(result.body.ok, false); assert.equal(result.body.error.code, code); assert.equal(result.body.data?.accessToken, undefined);
}
test('anonymous registration/activation/login, Viewer read-only access and reset', async () => {
  const ctx = await setup(), { app, pool, auth, messages } = ctx;
  try {
    await errorCode(app, 'register', { ...payload, confirmPassword: 'mismatch' }, 'VALIDATION_FAILED');
    const otp = await registered(ctx);
    const user = (await pool.query('SELECT * FROM block8_auth.users')).rows[0];
    assert.equal(user.role, 'viewer'); assert.equal(user.status, 'pending'); assert.notEqual(user.password_hash, payload.password);
    await errorCode(app, 'login', payload, 'ACCOUNT_NOT_ACTIVATED');
    await errorCode(app, 'activate', { email: payload.email, otp: '000000' }, 'INVALID_OTP');
    await request(app).post('/api/auth/activate').send({ email: payload.email, otp }).expect(200);
    await errorCode(app, 'activate', { email: payload.email, otp }, 'INVALID_OTP');
    const token = (await request(app).post('/api/auth/login').send(payload)).body.data.accessToken;
    assert.equal((await auth.jwt.verify(token)).role, 'viewer');
    const denied = await request(app).patch('/api/dishes/1').set('Authorization', `Bearer ${token}`).send({ name: 'Denied', role: 'admin' }).expect(403);
    assert.equal(denied.body.error.code, 'FORBIDDEN');
    await request(app).get('/api/dishes?q=pho&page=1').expect(200);
    await request(app).post('/api/dishes').send({}).expect(401);
    const known = await request(app).post('/api/auth/forgot').send({ email: payload.email });
    const unknown = await request(app).post('/api/auth/forgot').send({ email: 'unknown@example.com' });
    assert.deepEqual(known.body, unknown.body); await auth.drainMail();
    const reset = messages.find(message => message.subject === 'Đặt lại mật khẩu').text.match(/token=([a-f0-9]+)/)[1];
    const next = { token: reset, password: 'new-long-password-123', confirmPassword: 'new-long-password-123' };
    await request(app).post('/api/auth/reset').send(next).expect(200); await auth.drainMail();
    await errorCode(app, 'reset', next, 'INVALID_RESET_TOKEN');
    await errorCode(app, 'login', payload, 'INVALID_CREDENTIALS');
    assert.ok((await request(app).post('/api/auth/login').send({ ...payload, password: next.password })).body.data.accessToken);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
  } finally { await auth.drainMail(); await pool.end(); }
});
test('duplicate registration has the same response and never overwrites an account', async () => {
  const ctx = await setup();
  try {
    const initial = await request(ctx.app).post('/api/auth/register').send(payload); await ctx.auth.drainMail();
    await ctx.pool.query("UPDATE block8_auth.users SET status='active',email_verified_at=now()");
    const before = (await ctx.pool.query('SELECT * FROM block8_auth.users')).rows[0];
    const duplicate = await request(ctx.app).post('/api/auth/register').send({ ...payload, password: 'another-long-password', confirmPassword: 'another-long-password' });
    await ctx.auth.drainMail(); assert.deepEqual(initial.body, duplicate.body);
    assert.deepEqual((await ctx.pool.query('SELECT * FROM block8_auth.users')).rows[0], before); assert.equal(ctx.messages.length, 1);
  } finally { await ctx.pool.end(); }
});
test('verify has zero DB calls; middleware loads current user only AFTER valid verification', async () => {
  const ctx = await setup();
  try {
    const token = await active(ctx), query = ctx.pool.query.bind(ctx.pool); let calls = 0;
    ctx.pool.query = (...args) => { calls++; return query(...args); };
    assert.ok(await ctx.auth.jwt.verify(token)); assert.equal(calls, 0);
    await request(ctx.app).get('/api/auth/me').expect(401);
    await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}x`).expect(401); assert.equal(calls, 0);
    await query("UPDATE block8_auth.users SET role='editor'");
    const me = await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    assert.equal(calls, 1); assert.equal(me.body.data.role, 'editor');
    await query("UPDATE block8_auth.users SET status='pending'");
    await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    ctx.pool.query = async () => { throw new Error('Database offline'); };
    await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(500);
  } finally { await ctx.pool.end(); }
});
test('JWT rejects tampering/algorithm/issuer/audience; expiration has its own error', async () => {
  let time = 1000000; const jwt = createJwt({ secret, now: () => time });
  const token = await jwt.sign({ id: 1, role: 'viewer' }), claims = await jwt.verify(token);
  const signed = (claims, header = { alg: 'HS256', typ: 'JWT' }) => {
    const data = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
  };
  for (const update of [{ aud: 'other' }, { iss: 'other' }, { exp: '1900' }, { iat: 1001 }, { nbf: 1001 }, { sub: '' }]) assert.equal(await jwt.verify(signed({ ...claims, ...update })), null);
  assert.equal(await jwt.verify(signed(claims, { alg: 'none', typ: 'JWT' })), null);
  assert.equal(await jwt.verify(token + 'x'), null);
  time += 900000;
  const ctx = await setup({ jwt });
  try {
    const result = await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    assert.equal(result.body.error.code, 'TOKEN_EXPIRED');
  } finally { await ctx.pool.end(); }
});
test('CAPTCHA distinguishes missing/invalid; failed-login counters are not incremented by missing CAPTCHA', async () => {
  const ctx = await setup();
  try {
    await errorCode(ctx.app, 'register', { ...payload, captcha: '' }, 'CAPTCHA_REQUIRED');
    await errorCode(ctx.app, 'register', { ...payload, captcha: 'wrong' }, 'INVALID_CAPTCHA');
    assert.equal((await ctx.pool.query('SELECT * FROM block8_auth.users')).rows.length, 0); assert.equal(ctx.messages.length, 0);
    for (let i = 0; i < 3; i++) await errorCode(ctx.app, 'login', payload, 'INVALID_CREDENTIALS');
    await errorCode(ctx.app, 'login', { ...payload, captcha: '' }, 'CAPTCHA_REQUIRED');
    await errorCode(ctx.app, 'login', { ...payload, captcha: 'wrong' }, 'INVALID_CAPTCHA');
    for (let i = 3; i < 9; i++) await errorCode(ctx.app, 'login', payload, 'INVALID_CREDENTIALS');
    await errorCode(ctx.app, 'login', payload, 'RATE_LIMITED', 429);
  } finally { await ctx.pool.end(); }
});
test('public dishes, protected other resources and authorization preflight', async () => {
  const ctx = await setup();
  try {
    await request(ctx.app).get('/api/dishes').expect(200); await request(ctx.app).get('/api/dishes/1').expect(200);
    for (const path of ['dishes', 'dishes/1', 'dishes/new', 'dishes/1/edit', 'dishes/1/delete']) await request(ctx.app).get(`/api/admin/${path}`).expect(401);
    for (const path of ['chefs', 'ingredients', 'restaurants']) await request(ctx.app).get(`/api/${path}`).expect(401);
    for (const method of ['post', 'patch', 'delete']) await request(ctx.app)[method](method === 'post' ? '/api/dishes' : '/api/dishes/1').send({}).expect(401);
    await request(ctx.app).options('/api/dishes/1').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'PATCH').set('Access-Control-Request-Headers', 'content-type,authorization').expect(204);
  } finally { await ctx.pool.end(); }
});
test('expired OTP cannot activate', async () => {
  const ctx = await setup();
  try {
    const otp = await registered(ctx);
    await ctx.pool.query("UPDATE block8_auth.activation SET expires_at=now()-interval '1 minute'");
    await errorCode(ctx.app, 'activate', { email: payload.email, otp }, 'INVALID_OTP');
    assert.equal((await ctx.pool.query('SELECT status FROM block8_auth.users')).rows[0].status, 'pending');
  } finally { await ctx.pool.end(); }
});
test('unknown email using the timing-dummy password still returns INVALID_CREDENTIALS', async () => {
  const ctx = await setup();
  try { await errorCode(ctx.app, 'login', { email: 'absent@example.test', password: 'dummy-password-for-timing' }, 'INVALID_CREDENTIALS'); }
  finally { await ctx.pool.end(); }
});

test('CSR admin guards forms and writes using current roles and dish attributes', async () => {
  const ctx = await setup();
  const { app, pool, auth, storage } = ctx;
  async function addUser(name, role, chefId = null) {
    const { rows: [user] } = await pool.query(
      "INSERT INTO block8_auth.users(email,password_hash,role,status,email_verified_at,chef_id) VALUES($1,'test-only',$2,'active',now(),$3) RETURNING id,role",
      [name + '@example.test', role, chefId],
    );
    const token = await auth.jwt.sign(user);
    return (method, path) => request(app)[method](path).auth(token, { type: 'bearer' });
  }
  try {
    const [chefA, chefB] = storage.chef;
    const viewer = await addUser('viewer', 'viewer');
    const editorA = await addUser('editor-a', 'editor', chefA.id);
    const editorB = await addUser('editor-b', 'editor', chefB.id);
    const unassigned = await addUser('unassigned', 'editor');
    const admin = await addUser('admin', 'admin');
    const list = (await viewer('get', '/api/admin/dishes').expect(200)).body;
    assert.equal(list.meta.permissions.create, false);
    assert.ok(list.data.items.length && list.data.items.every(row => !row.permissions.update && !row.permissions.delete));
    await viewer('get', '/api/admin/dishes/new').expect(403);
    await unassigned('get', '/api/admin/dishes/new').expect(403);
    await unassigned('post', '/api/dishes').send({ name: 'No chef', price: 1000 }).expect(403);

    const chefCount = storage.chef.length;
    const created = (await editorA('post', '/api/dishes')
      .send({ name: 'Draft', price: 1000, chefId: chefB.id, status: 'published', newChefName: 'Ignored' }).expect(200)).body.data;
    const path = '/api/dishes/' + created.id;
    const adminPath = '/api/admin/dishes/' + created.id;
    assert.equal(created.chefId, chefA.id);
    assert.equal(created.status, 'draft');
    assert.equal(storage.chef.length, chefCount);
    await viewer('get', adminPath).expect(200);
    await viewer('get', adminPath + '/edit').expect(403);
    await editorB('get', adminPath + '/edit').expect(403);
    await editorB('patch', path).field('payload', JSON.stringify({ name: 'Denied' }))
      .attach('imageFile', Buffer.from('fixture'), { filename: 'test.png', contentType: 'image/png' }).expect(403);
    assert.equal(ctx.uploads(), 0);
    await editorA('get', adminPath + '/delete').expect(403);
    await editorA('delete', path).expect(403);
    const editForm = (await editorA('get', adminPath + '/edit').expect(200)).body;
    assert.equal(editForm.meta.manageDishFields, false);
    const updated = (await editorA('patch', path).send({ name: 'Edited', chefId: chefB.id, status: 'published', newChefName: 'Ignored' })).body.data;
    assert.equal(updated.chefId, chefA.id);
    assert.equal(updated.status, 'draft');
    const invalid = (await admin('patch', path).send({ status: 'archived' })).body;
    assert.equal(invalid.error.code, 'VALIDATION_FAILED');

    await admin('patch', path).send({ chefId: chefB.id }).expect(200);
    await editorA('patch', path).send({ name: 'Denied after reassignment' }).expect(403);
    await editorB('get', adminPath + '/edit').expect(200);
    await admin('patch', path).send({ status: 'published' }).expect(200);
    await editorB('patch', path).send({ name: 'Denied after publishing' }).expect(403);
    const saved = (await request(app).get(path)).body.data;
    assert.equal(saved.name, 'Edited');
    assert.equal(saved.chefId, chefB.id);
    assert.equal(saved.status, 'published');

    const chef = (await editorA('post', '/api/chefs').send({ name: 'Editor can create' })).body.data;
    await editorA('get', '/api/admin/chefs/' + chef.id + '/edit').expect(200);
    await pool.query("UPDATE block8_auth.users SET role='viewer' WHERE email='editor-a@example.test'");
    await editorA('patch', '/api/chefs/' + chef.id).send({ name: 'Denied after demotion' }).expect(403);
    await admin('get', adminPath + '/delete').expect(200);
    await admin('delete', path).expect(200);
    assert.equal(storage.dish.some(row => row.id === created.id), false);
  } finally { await pool.end(); }
});
