import '../api/src/config/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import * as OTPAuth from 'otpauth';
import {createMfa} from '../shared/server/auth/mfa.js';
import {hashPassword} from '../shared/server/auth/crypto.js';
const connectionString=process.env.AUTH_TEST_DATABASE_URL||process.env.TEST_DATABASE_URL||(process.env.AUTH_TEST_USE_CONFIGURED_DB==='1'?process.env.AUTH_DATABASE_URL||process.env.DATABASE_URL:undefined);
test('PostgreSQL MFA: concurrent TOTP/recovery/challenge are single-use and failures commit', {skip:!connectionString,timeout:90000},async()=>{
 const pool=new pg.Pool({connectionString,connectionTimeoutMillis:10000}),schema=`mfa_test_${randomUUID().replaceAll('-','')}`;
 let time=Date.now();const transaction=async work=>{const c=await pool.connect();try{await c.query('BEGIN');const result=await work({query:(s,p)=>c.query(s.replaceAll('block8_auth.',`${schema}.`),p)});await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const mfa=createMfa({transaction,encryptionKey:Buffer.alloc(32,1).toString('base64'),now:()=>time});
 try{
  await pool.query((await readFile(new URL('../api/migrations/001-auth.sql',import.meta.url),'utf8')).replaceAll('block8_auth',schema));
  const user=(await pool.query(`INSERT INTO ${schema}.users(email,password_hash,status,email_verified_at) VALUES('concurrent@example.test',$1,'active',now()) RETURNING *`,[await hashPassword('concurrent-password-long-123')])).rows[0];
  const setup=await mfa.setup(user.id,{password:'concurrent-password-long-123'});
  const code=()=>new OTPAuth.TOTP({secret:setup.secret}).generate({timestamp:time});
  const enabled=await mfa.confirm(user.id,{otp:code()});
  const current=(await pool.query(`SELECT * FROM ${schema}.users`)).rows[0];
  const [a,b]=await Promise.all([mfa.challenge(current),mfa.challenge(current)]);time+=30000;
  const otpResults=await Promise.allSettled([mfa.finish(a.challenge,{otp:code()}),mfa.finish(b.challenge,{otp:code()})]);
  assert.equal(otpResults.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(Number((await pool.query(`SELECT mfa_attempts FROM ${schema}.users`)).rows[0].mfa_attempts),1);
  const [c,d]=await Promise.all([mfa.challenge(current),mfa.challenge(current)]);
  const recoveryResults=await Promise.allSettled([mfa.finish(c.challenge,{recoveryCode:enabled.recoveryCodes[0]}),mfa.finish(d.challenge,{recoveryCode:enabled.recoveryCodes[0]})]);
  assert.equal(recoveryResults.filter(r=>r.status==='fulfilled').length,1);
  const challenge=await mfa.challenge(current);
  const challengeResults=await Promise.allSettled([mfa.finish(challenge.challenge,{recoveryCode:enabled.recoveryCodes[1]}),mfa.finish(challenge.challenge,{recoveryCode:enabled.recoveryCodes[2]})]);
  assert.equal(challengeResults.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(Number((await mfa.status(user.id)).remaining),8);
 }finally{await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
});
