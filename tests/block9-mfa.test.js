import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { newDb } from 'pg-mem';
import * as OTPAuth from 'otpauth';
import request from 'supertest';
import { createMfa } from '../shared/server/auth/mfa.js';
import { hashPassword } from '../shared/server/auth/crypto.js';
import { createAuth } from '../api/src/auth/index.js';
import { createApi } from '../api/src/app.js';
import { createFixture } from './fixtures.js';
const password='mfa-test-password-long-123', key=Buffer.alloc(32,7).toString('base64');
async function setup(){
 const {Pool}=newDb().adapters.createPg(), pool=new Pool();
 await pool.query(await readFile(new URL('../api/migrations/001-auth.sql',import.meta.url),'utf8'));
 const user=(await pool.query("INSERT INTO block8_auth.users(email,password_hash,status,email_verified_at) VALUES('mfa@example.test',$1,'active',now()) RETURNING *",[await hashPassword(password)])).rows[0];
 const tx=async work=>{const c=await pool.connect();try{await c.query('BEGIN');const value=await work(c);await c.query('COMMIT');return value;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}};
 let time=Date.now();const mfa=createMfa({transaction:tx,encryptionKey:key,now:()=>time});
 const code=secret=>new OTPAuth.TOTP({secret,algorithm:'SHA1',digits:6,period:30}).generate({timestamp:time});
 return {pool,user,mfa,code,advance:ms=>{time+=ms;}};
}
test('TOTP enrollment, encrypted secret, replay guard, recovery replacement and MFA lock',async()=>{
 const ctx=await setup();const {mfa,user,pool,code,advance}=ctx;
 try{
  await assert.rejects(mfa.setup(user.id,{password:'wrong'}),error=>error.code==='INVALID_CREDENTIALS');
  const cancelled=await mfa.setup(user.id,{password});
  await mfa.cancel(user.id);
  await assert.rejects(mfa.confirm(user.id,{otp:code(cancelled.secret)}),error=>error.code==='INVALID_MFA_CHALLENGE');
  const setup=await mfa.setup(user.id,{password});
  assert.match(setup.qr,/^data:image\/png;base64,/);
  assert.equal((await mfa.status(user.id)).enabled,false);
  const enabled=await mfa.confirm(user.id,{otp:code(setup.secret)});
  assert.equal(enabled.recoveryCodes.length,10);assert.equal((await mfa.status(user.id)).enabled,true);
  const saved=(await pool.query('SELECT * FROM block8_auth.users')).rows[0];
  assert.ok(!saved.mfa_secret.includes(setup.secret));assert.equal(saved.mfa_version,1);
  const challenge=await mfa.challenge(saved);
  await assert.rejects(mfa.finish(challenge.challenge,{otp:code(setup.secret)}),error=>error.code==='INVALID_OTP');
  advance(30000);
  assert.equal((await mfa.finish(challenge.challenge,{otp:code(setup.secret)})).id,user.id);
  await assert.rejects(mfa.finish(challenge.challenge,{recoveryCode:enabled.recoveryCodes[0]}),error=>error.code==='INVALID_MFA_CHALLENGE');
  const next=await mfa.challenge(saved);
  await mfa.finish(next.challenge,{recoveryCode:enabled.recoveryCodes[0]});
  const third=await mfa.challenge(saved);
  await assert.rejects(mfa.finish(third.challenge,{recoveryCode:enabled.recoveryCodes[0]}),error=>error.code==='INVALID_OTP');
  for(let i=0;i<3;i++)await assert.rejects(mfa.finish(third.challenge,{otp:'invalid'}),error=>error.code==='INVALID_OTP');
  await assert.rejects(mfa.finish(third.challenge,{otp:'invalid'}),error=>error.code==='RATE_LIMITED');
  advance(900001);
  const newSetup=await mfa.setup(user.id,{password,recoveryCode:enabled.recoveryCodes[1]});
  // Old secret remains active until new confirmation.
  assert.equal((await mfa.status(user.id)).enabled,true);
  const replacement=await mfa.confirm(user.id,{otp:code(newSetup.secret)});
  assert.equal(replacement.user.mfa_version,2);
  await assert.rejects(mfa.change(user.id,'disable',{password,recoveryCode:enabled.recoveryCodes[2]}),error=>error.code==='INVALID_OTP');
  const disabled=await mfa.change(user.id,'disable',{password,recoveryCode:replacement.recoveryCodes[0]});
  assert.equal(disabled.user.mfa_enabled,false);assert.deepEqual(await mfa.status(user.id),{enabled:false,remaining:0});
 }finally{await pool.end();}
});
test('API requires MFA before JWT; challenge is not Bearer; configuration changes revoke old JWT',async()=>{
 const ctx=await setup();const {pool,user}=ctx;
 const auth=createAuth({pool,secret:'test-secret-for-mfa-api-32-bytes-long',mfaEncryptionKey:key,recaptchaVerifier:async()=>true,mailer:{sendMail:async()=>({accepted:['test']})}});
 const app=createApi({db:createFixture().db,auth});
 const login=()=>request(app).post('/api/auth/login').send({email:user.email,password,captcha:'test'});
 try{
  const old=(await login()).body.data.accessToken;
  const setup=(await request(app).post('/api/auth/mfa/setup').set('Authorization',`Bearer ${old}`).send({password})).body.data;
  const code=()=>new OTPAuth.TOTP({secret:setup.secret}).generate();
  const enabled=(await request(app).post('/api/auth/mfa/confirm').set('Authorization',`Bearer ${old}`).send({otp:code()})).body.data;
  assert.equal(enabled.recoveryCodes.length,10);assert.ok(enabled.accessToken);
  await request(app).get('/api/auth/me').set('Authorization',`Bearer ${old}`).expect(401);
  const pending=(await login()).body.data;assert.equal(pending.next,'mfa');assert.equal(pending.accessToken,undefined);
  await request(app).get('/api/auth/me').set('Authorization',`Bearer ${pending.challenge}`).expect(401);
  const complete=await request(app).post('/api/auth/mfa').send({challenge:pending.challenge,recoveryCode:enabled.recoveryCodes[0]});
  assert.ok(complete.body.data.accessToken);
  const replay=await request(app).post('/api/auth/mfa').send({challenge:pending.challenge,recoveryCode:enabled.recoveryCodes[1]});
  assert.equal(replay.body.error.code,'INVALID_MFA_CHALLENGE');
  await pool.query('UPDATE block8_auth.users SET version=version+1');
  assert.equal((await login()).body.data.next,'mfa');
 }finally{await auth.drainMail();await pool.end();}
});
